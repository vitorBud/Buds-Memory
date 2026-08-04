"""
cognitive/ingestion.py — Pipeline de ingestão de documentos do Buds Memory.

Responsabilidades extraídas de app.py (funções de domínio que não pertencem
à camada de rota HTTP):

  clean_imported_text(text)             → str
  extract_topics(text, limit)           → list[str]
  make_knowledge_title(text, fallback)  → str
  make_learning_title(topics, summary)  → str
  summarize_imported_text(text)         → str
  analyze_imported_document(...)        → dict
  extract_pdf_text_from_stream(stream)  → str
  extract_pdf_text(file_storage)        → str
  fetch_url_text(url)                   → str

O módulo não faz chamadas ao LLM — toda análise é determinística para não
bloquear uploads e manter latência baixa.
"""

from __future__ import annotations

import re
from html import unescape
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests


# ═══════════════════════════════════════════════════════════════════════════════
# LIMPEZA DE TEXTO
# ═══════════════════════════════════════════════════════════════════════════════

def clean_imported_text(text: str) -> str:
    """Normaliza textos importados: remove HTML, scripts, espaços extras."""
    text = unescape(text or "")
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>",   " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# EXTRAÇÃO DE TÓPICOS
# ═══════════════════════════════════════════════════════════════════════════════

_TOPIC_STOP_WORDS = {
    "para", "como", "uma", "com", "que", "por", "mais", "menos", "isso", "esse",
    "essa", "esta", "está", "das", "dos", "nas", "nos", "não", "nao", "seu", "sua",
    "sobre", "entre", "quando", "onde", "porque", "qual", "quais", "todo", "toda",
    "the", "and", "from", "with", "this", "that", "http", "https", "www",
}


def extract_topics(text: str, limit: int = 10) -> list[str]:
    """
    Extrai palavras-chave por frequência (TF básico), excluindo stop words.

    Usado para popular o campo `topics` do knowledge_source e alimentar o BrainMap.
    """
    normalized = (text or "").lower()
    normalized = re.sub(r"https?://\S+", " ", normalized)
    words = re.findall(r"[a-zA-ZÀ-ÿ0-9_-]{4,}", normalized)
    counts: dict[str, int] = {}
    for word in words:
        plain = word.strip("_-")
        if plain in _TOPIC_STOP_WORDS or plain.isnumeric():
            continue
        counts[plain] = counts.get(plain, 0) + 1
    return [
        word
        for word, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# TÍTULOS
# ═══════════════════════════════════════════════════════════════════════════════

def make_knowledge_title(text: str, fallback: str = "Conhecimento importado") -> str:
    """Cria título legível a partir do nome do arquivo ou primeira frase."""
    candidate = clean_imported_text(text) or fallback
    candidate = re.sub(r"\.[a-zA-Z0-9]{2,5}$", "", candidate)
    first_sentence = re.split(r"(?<=[.!?])\s+", candidate)[0].strip()
    title = first_sentence if 8 <= len(first_sentence) <= 72 else candidate[:72]
    title = title.strip(" .,:;!?-_")
    return (title[:69].rstrip() + "...") if len(title) > 72 else title or fallback


_TECH_ALIASES: dict[str, str] = {
    "python":       "Python",
    "javascript":   "JavaScript",
    "react":        "React",
    "flask":        "Flask",
    "dados":        "dados",
    "database":     "banco de dados",
    "backend":      "backend",
    "frontend":     "frontend",
    "api":          "APIs",
    "programacao":  "programação",
    "programação":  "programação",
    "classe":       "classes",
    "função":       "funções",
    "funcao":       "funções",
}


def make_learning_title(
    topics: list[str],
    summary: str,
    fallback: str = "Conhecimento importado",
) -> str:
    """Cria um título curto e legível para um aprendizado importado."""
    readable: list[str] = []
    for topic in topics or []:
        clean = re.sub(r"[_-]+", " ", str(topic)).strip().lower()
        if len(clean) < 3 or clean.isnumeric():
            continue
        readable.append(_TECH_ALIASES.get(clean, clean.capitalize()))
        if len(readable) == 3:
            break

    if readable:
        if len(readable) == 1:
            return f"Aprendizado sobre {readable[0]}"
        return f"Aprendizado: {', '.join(readable[:-1])} e {readable[-1]}"

    return make_knowledge_title(summary, fallback=fallback)


# ═══════════════════════════════════════════════════════════════════════════════
# RESUMO DETERMINÍSTICO
# ═══════════════════════════════════════════════════════════════════════════════

def summarize_imported_text(text: str) -> str:
    """
    Gera resumo curto determinístico sem chamar LLM.

    Estratégia: primeiras 3 sentenças, máximo 700 caracteres.
    Não bloqueia o upload por ser 100% local.
    """
    text = clean_imported_text(text)
    if len(text) <= 520:
        return text
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    summary = " ".join(sentences[:3]).strip()
    return summary[:700].rstrip() + ("..." if len(summary) > 700 else "")


# ═══════════════════════════════════════════════════════════════════════════════
# ANÁLISE DE DOCUMENTO (sem LLM)
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_imported_document(
    content: str,
    source_type: str,
    source_name: str,
    topics: list[str],
) -> dict:
    """
    Gera metadados do Second Brain para um documento importado.

    Não chama LLM — usa análise determinística para não travar uploads.
    Retorna executive_summary, technical_summary, suggested_questions,
    detected_entities e metadata.
    """
    # Importação local para evitar circular import (detector usa knowledge_graph)
    from cognitive import detector as cognitive_detector

    clean = clean_imported_text(content)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", clean) if part.strip()]
    executive = " ".join(sentences[:5])[:1400].strip()

    tech_entities = cognitive_detector.detect_technologies(clean)
    detected_entities = sorted(set(tech_entities + topics[:8]))

    technical_bits: list[str] = []
    if tech_entities:
        technical_bits.append(f"Tecnologias detectadas: {', '.join(tech_entities[:12])}.")
    if topics:
        technical_bits.append(f"Tópicos principais: {', '.join(topics[:12])}.")
    technical_bits.append("Trechos representativos: " + " ".join(sentences[:8])[:1800])

    questions = [
        "O que este documento ensina?",
        "Quais são os principais tópicos?",
        "Quais tecnologias ou ferramentas aparecem?",
        "Como posso aplicar este conteúdo no meu projeto?",
    ]
    if source_type == "pdf":
        questions.insert(1, "Faça um resumo do PDF por partes.")
    if tech_entities:
        questions.append(f"Explique a relação entre {tech_entities[0]} e este documento.")

    return {
        "executive_summary": executive or summarize_imported_text(clean),
        "technical_summary": "\n".join(technical_bits)[:2600],
        "suggested_questions": questions[:6],
        "detected_entities": detected_entities[:20],
        "metadata": {
            "source_type": source_type,
            "source_name": source_name,
            "char_count": len(clean),
            "estimated_tokens": max(1, len(clean) // 4),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EXTRAÇÃO DE PDF
# ═══════════════════════════════════════════════════════════════════════════════

def extract_pdf_text_from_stream(stream) -> str:
    """Extrai texto de um stream PDF usando PyPDF2 quando disponível."""
    try:
        from PyPDF2 import PdfReader
    except ImportError as exc:
        raise RuntimeError(
            "Leitura de PDF precisa do pacote PyPDF2. Rode: pip install PyPDF2"
        ) from exc

    reader = PdfReader(stream)
    pages = [page.extract_text() or "" for page in reader.pages[:80]]
    return clean_imported_text("\n".join(pages))


def extract_pdf_text(file_storage) -> str:
    """Extrai texto de PDF enviado pelo navegador."""
    return extract_pdf_text_from_stream(file_storage.stream)


# ═══════════════════════════════════════════════════════════════════════════════
# BUSCA DE URL EXTERNA
# ═══════════════════════════════════════════════════════════════════════════════

def _is_private_address(hostname: str) -> bool:
    """
    Retorna True se o hostname resolve para um IP privado/local.
    Proteção SSRF — bloqueia requests a redes internas via URL importada.
    """
    import ipaddress
    import socket
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or str(ip).startswith("169.254.")  # AWS metadata endpoint
        )
    except Exception:
        return True  # em caso de dúvida, bloqueia


def fetch_url_text(url: str) -> str:
    """
    Baixa uma página ou PDF público e extrai texto suficiente para contexto.

    Inclui proteção SSRF e suporte a PDF via content-type ou extensão.
    """
    if not re.match(r"^https?://", url or ""):
        raise ValueError("Informe uma URL começando com http:// ou https://.")

    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    if not hostname or _is_private_address(hostname):
        raise ValueError(
            "URLs apontando para endereços privados, localhost ou redes internas não são permitidas."
        )

    response = requests.get(
        url,
        timeout=15,
        headers={"User-Agent": "BudsMemory/1.0"},
    )
    response.raise_for_status()

    content_type = response.headers.get("content-type", "").lower()
    is_pdf = (
        ".pdf" in url.lower()
        or "application/pdf" in content_type
        or response.content[:5] == b"%PDF-"
    )
    if is_pdf:
        return extract_pdf_text_from_stream(BytesIO(response.content))

    return clean_imported_text(response.text)
