"""
cognitive/rag.py — RAG Cognitivo Avançado do Aether Memory.

Implementa (funcionalidades já existentes, preservadas):
  ✓ Chunking inteligente (parágrafos e código)
  ✓ Embeddings locais via sentence-transformers (fallback BM25)
  ✓ Busca semântica por cosine similarity
  ✓ Busca híbrida: semântica + BM25 com Reciprocal Rank Fusion
  ✓ Contexto formatado com citações de origem
  ✓ Fallback 100% offline

Novas camadas (RAG Cognitivo):
  ★ Embedding Cache — evita reprocessamento (TTL 1h, 200 entradas)
  ★ Query Expansion — expande variantes antes de buscar
  ★ Freshness Score — prioriza informações recentes
  ★ Importance Score — prioriza conhecimentos do usuário
  ★ Cognitive Ranking — score composto de 6 dimensões
  ★ Context Compression — remove chunks redundantes
  ★ Code Search Engine — busca especializada para código
  ★ Auto Learning — popula Knowledge Graph após indexação
  ★ Traceable Template Chunking — chunks com seção, tipo e posição no documento

O módulo funciona sem sentence-transformers (BM25 puro como fallback).
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import re
import struct
import time
import threading
from pathlib import Path
from typing import Optional

from database_v2 import get_db_connection, now_iso, json_dumps, json_loads
from cognitive.utils import freshness_score as _freshness_score


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ═══════════════════════════════════════════════════════════════════════════════

_EMBEDDING_MODEL           = None
_EMBEDDING_AVAILABLE       = False
_EMBEDDING_LOAD_ATTEMPTED  = False
_SEMANTIC_ENABLED          = os.getenv("NEXUS_ENABLE_SEMANTIC_RAG", "0").lower() in {"1", "true", "yes", "sim"}
_MODEL_NAME                = os.getenv("NEXUS_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
_PIPELINE_VERSION          = "rag-v3-incremental-cache"
_CHUNK_TEMPLATE_VERSION    = "traceable-template-chunks-v1"

# ── Parâmetros de chunking ────────────────────────────────────────────────────
CHUNK_SIZE           = 512    # caracteres (≈ 128 tokens)
CHUNK_OVERLAP        = 64
MIN_CHUNK_LEN        = 80
TOP_K_DEFAULT        = 8
SIMILARITY_THRESHOLD = 0.45

# ── Embedding Cache ───────────────────────────────────────────────────────────
CACHE_SIZE_MAX    = 200   # entradas máximas
CACHE_TTL_SECONDS = 3600  # 1 hora

_EMBED_CACHE: dict[str, tuple[bytes, float]] = {}
_EMBED_CACHE_LOCK = threading.Lock()

# ── Pesos do Cognitive Ranking ────────────────────────────────────────────────
W_SEMANTIC   = 0.35
W_BM25       = 0.20
W_FRESHNESS  = 0.15
W_IMPORTANCE = 0.15
W_GRAPH      = 0.10
W_USAGE      = 0.05

# ── Context Compression ───────────────────────────────────────────────────────
COMPRESSION_SIMILARITY = 0.60  # limiar de similaridade lexical entre chunks

# ── Query Expansion: aliases e sinônimos ──────────────────────────────────────
_QUERY_ALIASES: dict[str, list[str]] = {
    "react":        ["reactjs", "hooks", "usestate", "useeffect", "jsx"],
    "estado":       ["state", "useState", "gerenciamento de estado"],
    "state":        ["estado", "useState", "gerenciamento"],
    "hooks":        ["usestate", "useeffect", "usecallback", "hook"],
    "flask":        ["flask api", "python backend", "rota flask"],
    "api":          ["endpoint", "rota", "rest api", "http"],
    "banco":        ["database", "sqlite", "sql", "db"],
    "database":     ["banco", "sqlite", "sql"],
    "autenticacao": ["auth", "jwt", "login", "token"],
    "auth":         ["autenticacao", "jwt", "login", "token"],
    "componente":   ["component", "tsx", "jsx"],
    "component":    ["componente", "tsx", "jsx"],
    "estilo":       ["css", "style", "tailwind"],
    "css":          ["estilo", "style", "design"],
    "projeto":      ["project", "app", "aplicacao"],
    "python":       ["py", "script", "backend"],
    "javascript":   ["js", "frontend", "ecmascript"],
    "typescript":   ["ts", "tsx", "tipagem"],
    "funcao":       ["function", "def", "metodo"],
    "function":     ["funcao", "def", "metodo", "fn"],
    "classe":       ["class", "objeto", "oop"],
    "class":        ["classe", "objeto"],
    "erro":         ["error", "exception", "bug", "traceback"],
    "error":        ["erro", "exception", "bug"],
    "memoria":      ["memory", "lembrar", "recall", "historico"],
    "memory":       ["memoria", "lembrar", "historico"],
    "deploy":       ["deployar", "publicar", "producao", "production"],
    "git":          ["commit", "push", "branch", "versionamento"],
    "pdf":          ["documento", "arquivo", "material", "fonte importada"],
    "documento":    ["pdf", "arquivo", "material", "conteúdo importado"],
    "arquivo":      ["pdf", "documento", "material importado"],
    "aprendeu":     ["aprendizado", "resumo", "conteúdo", "tópicos"],
    "aprendizado":  ["aprendeu", "resumo", "conteúdo", "conhecimento"],
}

_VAGUE_QUERY_TERMS = {
    "isso", "isto", "esse", "essa", "ele", "ela", "eles", "elas", "nele", "nela",
    "disso", "desse", "dessa", "pdf", "arquivo", "documento", "material", "aprendeu",
}

# ── Code Search: padrões de detecção ─────────────────────────────────────────
_CODE_LANG_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("python",     re.compile(r"\bdef\s+\w+|\bclass\s+\w+|import\s+\w+|from\s+\w+")),
    ("javascript", re.compile(r"\bfunction\s+\w+|\bconst\s+\w+\s*=|\barrow\b|=>\s*\{")),
    ("typescript", re.compile(r":\s*(string|number|boolean|void|any)\b|interface\s+\w+")),
    ("react",      re.compile(r"useState|useEffect|useCallback|useMemo|useRef|jsx|tsx")),
    ("sql",        re.compile(r"\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE TABLE\b")),
    ("html",       re.compile(r"<\w+[^>]*>|</\w+>")),
    ("css",        re.compile(r"\{[^}]*:\s*[^;]+;\s*\}|\.[\w-]+\s*\{")),
    ("bash",       re.compile(r"^\$\s+|#!/bin/|npm\s+|pip\s+|docker\s+")),
]

_CODE_ENTITY_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("functions", re.compile(r"\bdef\s+(\w+)|\bfunction\s+(\w+)|(\w+)\s*=\s*\([^)]*\)\s*=>")),
    ("classes",   re.compile(r"\bclass\s+(\w+)")),
    ("imports",   re.compile(r"^(?:import|from)\s+([\w.]+)", re.MULTILINE)),
    ("hooks",     re.compile(r"\b(use[A-Z]\w+)\s*\(")),
    ("endpoints", re.compile(r"@\w+\.(?:get|post|put|delete|patch)\s*\(['\"]([^'\"]+)")),
    ("routes",    re.compile(r"(?:path|url)\s*[:=]\s*['\"]([^'\"]+)")),
]


# ═══════════════════════════════════════════════════════════════════════════════
# EMBEDDING MODEL
# ═══════════════════════════════════════════════════════════════════════════════

def _get_embedding_model():
    """Carrega embeddings somente quando a busca semântica estiver habilitada."""
    global _EMBEDDING_MODEL, _EMBEDDING_AVAILABLE, _EMBEDDING_LOAD_ATTEMPTED

    if not _SEMANTIC_ENABLED:
        return None
    if _EMBEDDING_MODEL is not None:
        return _EMBEDDING_MODEL
    if _EMBEDDING_LOAD_ATTEMPTED:
        return None

    _EMBEDDING_LOAD_ATTEMPTED = True
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    try:
        from sentence_transformers import SentenceTransformer
        _EMBEDDING_MODEL = SentenceTransformer(_MODEL_NAME, local_files_only=True)
        _EMBEDDING_AVAILABLE = True
        print("[RAG] sentence-transformers carregado localmente — busca semântica ativa.")
        return _EMBEDDING_MODEL
    except Exception as exc:
        _EMBEDDING_AVAILABLE = False
        print(f"[RAG] Embeddings semânticos indisponíveis ({exc}). Usando BM25 offline.")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# CHUNKING (preservado integralmente)
# ═══════════════════════════════════════════════════════════════════════════════

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Divide texto em chunks respeitando:
    1. Blocos de código (``` ... ```) — nunca divide no meio
    2. Parágrafos (linhas em branco)
    3. Sentenças (ponto + espaço)
    4. Fallback: janela deslizante
    """
    text = re.sub(r"[ \t]+", " ", (text or "").strip())
    if not text:
        return []

    segments: list[tuple[str, bool]] = []
    parts = re.split(r"(```[\s\S]*?```)", text)
    for part in parts:
        is_code = part.startswith("```")
        segments.append((part, is_code))

    chunks: list[str] = []
    for segment, is_code in segments:
        if not segment.strip():
            continue
        if is_code or len(segment) <= chunk_size:
            if len(segment.strip()) >= MIN_CHUNK_LEN:
                chunks.append(segment.strip())
            continue

        paras = [p.strip() for p in re.split(r"\n{2,}", segment) if p.strip()]
        buffer = ""
        for para in paras:
            if len(buffer) + len(para) <= chunk_size:
                buffer = (buffer + "\n\n" + para).strip()
            else:
                if len(buffer) >= MIN_CHUNK_LEN:
                    chunks.append(buffer)
                if len(para) > chunk_size:
                    sentences = re.split(r"(?<=[.!?])\s+", para)
                    sbuf = ""
                    for sent in sentences:
                        if len(sbuf) + len(sent) <= chunk_size:
                            sbuf = (sbuf + " " + sent).strip()
                        else:
                            if len(sbuf) >= MIN_CHUNK_LEN:
                                chunks.append(sbuf)
                            sbuf = sent
                    if len(sbuf) >= MIN_CHUNK_LEN:
                        chunks.append(sbuf)
                    buffer = ""
                else:
                    buffer = para

        if len(buffer) >= MIN_CHUNK_LEN:
            chunks.append(buffer)

    return chunks


def chunk_document_with_metadata(content: str) -> list[dict]:
    """
    Divide um documento em chunks com metadados rastreáveis.

    Inspirado no chunking por template do RAGFlow: documentos Markdown, tabelas,
    código e texto corrido recebem marcações diferentes sem exigir dependências
    pesadas de parsing/OCR.
    """
    text = content or ""
    if not text.strip():
        return []

    template = _detect_chunk_template(text)
    sections = _split_template_sections(text, template)
    items: list[dict] = []

    for section in sections:
        section_text = section["text"]
        local_chunks = chunk_text(section_text)
        cursor = 0
        for chunk in local_chunks:
            local_start = section_text.find(chunk, cursor)
            if local_start < 0:
                local_start = section_text.find(chunk)
            if local_start < 0:
                local_start = cursor
            local_end = min(len(section_text), local_start + len(chunk))
            cursor = local_end

            start = int(section["start"]) + local_start
            end = int(section["start"]) + local_end
            chunk_kind = _detect_chunk_kind(chunk)
            items.append({
                "text": chunk,
                "metadata": {
                    "template": template,
                    "section_title": section.get("title") or "",
                    "section_level": section.get("level"),
                    "char_start": start,
                    "char_end": end,
                    "chunk_kind": chunk_kind,
                    "estimated_tokens": max(1, len(chunk) // 4),
                },
            })

    return items


def _detect_chunk_template(text: str) -> str:
    """Escolhe um template leve de chunking para o tipo de documento."""
    sample = text[:6000]
    if re.search(r"(?m)^#{1,6}\s+\S+", sample) or "```" in sample:
        return "markdown"
    table_lines = sum(1 for line in sample.splitlines() if line.count("|") >= 2 or line.count("\t") >= 2)
    if table_lines >= 3:
        return "table"
    if any(pattern.search(sample) for _, pattern in _CODE_LANG_PATTERNS):
        return "code"
    return "prose"


def _split_template_sections(text: str, template: str) -> list[dict]:
    """Quebra o documento em seções coerentes para o template detectado."""
    if template != "markdown":
        title = "Tabela" if template == "table" else ("Código" if template == "code" else "Documento")
        return [{"title": title, "level": None, "start": 0, "text": text}]

    matches = list(re.finditer(r"(?m)^(#{1,6})\s+(.+?)\s*$", text))
    if not matches:
        return [{"title": "Documento", "level": None, "start": 0, "text": text}]

    sections = []
    if matches[0].start() > 0:
        sections.append({
            "title": "Introdução",
            "level": None,
            "start": 0,
            "text": text[:matches[0].start()],
        })

    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        sections.append({
            "title": match.group(2).strip()[:120],
            "level": len(match.group(1)),
            "start": start,
            "text": text[start:end],
        })

    return [section for section in sections if section["text"].strip()]


def _detect_chunk_kind(chunk: str) -> str:
    stripped = (chunk or "").strip()
    if stripped.startswith("```"):
        return "code"
    lines = [line.strip() for line in stripped.splitlines() if line.strip()]
    if len(lines) >= 2 and sum(1 for line in lines if line.startswith(("-", "*", "+")) or re.match(r"^\d+\.", line)) >= 2:
        return "list"
    if len(lines) >= 2 and sum(1 for line in lines if line.count("|") >= 2 or line.count("\t") >= 2) >= 2:
        return "table"
    if any(pattern.search(stripped) for _, pattern in _CODE_LANG_PATTERNS):
        return "code"
    return "text"


# ═══════════════════════════════════════════════════════════════════════════════
# EMBEDDINGS + CACHE
# ═══════════════════════════════════════════════════════════════════════════════

def _embed(text: str) -> Optional[bytes]:
    """
    Gera embedding para o texto com cache em memória (TTL 1h).
    Evita reprocessar a mesma query repetidamente.
    """
    model = _get_embedding_model()
    if model is None:
        return None

    cache_key = text.strip()[:256]  # normaliza chave
    now = time.monotonic()

    with _EMBED_CACHE_LOCK:
        if cache_key in _EMBED_CACHE:
            blob, ts = _EMBED_CACHE[cache_key]
            if now - ts < CACHE_TTL_SECONDS:
                return blob
            else:
                del _EMBED_CACHE[cache_key]

    try:
        vec = model.encode(text, normalize_embeddings=True)
        blob = struct.pack(f"{len(vec)}f", *vec.tolist())

        with _EMBED_CACHE_LOCK:
            # Eviction por tamanho
            if len(_EMBED_CACHE) >= CACHE_SIZE_MAX:
                oldest_key = min(_EMBED_CACHE, key=lambda k: _EMBED_CACHE[k][1])
                del _EMBED_CACHE[oldest_key]
            _EMBED_CACHE[cache_key] = (blob, now)

        return blob
    except Exception as e:
        print(f"[RAG] Erro ao gerar embedding: {e}")
        return None


def _decode_embedding(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))  # vetores normalizados


# ═══════════════════════════════════════════════════════════════════════════════
# FRESHNESS SCORE — importado de cognitive/utils (eliminada duplicata local)
# ═══════════════════════════════════════════════════════════════════════════════

# _freshness_score(created_at) disponível via import acima.


# ═══════════════════════════════════════════════════════════════════════════════
# QUERY EXPANSION
# ═══════════════════════════════════════════════════════════════════════════════

def _expand_query(query: str) -> list[str]:
    """
    Gera variantes da query para ampliar a recuperação.
    "estado react" → ["estado react", "state react", "useState react hooks"]
    """
    if not query or len(query.strip()) < 3:
        return [query]

    # Normaliza para comparação
    clean = re.sub(r"[^\w\s]", " ", query.lower())
    words = clean.split()

    extra_terms: set[str] = set()
    for word in words:
        if word in _QUERY_ALIASES:
            for alias in _QUERY_ALIASES[word][:2]:  # máx. 2 aliases por palavra
                extra_terms.add(alias)

    # Remove termos que já estão na query original
    original_lower = query.lower()
    unique_extras = [t for t in extra_terms if t.lower() not in original_lower]

    if not unique_extras:
        return [query]

    # Gera variante combinada (máx. 2 variantes extras)
    queries = [query]
    if unique_extras:
        queries.append(f"{query} {' '.join(unique_extras[:3])}")

    return queries[:3]  # máx. 3 queries no total


# ═══════════════════════════════════════════════════════════════════════════════
# CODE METADATA EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def _extract_code_metadata(chunk: str) -> dict:
    """
    Detecta linguagem e extrai entidades de código do chunk.
    Usado durante a indexação para enriquecer os embeddings com metadados.
    """
    metadata: dict = {
        "is_code": False,
        "language": None,
        "functions": [],
        "classes": [],
        "imports": [],
        "hooks": [],
        "endpoints": [],
        "routes": [],
    }

    # Detecta se é código
    is_fenced = chunk.strip().startswith("```")
    has_code_patterns = any(p.search(chunk) for _, p in _CODE_LANG_PATTERNS)

    if not is_fenced and not has_code_patterns:
        return metadata

    metadata["is_code"] = True

    # Detecta linguagem (primeira que bate)
    for lang, pattern in _CODE_LANG_PATTERNS:
        if pattern.search(chunk):
            metadata["language"] = lang
            break

    # Extrai entidades de código
    for entity_type, pattern in _CODE_ENTITY_PATTERNS:
        matches: list[str] = []
        for match in pattern.finditer(chunk):
            # Pega primeiro grupo não-vazio
            name = next((g for g in match.groups() if g), None)
            if name and len(name) > 1:
                matches.append(name)
        metadata[entity_type] = matches[:10]  # limita

    return metadata


# ═══════════════════════════════════════════════════════════════════════════════
# INGESTION CACHE
# ═══════════════════════════════════════════════════════════════════════════════

def _pipeline_key() -> str:
    """Identifica a configuração que torna um índice reaproveitável."""
    payload = {
        "version": _PIPELINE_VERSION,
        "chunk_template_version": _CHUNK_TEMPLATE_VERSION,
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
        "min_chunk_len": MIN_CHUNK_LEN,
        "semantic_enabled": _SEMANTIC_ENABLED,
        "embedding_model": _MODEL_NAME if _SEMANTIC_ENABLED else None,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _content_hash(content: str) -> str:
    """Hash determinístico do conteúdo bruto importado."""
    text = content or ""
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


def _get_ingestion_cache(source_table: str, source_id: int) -> Optional[dict]:
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                """
                SELECT * FROM ingestion_cache
                WHERE source_table=? AND source_id=?
                """,
                (source_table, source_id),
            ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def _indexed_chunk_count(source_table: str, source_id: int) -> int:
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS n FROM embeddings
                WHERE source_table=? AND source_id=?
                """,
                (source_table, source_id),
            ).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def _is_ingestion_cache_valid(source_table: str, source_id: int, content: str) -> bool:
    cached = _get_ingestion_cache(source_table, source_id)
    if not cached:
        return False
    chunk_count = int(cached.get("chunk_count") or 0)
    return (
        chunk_count > 0
        and cached.get("content_hash") == _content_hash(content)
        and cached.get("pipeline_key") == _pipeline_key()
        and _indexed_chunk_count(source_table, source_id) >= chunk_count
    )


def _save_ingestion_cache(
    source_table: str,
    source_id: int,
    content_hash: str,
    pipeline_key: str,
    chunk_count: int,
    metadata: Optional[dict] = None,
) -> None:
    try:
        with get_db_connection() as conn:
            conn.execute(
                """
                INSERT INTO ingestion_cache
                  (source_table, source_id, content_hash, chunk_count, pipeline_key, metadata, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_table, source_id) DO UPDATE SET
                  content_hash=excluded.content_hash,
                  chunk_count=excluded.chunk_count,
                  pipeline_key=excluded.pipeline_key,
                  metadata=excluded.metadata,
                  indexed_at=excluded.indexed_at
                """,
                (
                    source_table,
                    source_id,
                    content_hash,
                    chunk_count,
                    pipeline_key,
                    json_dumps(metadata or {}),
                    now_iso(),
                ),
            )
            conn.commit()
    except Exception as exc:
        print(f"[RAG] Cache incremental indisponível: {exc}")


# ═══════════════════════════════════════════════════════════════════════════════
# INDEXAÇÃO (preservada + enriquecida com metadados)
# ═══════════════════════════════════════════════════════════════════════════════

def index_document(
    knowledge_source_id: int,
    content: str,
    source_table: str = "knowledge_sources",
    auto_learn: bool = True,
    session_id: Optional[str] = None,
    force: bool = False,
) -> int:
    """
    Chunkeia o conteúdo, gera embeddings e extrai metadados de código.
    Retorna número de chunks indexados.
    """
    content_hash = _content_hash(content)
    pipeline_key = _pipeline_key()
    cached = _get_ingestion_cache(source_table, knowledge_source_id)
    if (
        not force
        and cached
        and cached.get("content_hash") == content_hash
        and cached.get("pipeline_key") == pipeline_key
        and cached.get("chunk_count", 0) > 0
        and _indexed_chunk_count(source_table, knowledge_source_id) >= cached.get("chunk_count", 0)
    ):
        return int(cached.get("chunk_count", 0))

    chunk_items = chunk_document_with_metadata(content)
    chunks = [item["text"] for item in chunk_items]

    # Remove embeddings antigos desta fonte
    with get_db_connection() as conn:
        conn.execute(
            "DELETE FROM embeddings WHERE source_table=? AND source_id=?",
            (source_table, knowledge_source_id),
        )
        conn.commit()

    if not chunks:
        _save_ingestion_cache(
            source_table,
            knowledge_source_id,
            content_hash,
            pipeline_key,
            0,
            {"reason": "empty_after_chunking"},
        )
        return 0

    ts = now_iso()
    rows = []
    for i, item in enumerate(chunk_items):
        chunk = item["text"]
        emb_blob = _embed(chunk)
        if emb_blob is None:
            emb_blob = b""

        # Extrai metadados de código
        code_meta = _extract_code_metadata(chunk)
        trace_meta = item.get("metadata") or {}
        meta_json = json_dumps({**code_meta, **trace_meta})

        rows.append((source_table, knowledge_source_id, i, chunk, emb_blob, ts, meta_json))

    with get_db_connection() as conn:
        # Tenta inserir com chunk_metadata (nova coluna)
        try:
            conn.executemany(
                """
                INSERT INTO embeddings
                  (source_table, source_id, chunk_index, chunk_text, embedding, created_at, chunk_metadata)
                VALUES (?,?,?,?,?,?,?)
                """,
                rows,
            )
        except Exception:
            # Fallback: sem chunk_metadata (banco antigo sem ALTER TABLE ainda)
            conn.executemany(
                """
                INSERT INTO embeddings
                  (source_table, source_id, chunk_index, chunk_text, embedding, created_at)
                VALUES (?,?,?,?,?,?)
                """,
                [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows],
            )
        conn.commit()

    _save_ingestion_cache(
        source_table,
        knowledge_source_id,
        content_hash,
        pipeline_key,
        len(chunks),
        {
            "semantic_enabled": _SEMANTIC_ENABLED,
            "embedding_model": _MODEL_NAME if _SEMANTIC_ENABLED else None,
            "chunk_size": CHUNK_SIZE,
            "chunk_overlap": CHUNK_OVERLAP,
            "chunk_template_version": _CHUNK_TEMPLATE_VERSION,
        },
    )

    # Auto Learning em background
    if auto_learn and source_table == "knowledge_sources":
        t = threading.Thread(
            target=_auto_learn_document,
            args=(knowledge_source_id, content, session_id),
            daemon=True,
        )
        t.start()

    return len(chunks)


def index_all_knowledge(session_id: Optional[str] = None, force: bool = False) -> dict:
    """Re-indexa todos os knowledge_sources (ou apenas de uma sessão)."""
    with get_db_connection() as conn:
        if session_id:
            rows = conn.execute(
                "SELECT id, content FROM knowledge_sources WHERE session_id=?",
                (session_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, content FROM knowledge_sources"
            ).fetchall()

    total_chunks = 0
    skipped = 0
    for row in rows:
        was_cached = _is_ingestion_cache_valid("knowledge_sources", row["id"], row["content"])
        count = index_document(row["id"], row["content"], auto_learn=False, force=force)
        total_chunks += count
        if not force and was_cached:
            skipped += 1

    return {"indexed": len(rows), "skipped_unchanged": skipped, "total_chunks": total_chunks}


# ═══════════════════════════════════════════════════════════════════════════════
# AUTO LEARNING
# ═══════════════════════════════════════════════════════════════════════════════

def _auto_learn_document(
    knowledge_source_id: int,
    content: str,
    session_id: Optional[str],
) -> None:
    """
    Após indexar um documento, popula o Knowledge Graph automaticamente.
    Roda em thread de background — zero impacto na latência de indexação.
    """
    try:
        from cognitive import knowledge_graph, timeline

        # Detecta e registra entidades no KG
        entities = knowledge_graph.detect_and_register(content, session_id)

        # Registra evento na timeline
        if entities:
            entity_str = ", ".join(entities[:4])
            timeline.add_event(
                title=f"Documento indexado com {len(entities)} conceito(s)",
                event_type="document_indexed",
                description=f"Conceitos detectados: {entity_str}",
                session_id=session_id,
                importance=0.55,
                tags=entities[:6],
            )

        # Extrai metadados de código globalmente do documento
        code_chunks = [c for c in chunk_text(content) if _extract_code_metadata(c)["is_code"]]
        if code_chunks:
            langs = set()
            for chunk in code_chunks:
                meta = _extract_code_metadata(chunk)
                if meta["language"]:
                    langs.add(meta["language"])
            for lang in langs:
                knowledge_graph.upsert_entity(lang, "technology", importance=0.5)

    except Exception as e:
        print(f"[RAG Auto-Learn] Erro em background: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXT COMPRESSION
# ═══════════════════════════════════════════════════════════════════════════════

def _compress_context(chunks: list[dict]) -> list[dict]:
    """
    Remove chunks redundantes/semelhantes antes de montar o contexto.

    Usa similaridade lexical BM25 entre chunks:
    - Se dois chunks têm sobreposição de tokens > COMPRESSION_SIMILARITY, mantém só o mais relevante.
    - Resultado: contexto mais compacto e variado → menos tokens, melhor qualidade.
    """
    if len(chunks) <= 2:
        return chunks

    def _token_set(text: str) -> set[str]:
        return set(re.sub(r"[^\w\s]", " ", text.lower()).split())

    def _jaccard(a: set, b: set) -> float:
        if not a and not b:
            return 1.0
        inter = len(a & b)
        union = len(a | b)
        return inter / union if union else 0.0

    kept: list[dict] = []
    token_sets: list[set] = []

    for chunk in chunks:
        tset = _token_set(chunk.get("chunk_text", ""))
        is_redundant = any(
            _jaccard(tset, existing) > COMPRESSION_SIMILARITY
            for existing in token_sets
        )
        if not is_redundant:
            kept.append(chunk)
            token_sets.append(tset)

    return kept if kept else chunks[:1]


# ═══════════════════════════════════════════════════════════════════════════════
# BUSCA — preservadas + melhoradas
# ═══════════════════════════════════════════════════════════════════════════════

def semantic_search(
    query: str,
    top_k: int = TOP_K_DEFAULT,
    threshold: float = SIMILARITY_THRESHOLD,
    source_table: Optional[str] = None,
    session_id: Optional[str] = None,
) -> list[dict]:
    """
    Busca semântica por cosine similarity.
    Fallback automático para BM25 se embeddings não disponíveis.
    """
    if _get_embedding_model() is not None:
        return _semantic_search_vector(query, top_k, threshold, source_table, session_id)
    return bm25_search(query, top_k, source_table, session_id)


def _semantic_search_vector(
    query: str,
    top_k: int,
    threshold: float,
    source_table: Optional[str],
    session_id: Optional[str],
) -> list[dict]:
    query_emb = _embed(query)
    if not query_emb:
        return bm25_search(query, top_k, source_table, session_id)

    query_vec = _decode_embedding(query_emb)

    conditions = ["embedding != ''", "embedding IS NOT NULL", "length(embedding) > 0"]
    params: list = []

    if source_table:
        conditions.append("e.source_table = ?")
        params.append(source_table)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db_connection() as conn:
        if session_id:
            rows = conn.execute(
                f"""
                SELECT e.*, k.session_id
                FROM embeddings e
                LEFT JOIN knowledge_sources k ON e.source_id = k.id AND e.source_table = 'knowledge_sources'
                {where}
                AND (k.session_id = ? OR e.source_table != 'knowledge_sources')
                """,
                params + [session_id],
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT * FROM embeddings e {where}", params
            ).fetchall()

    results = []
    for row in rows:
        blob = row["embedding"]
        if not blob:
            continue
        try:
            vec = _decode_embedding(blob)
            score = _cosine_similarity(query_vec, vec)
            if score >= threshold:
                results.append({
                    "score":        score,
                    "bm25_score":   0.0,
                    "chunk_text":   row["chunk_text"],
                    "chunk_metadata": row["chunk_metadata"] if "chunk_metadata" in row.keys() else "{}",
                    "source_table": row["source_table"],
                    "source_id":    row["source_id"],
                    "chunk_index":  row["chunk_index"],
                    "created_at":   row["created_at"] if "created_at" in row.keys() else None,
                })
        except Exception:
            continue

    results.sort(key=lambda x: x["score"], reverse=True)
    return _enrich_results(results[:top_k])


def bm25_search(
    query: str,
    top_k: int = TOP_K_DEFAULT,
    source_table: Optional[str] = None,
    session_id: Optional[str] = None,
) -> list[dict]:
    """Busca rápida via FTS5 do SQLite com ordenação por relevância nativa (BM25)."""
    tokens = _tokenize(query)
    if not tokens:
        return []

    # Prepara consulta MATCH
    # Usamos OR para cobrir mais chunks e termos semelhantes
    match_query = " OR ".join(f'"{t}"' for t in tokens)

    conditions = ["fts.chunk_text MATCH ?"]
    params: list = [match_query]

    if source_table:
        conditions.append("e.source_table = ?")
        params.append(source_table)

    where = "WHERE " + " AND ".join(conditions)

    with get_db_connection() as conn:
        if session_id:
            # Filtra fontes de conhecimento da sessão atual ou fontes que não pertencem a knowledge_sources
            rows = conn.execute(
                f"""
                SELECT e.*, fts.rank as fts_rank
                FROM embeddings e
                JOIN embeddings_fts fts ON e.id = fts.rowid
                LEFT JOIN knowledge_sources k
                  ON e.source_id = k.id AND e.source_table = 'knowledge_sources'
                {where}
                AND (k.session_id = ? OR e.source_table != 'knowledge_sources')
                ORDER BY fts.rank
                LIMIT ?
                """,
                params + [session_id, top_k * 4],
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT e.*, fts.rank as fts_rank
                FROM embeddings e
                JOIN embeddings_fts fts ON e.id = fts.rowid
                {where}
                ORDER BY fts.rank
                LIMIT ?
                """,
                params + [top_k * 4],
            ).fetchall()

    if not rows:
        return []

    results = []
    for row in rows:
        # SQLite FTS5 rank: quanto menor/mais negativo, maior a relevância
        rank_val = float(row["fts_rank"] or 0.0)
        bm25_score = min(max(0.01, -rank_val / 10), 1.0) # normaliza para escala [0, 1]

        results.append({
            "score":        0.0,
            "bm25_score":   bm25_score,
            "chunk_text":   row["chunk_text"],
            "chunk_metadata": row["chunk_metadata"] if "chunk_metadata" in row.keys() else "{}",
            "source_table": row["source_table"],
            "source_id":    row["source_id"],
            "chunk_index":  row["chunk_index"],
            "created_at":   row["created_at"] if "created_at" in row.keys() else None,
        })

    # Ordena pelo bm25_score normalizado descendente
    results.sort(key=lambda x: x["bm25_score"], reverse=True)
    return _enrich_results(results[:top_k])


def hybrid_search(
    query: str,
    top_k: int = TOP_K_DEFAULT,
    session_id: Optional[str] = None,
) -> list[dict]:
    """
    Busca híbrida com Query Expansion + RRF + Cognitive Ranking.

    1. Expande a query em variantes
    2. Executa busca semântica + BM25 para cada variante
    3. Funde com RRF
    4. Aplica Cognitive Ranking (6 dimensões de score)
    5. Comprime contexto redundante
    """
    # ── Query Expansion ────────────────────────────────────────────────────
    query_variants = _expand_query(query)

    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}

    def _key(r: dict) -> str:
        return f"{r['source_table']}:{r['source_id']}:{r['chunk_index']}"

    # ── Busca em todas as variantes + RRF ─────────────────────────────────
    for variant in query_variants:
        sem_results  = semantic_search(variant, top_k * 2, session_id=session_id)
        bm25_results = bm25_search(variant, top_k * 2, session_id=session_id)

        for rank, res in enumerate(sem_results):
            k = _key(res)
            scores[k] = scores.get(k, 0) + 1 / (rank + 60)
            # Preserva o score semântico mais alto visto
            if k not in docs or res.get("score", 0) > docs[k].get("score", 0):
                docs[k] = res

        for rank, res in enumerate(bm25_results):
            k = _key(res)
            scores[k] = scores.get(k, 0) + 1 / (rank + 60)
            # Preserva o bm25_score mais alto
            if k in docs:
                docs[k]["bm25_score"] = max(docs[k].get("bm25_score", 0), res.get("bm25_score", 0))
            else:
                docs[k] = res

    # ── Cognitive Ranking ─────────────────────────────────────────────────
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    candidates = [docs[k] for k, _ in ranked[:top_k * 3]]

    # Aplica score cognitivo composto
    for doc in candidates:
        doc["_cognitive_score"] = _cognitive_rank_score(doc)

    candidates.sort(key=lambda x: x["_cognitive_score"], reverse=True)
    top = candidates[:top_k]

    # ── Context Compression ───────────────────────────────────────────────
    compressed = _compress_context(top)

    # Remove campo interno antes de retornar
    for d in compressed:
        d.pop("_cognitive_score", None)

    return compressed


def _cognitive_rank_score(doc: dict) -> float:
    """
    Score cognitivo composto de 6 dimensões:
      Semantic × 0.35 + BM25 × 0.20 + Freshness × 0.15 +
      Importance × 0.15 + Graph × 0.10 + Usage × 0.05
    """
    semantic   = doc.get("score", 0.0)
    bm25       = doc.get("bm25_score", 0.0)
    freshness  = _freshness_score(doc.get("created_at"))
    importance = doc.get("importance", 0.5)
    graph      = min(doc.get("graph_connections", 0) / 10.0, 1.0)
    usage      = min(doc.get("access_count", 0) / 20.0, 1.0)

    return (
        W_SEMANTIC   * semantic   +
        W_BM25       * bm25       +
        W_FRESHNESS  * freshness  +
        W_IMPORTANCE * importance +
        W_GRAPH      * graph      +
        W_USAGE      * usage
    )


# ═══════════════════════════════════════════════════════════════════════════════
# CODE SEARCH ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

def code_search(
    query: str,
    language: Optional[str] = None,
    top_k: int = 6,
) -> list[dict]:
    """
    Busca especializada para código fonte.
    Filtra chunks com metadados de código e prioriza por linguagem.

    Exemplos de uso:
      code_search("autenticação")           → chunks com auth/jwt/login
      code_search("login", language="python") → só em Python
      code_search("useState")               → hooks React
    """
    tokens = _tokenize(query)
    if not tokens:
        return []

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM embeddings WHERE length(chunk_text) > 0"
        ).fetchall()

    code_rows = []
    for row in rows:
        meta_raw = None
        try:
            meta_raw = row["chunk_metadata"]
        except (IndexError, KeyError):
            pass

        if meta_raw:
            meta = json_loads(meta_raw, fallback={})
            if not meta.get("is_code"):
                continue
            if language and meta.get("language") != language:
                continue
        else:
            # Fallback: detecta em tempo real
            meta = _extract_code_metadata(row["chunk_text"])
            if not meta["is_code"]:
                continue
            if language and meta.get("language") != language:
                continue

        # Score: BM25 + bônus por match em entidades de código
        text  = row["chunk_text"].lower()
        score = sum(text.count(t) for t in tokens)

        # Bônus por match em nome de função/classe/hook
        for entity_type in ("functions", "classes", "hooks", "endpoints"):
            entities = meta.get(entity_type, [])
            for ent in entities:
                if any(t in ent.lower() for t in tokens):
                    score += 5  # bônus forte por match estrutural

        if score > 0:
            code_rows.append({
                "score":        min(score / 10, 1.0),
                "bm25_score":   min(score / 10, 1.0),
                "chunk_text":   row["chunk_text"],
                "chunk_metadata": row["chunk_metadata"] if "chunk_metadata" in row.keys() else "{}",
                "source_table": row["source_table"],
                "source_id":    row["source_id"],
                "chunk_index":  row["chunk_index"],
                "created_at":   row["created_at"] if "created_at" in row.keys() else None,
                "code_meta":    meta,
            })

    code_rows.sort(key=lambda x: x["score"], reverse=True)
    return _enrich_results(code_rows[:top_k])


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXTO RAG FORMATADO (API pública — assinatura preservada)
# ═══════════════════════════════════════════════════════════════════════════════

def build_rag_context(
    query: str,
    session_id: Optional[str] = None,
    top_k: int = 6,
) -> str:
    """
    Retorna contexto formatado com citações de origem para injetar no prompt.
    Aplica: hybrid_search → cognitive ranking → context compression.
    """
    core_context = _core_memory_context(query, limit=4)
    results = hybrid_search(query, top_k=top_k, session_id=session_id)
    metadata_matches = _metadata_search(query, session_id=session_id, top_k=2)
    if metadata_matches:
        existing = {
            f"{res.get('source_table')}:{res.get('source_id')}:{res.get('chunk_index')}"
            for res in results
        }
        for item in metadata_matches:
            key = f"{item.get('source_table')}:{item.get('source_id')}:{item.get('chunk_index')}"
            if key not in existing:
                results.append(item)
                existing.add(key)
        results = results[:top_k]
    if not results:
        # Fallback: busca de código se a query parece técnica
        if any(kw in query.lower() for kw in ["função", "function", "def ", "class ", "import", "codigo", "código"]):
            results = code_search(query, top_k=top_k)

    codebase_context = _codebase_context(query, top_k=4)

    if not results:
        fallback_lines = [part for part in (core_context, codebase_context) if part]
        return "\n\n".join(fallback_lines)

    lines = []
    if core_context:
        lines.append(core_context)

    lines.append("Trechos relevantes da base de conhecimento (use como contexto prioritário):")
    for i, res in enumerate(results, 1):
        source_label = res.get("source_label", f"Fonte #{res['source_id']}")
        freshness    = _freshness_score(res.get("created_at"))
        freshness_tag = " ★Recente" if freshness >= 0.9 else ""
        lines.append(f"\n[Fonte {i} — {source_label}{freshness_tag}]")
        source_topics = res.get("source_topics") or []
        source_summary = res.get("source_summary") or ""
        chunk_trace = res.get("chunk_trace") or ""
        if chunk_trace:
            lines.append(f"Localização: {chunk_trace}")
        if source_topics:
            lines.append(f"Tópicos da fonte: {', '.join(source_topics[:8])}")
        if source_summary:
            lines.append(f"Resumo da fonte: {source_summary[:500]}")
        lines.append(res["chunk_text"])

    lines.append(
        "\nInstrução: use os trechos acima quando pertinentes. "
        "Cite a fonte entre colchetes (ex: [Fonte 1]). "
        "Não invente informações além do que está nesses trechos."
    )

    if codebase_context:
        lines.append(codebase_context)

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower())
    stop = {"que", "voce", "você", "sobre", "qual", "quais", "como", "para", "com", "uma", "das", "dos"}
    return [w for w in clean.split() if len(w) > 2 and w not in stop]


def _core_memory_context(query: str, limit: int = 4) -> str:
    """Monta contexto prioritário com Core Memories protegidas."""
    tokens = set(_tokenize(query))
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM memories
            WHERE COALESCE(is_core, 0) = 1
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY importance DESC, last_accessed DESC
            LIMIT 24
            """,
            (now_iso(),),
        ).fetchall()

    scored = []
    for row in rows:
        content = row["content"] or ""
        tags = _parse_topics(row["tags"])
        signal = f"{content} {' '.join(tags)}".lower()
        overlap = sum(1 for token in tokens if token in signal)
        scored.append((overlap, row, tags))

    scored.sort(key=lambda item: (item[0], item[1]["importance"]), reverse=True)
    picked = scored[:limit]
    if not picked:
        return ""

    lines = ["Core Memories confirmadas (prioridade máxima, não contradizer sem evidência explícita):"]
    for index, (_, row, tags) in enumerate(picked, 1):
        tag_text = f" Tags: {', '.join(tags[:5])}." if tags else ""
        lines.append(f"[Core {index}] {row['content']}{tag_text}")
    return "\n".join(lines)


def _looks_like_code_query(query: str) -> bool:
    lower = (query or "").lower()
    return any(term in lower for term in [
        "função", "funcao", "function", "classe", "class", "arquivo", "rota",
        "endpoint", "hook", "componente", "component", "import", "onde está",
        "onde esta", "login", "api", "bug", "erro", "código", "codigo",
    ])


def _codebase_context(query: str, top_k: int = 4) -> str:
    """Busca no índice da codebase quando a pergunta parece técnica."""
    if not _looks_like_code_query(query):
        return ""

    try:
        from cognitive import codebase_indexer
        results = codebase_indexer.search_codebase(query, limit=top_k)
    except Exception:
        return ""

    if not results:
        return ""

    lines = ["\nTrechos do índice de codebase (use para perguntas sobre arquivos, funções e arquitetura):"]
    for index, item in enumerate(results, 1):
        symbol = f"::{item.get('symbol_name')}" if item.get("symbol_name") else ""
        language = item.get("language") or "texto"
        summary = item.get("summary") or ""
        lines.append(f"[Código {index}] {item.get('relative_path')}{symbol} ({language}) — {summary}")
        details = []
        for key, label in (("functions", "Funções"), ("classes", "Classes"), ("hooks", "Hooks"), ("routes", "Rotas")):
            values = item.get(key) or []
            if values:
                details.append(f"{label}: {', '.join(values[:8])}")
        if details:
            lines.append("; ".join(details))
    return "\n".join(lines)


def _parse_topics(raw) -> list[str]:
    """Aceita tópicos salvos como JSON novo ou texto antigo separado por vírgulas."""
    if isinstance(raw, list):
        return [str(topic).strip() for topic in raw if str(topic).strip()]
    text = str(raw or "").strip()
    if not text:
        return []
    parsed = json_loads(text, fallback=None)
    if isinstance(parsed, list):
        return [str(topic).strip() for topic in parsed if str(topic).strip()]
    return [topic.strip() for topic in text.split(",") if topic.strip()]


def _parse_chunk_metadata(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    parsed = json_loads(str(raw or "{}"), fallback={})
    return parsed if isinstance(parsed, dict) else {}


def _format_chunk_trace(metadata: dict) -> str:
    parts = []
    template = metadata.get("template")
    section = metadata.get("section_title")
    kind = metadata.get("chunk_kind")
    start = metadata.get("char_start")
    end = metadata.get("char_end")

    if section:
        parts.append(f"seção '{section}'")
    if template:
        parts.append(f"template {template}")
    if kind and kind != "text":
        parts.append(f"tipo {kind}")
    if isinstance(start, int) and isinstance(end, int) and end >= start:
        parts.append(f"caracteres {start}-{end}")

    return "; ".join(parts)


def _metadata_search(query: str, session_id: Optional[str], top_k: int = 2) -> list[dict]:
    """Busca por título, tópico e resumo da fonte para perguntas vagas sobre PDFs/arquivos."""
    if not session_id:
        return []

    tokens = _tokenize(query)
    if not tokens:
        return []

    query_lower = (query or "").lower()
    is_vague = len(tokens) <= 5 or any(term in query_lower for term in _VAGUE_QUERY_TERMS)

    with get_db_connection() as conn:
        sources = conn.execute(
            """
            SELECT id, title, source_type, source_name, summary, content, topics, created_at
            FROM knowledge_sources
            WHERE session_id=?
            ORDER BY id DESC
            LIMIT 12
            """,
            (session_id,),
        ).fetchall()

    scored = []
    for source in sources:
        topics = _parse_topics(source["topics"])
        signal = " ".join([
            source["title"] or "",
            source["source_name"] or "",
            source["summary"] or "",
            " ".join(topics),
        ]).lower()
        score = sum(signal.count(token) for token in tokens)
        if is_vague and any(word in signal for word in tokens):
            score += 2
        if is_vague and score == 0:
            score = 0.25
        if score <= 0:
            continue

        content = re.sub(r"\s+", " ", source["content"] or "").strip()
        chunk_text = content[:900]
        if not chunk_text:
            continue
        scored.append({
            "score": min(score / 6, 1.0),
            "bm25_score": min(score / 6, 1.0),
            "chunk_text": chunk_text,
            "source_table": "knowledge_sources",
            "source_id": source["id"],
            "chunk_index": 0,
            "created_at": source["created_at"],
            "source_label": source["title"] or source["source_name"] or "Documento",
            "source_type": source["source_type"],
            "source_summary": source["summary"] or "",
            "source_topics": topics,
            "importance": min(0.5 + len(topics) * 0.05, 0.95),
            "graph_connections": 0,
            "access_count": 0,
        })

    scored.sort(key=lambda item: (item["score"], _freshness_score(item.get("created_at"))), reverse=True)
    return scored[:top_k]


def _enrich_results(results: list[dict]) -> list[dict]:
    """
    Adiciona metadados da fonte (título, importância, access_count, relações no KG)
    para alimentar o Cognitive Ranking.
    """
    if not results:
        return results

    ids_by_table: dict[str, list[int]] = {}
    for r in results:
        ids_by_table.setdefault(r["source_table"], []).append(r["source_id"])

    meta: dict[str, dict] = {}

    with get_db_connection() as conn:
        for table, ids in ids_by_table.items():
            placeholders = ",".join("?" * len(ids))
            if table == "knowledge_sources":
                rows = conn.execute(
                    f"""
                    SELECT id, title, source_type, source_name, summary, topics, created_at
                    FROM knowledge_sources WHERE id IN ({placeholders})
                    """,
                    ids,
                ).fetchall()
                for row in rows:
                    topics = _parse_topics(row["topics"])
                    importance = min(0.4 + len(topics) * 0.05, 0.95)
                    meta[f"knowledge_sources:{row['id']}"] = {
                        "source_label":       row["title"] or row["source_name"] or "Documento",
                        "source_type":        row["source_type"],
                        "source_summary":     row["summary"] or "",
                        "source_topics":      topics,
                        "importance":         importance,
                        "created_at":         row["created_at"],
                        "graph_connections":  0,
                        "access_count":       0,
                    }
            elif table == "memories":
                rows = conn.execute(
                    f"""
                    SELECT id, memory_type, tags, importance, access_count, created_at
                    FROM memories WHERE id IN ({placeholders})
                    """,
                    ids,
                ).fetchall()
                for row in rows:
                    meta[f"memories:{row['id']}"] = {
                        "source_label":       f"Memória ({row['memory_type']})",
                        "source_type":        "memory",
                        "importance":         row["importance"] or 0.5,
                        "created_at":         row["created_at"],
                        "graph_connections":  0,
                        "access_count":       row["access_count"] or 0,
                    }

        # Conta conexões no KG para calcular graph_score
        try:
            for key, data in meta.items():
                label = data.get("source_label", "")
                if label:
                    row = conn.execute(
                        """
                        SELECT COUNT(*) as n FROM kg_relations r
                        JOIN kg_entities e ON (r.source_id = e.id OR r.target_id = e.id)
                        WHERE e.name LIKE ?
                        """,
                        (f"%{label[:20]}%",),
                    ).fetchone()
                    data["graph_connections"] = row["n"] if row else 0
        except Exception:
            pass

    for r in results:
        key = f"{r['source_table']}:{r['source_id']}"
        enriched = meta.get(key, {
            "source_label":       f"#{r['source_id']}",
            "source_type":        r["source_table"],
            "importance":         0.5,
            "created_at":         r.get("created_at"),
            "graph_connections":  0,
            "access_count":       0,
        })
        r.update(enriched)
        chunk_meta = _parse_chunk_metadata(r.get("chunk_metadata"))
        if chunk_meta:
            r["chunk_meta"] = chunk_meta
            r["chunk_trace"] = _format_chunk_trace(chunk_meta)

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# STATS
# ═══════════════════════════════════════════════════════════════════════════════

def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as n FROM embeddings").fetchone()["n"]
        with_vec = conn.execute(
            "SELECT COUNT(*) as n FROM embeddings WHERE length(embedding) > 0"
        ).fetchone()["n"]
        by_table = conn.execute(
            "SELECT source_table, COUNT(*) as n FROM embeddings GROUP BY source_table"
        ).fetchall()
        try:
            code_chunks = conn.execute(
                "SELECT COUNT(*) as n FROM embeddings WHERE chunk_metadata LIKE '%\"is_code\": true%'"
            ).fetchone()["n"]
        except Exception:
            code_chunks = 0
        try:
            cache_rows = conn.execute("SELECT COUNT(*) as n FROM ingestion_cache").fetchone()["n"]
        except Exception:
            cache_rows = 0
        try:
            template_rows = conn.execute(
                """
                SELECT
                  json_extract(chunk_metadata, '$.template') AS template,
                  COUNT(*) AS n
                FROM embeddings
                WHERE chunk_metadata IS NOT NULL AND chunk_metadata != ''
                GROUP BY template
                """
            ).fetchall()
        except Exception:
            template_rows = []

    with _EMBED_CACHE_LOCK:
        cache_size = len(_EMBED_CACHE)

    return {
        "total_chunks":        total,
        "chunks_with_embeddings": with_vec,
        "code_chunks":         code_chunks,
        "semantic_enabled":    _SEMANTIC_ENABLED,
        "semantic_available":  _EMBEDDING_AVAILABLE,
        "embed_cache_entries": cache_size,
        "ingestion_cache_entries": cache_rows,
        "pipeline_key":        _pipeline_key()[:12],
        "by_template":         {
            (row["template"] or "unknown"): row["n"]
            for row in template_rows
        },
        "by_source":           {row["source_table"]: row["n"] for row in by_table},
    }
