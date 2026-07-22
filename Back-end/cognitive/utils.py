"""
cognitive/utils.py — Utilitários compartilhados entre módulos cognitivos.

Centraliza funções puras que estavam duplicadas em rag.py, conversation.py e
database.py. Sem dependências externas — apenas stdlib.

Funções exportadas:
  freshness_score(created_at)     → float 0.0–1.0
  tokenize(text, min_len)         → list[str]
  is_vague_text(text)             → bool
  clip(text, limit)               → str
  jaccard_similarity(a, b)        → float
"""

from __future__ import annotations

import datetime
import re
from typing import Optional

# Palavras que nunca contribuem para busca
_STOP_WORDS: frozenset[str] = frozenset({
    "para", "como", "qual", "quais", "sobre", "onde", "quando", "isso",
    "esse", "essa", "aqui", "voce", "você", "documento", "arquivo",
    "the", "and", "from", "with", "this", "that",
})

# Pronomes e termos que indicam referência vaga ao contexto anterior
_VAGUE_WORDS: frozenset[str] = frozenset({
    "isso", "isto", "esse", "essa", "aquilo", "ele", "ela", "disso",
    "desse", "dessa", "aqui", "lá", "la", "também", "tambem",
    "nele", "nela", "eles", "elas",
})


def freshness_score(created_at: Optional[str]) -> float:
    """
    Score de frescor baseado na data de criação.

    Retorna valor entre 0.0 e 1.0:
      Hoje        → 1.0
      1 semana    → 0.9
      1 mês       → 0.7
      3 meses     → 0.55
      6 meses     → 0.45
      1 ano       → 0.35
      Mais antigo → 0.2
    """
    if not created_at:
        return 0.5
    try:
        ts = datetime.datetime.fromisoformat(
            str(created_at).replace("Z", "+00:00")
        ).replace(tzinfo=None)
        age_days = (datetime.datetime.now() - ts).days
    except Exception:
        return 0.5

    if age_days <= 1:   return 1.0
    if age_days <= 7:   return 0.9
    if age_days <= 30:  return 0.7
    if age_days <= 90:  return 0.55
    if age_days <= 180: return 0.45
    if age_days <= 365: return 0.35
    return 0.2


def tokenize(text: str, min_len: int = 3) -> list[str]:
    """
    Extrai tokens relevantes de texto, removendo stop words e caracteres especiais.

    Args:
        text: Texto de entrada.
        min_len: Comprimento mínimo do token (padrão: 3).

    Returns:
        Lista de tokens únicos em minúsculas.
    """
    clean = re.sub(r"[^\w\s./_-]", " ", (text or "").lower())
    tokens = []
    seen: set[str] = set()
    for word in clean.split():
        if len(word) >= min_len and word not in _STOP_WORDS and word not in seen:
            tokens.append(word)
            seen.add(word)
    return tokens


def is_vague_text(text: str) -> bool:
    """
    Detecta perguntas que dependem de contexto anterior.

    Retorna True se o texto:
    - Tem 4 palavras ou menos, ou
    - Contém pronomes/demonstrativos vagos.
    """
    lower = (text or "").lower().strip()
    words = re.findall(r"[a-zA-ZÀ-ÿ0-9_+-]+", lower)
    return len(words) <= 4 or any(w in _VAGUE_WORDS for w in words)


def clip(text: str, limit: int) -> str:
    """
    Trunca texto com reticências respeitando o limite de caracteres.

    Normaliza espaços antes de truncar.
    """
    clean = re.sub(r"\s+", " ", (text or "").strip())
    if len(clean) <= limit:
        return clean
    return clean[:limit - 3].rstrip() + "..."


def jaccard_similarity(a: set, b: set) -> float:
    """
    Similaridade de Jaccard entre dois conjuntos.

    Retorna 1.0 para dois conjuntos vazios (ambos iguais).
    """
    if not a and not b:
        return 1.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0
