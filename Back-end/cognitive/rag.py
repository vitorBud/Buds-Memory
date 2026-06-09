"""
cognitive/rag.py — RAG Avançado do Nexus IA.

Implementa:
  - Chunking inteligente (preserva parágrafos e código)
  - Embeddings locais via sentence-transformers (com fallback BM25)
  - Busca semântica por cosine similarity
  - Busca híbrida: semântica + BM25 com reranking
  - Contexto formatado com citações de origem

O módulo funciona mesmo sem sentence-transformers instalado,
usando BM25 puro como fallback — sem dependências obrigatórias novas.
"""

from __future__ import annotations

import re
import struct
import math
import os
from typing import Optional
from database_v2 import get_db_connection, now_iso

# ── Embeddings opcionais ─────────────────────────────────────────────────────
_EMBEDDING_MODEL = None
_EMBEDDING_AVAILABLE = False
_EMBEDDING_LOAD_ATTEMPTED = False
_SEMANTIC_ENABLED = os.getenv("NEXUS_ENABLE_SEMANTIC_RAG", "0").lower() in {"1", "true", "yes", "sim"}
_MODEL_NAME = os.getenv("NEXUS_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")


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

# ── Parâmetros de chunking ────────────────────────────────────────────────────
CHUNK_SIZE = 512        # caracteres (aprox. 128 tokens)
CHUNK_OVERLAP = 64
MIN_CHUNK_LEN = 80
TOP_K_DEFAULT = 8
SIMILARITY_THRESHOLD = 0.45


# ── Chunking ─────────────────────────────────────────────────────────────────

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

    # Separa blocos de código
    segments: list[tuple[str, bool]] = []  # (text, is_code)
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

        # Divide por parágrafo
        paras = [p.strip() for p in re.split(r"\n{2,}", segment) if p.strip()]
        buffer = ""
        for para in paras:
            if len(buffer) + len(para) <= chunk_size:
                buffer = (buffer + "\n\n" + para).strip()
            else:
                if len(buffer) >= MIN_CHUNK_LEN:
                    chunks.append(buffer)
                # Parágrafo muito longo → divide por sentença
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


# ── Embeddings ───────────────────────────────────────────────────────────────

def _embed(text: str) -> Optional[bytes]:
    model = _get_embedding_model()
    if model is None:
        return None
    try:
        vec = model.encode(text, normalize_embeddings=True)
        return struct.pack(f"{len(vec)}f", *vec.tolist())
    except Exception as e:
        print(f"[RAG] Erro ao gerar embedding: {e}")
        return None


def _decode_embedding(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    # Vetores já normalizados → ||a|| = ||b|| = 1
    return dot


# ── Indexação ────────────────────────────────────────────────────────────────

def index_document(
    knowledge_source_id: int,
    content: str,
    source_table: str = "knowledge_sources",
) -> int:
    """
    Chunkeia o conteúdo e gera embeddings para cada chunk.
    Retorna número de chunks indexados.
    """
    # Remove embeddings antigos desta fonte
    with get_db_connection() as conn:
        conn.execute(
            "DELETE FROM embeddings WHERE source_table=? AND source_id=?",
            (source_table, knowledge_source_id),
        )
        conn.commit()

    chunks = chunk_text(content)
    if not chunks:
        return 0

    ts = now_iso()
    rows = []
    for i, chunk in enumerate(chunks):
        emb_blob = _embed(chunk)
        if emb_blob is None:
            # Sem embedding: salva sem vetor (BM25 ainda funciona)
            emb_blob = b""
        rows.append((source_table, knowledge_source_id, i, chunk, emb_blob, ts))

    with get_db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO embeddings
              (source_table, source_id, chunk_index, chunk_text, embedding, created_at)
            VALUES (?,?,?,?,?,?)
            """,
            rows,
        )
        conn.commit()

    return len(chunks)


def index_all_knowledge(session_id: Optional[str] = None) -> dict:
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
    for row in rows:
        total_chunks += index_document(row["id"], row["content"])

    return {"indexed": len(rows), "total_chunks": total_chunks}


# ── Busca ─────────────────────────────────────────────────────────────────────

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
        # Filtra por session_id via JOIN com knowledge_sources se necessário
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
                    "score": score,
                    "chunk_text": row["chunk_text"],
                    "source_table": row["source_table"],
                    "source_id": row["source_id"],
                    "chunk_index": row["chunk_index"],
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
    """BM25 simplificado sobre os chunks de texto."""
    tokens = _tokenize(query)
    if not tokens:
        return []

    conditions = []
    params: list = []

    if source_table:
        conditions.append("source_table = ?")
        params.append(source_table)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM embeddings {where}", params
        ).fetchall()

    if not rows:
        return []

    # BM25 simplificado
    avg_len = sum(len(r["chunk_text"]) for r in rows) / len(rows)
    k1, b = 1.5, 0.75
    scored = []
    for row in rows:
        text = row["chunk_text"].lower()
        text_len = len(text)
        score = 0.0
        for token in tokens:
            tf = text.count(token)
            if tf == 0:
                continue
            idf = math.log((len(rows) + 1) / (sum(1 for r in rows if token in r["chunk_text"].lower()) + 0.5))
            score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * text_len / avg_len))
        if score > 0:
            scored.append({
                "score": min(score / 10, 1.0),
                "chunk_text": row["chunk_text"],
                "source_table": row["source_table"],
                "source_id": row["source_id"],
                "chunk_index": row["chunk_index"],
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return _enrich_results(scored[:top_k])


def hybrid_search(
    query: str,
    top_k: int = TOP_K_DEFAULT,
    session_id: Optional[str] = None,
) -> list[dict]:
    """
    Combina resultados semânticos + BM25 com fusão de scores (RRF).
    """
    sem_results = semantic_search(query, top_k * 2, session_id=session_id)
    bm25_results = bm25_search(query, top_k * 2, session_id=session_id)

    # Reciprocal Rank Fusion
    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}

    def _key(r: dict) -> str:
        return f"{r['source_table']}:{r['source_id']}:{r['chunk_index']}"

    for rank, res in enumerate(sem_results):
        k = _key(res)
        scores[k] = scores.get(k, 0) + 1 / (rank + 60)
        docs[k] = res

    for rank, res in enumerate(bm25_results):
        k = _key(res)
        scores[k] = scores.get(k, 0) + 1 / (rank + 60)
        docs[k] = res

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [docs[k] for k, _ in ranked[:top_k]]


# ── Contexto RAG formatado ─────────────────────────────────────────────────--

def build_rag_context(
    query: str,
    session_id: Optional[str] = None,
    top_k: int = 6,
) -> str:
    """
    Retorna contexto formatado com citações de origem para injetar no prompt.
    """
    results = hybrid_search(query, top_k=top_k, session_id=session_id)
    if not results:
        return ""

    lines = [
        "Trechos relevantes da base de conhecimento (use como contexto prioritário):",
    ]
    for i, res in enumerate(results, 1):
        source_label = res.get("source_label", f"Fonte #{res['source_id']}")
        lines.append(f"\n[Fonte {i} — {source_label}]")
        lines.append(res["chunk_text"])

    lines.append(
        "\nInstrução: use os trechos acima quando pertinentes. "
        "Cite a fonte entre colchetes (ex: [Fonte 1]). "
        "Não invente informações além do que está nesses trechos."
    )
    return "\n".join(lines)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower())
    return [w for w in clean.split() if len(w) > 2]


def _enrich_results(results: list[dict]) -> list[dict]:
    """Adiciona metadados da fonte (título, etc.) ao resultado."""
    if not results:
        return results

    # Agrupa por (source_table, source_id) para buscar metadados em lote
    ids_by_table: dict[str, list[int]] = {}
    for r in results:
        ids_by_table.setdefault(r["source_table"], []).append(r["source_id"])

    meta: dict[str, dict] = {}

    with get_db_connection() as conn:
        for table, ids in ids_by_table.items():
            placeholders = ",".join("?" * len(ids))
            if table == "knowledge_sources":
                rows = conn.execute(
                    f"SELECT id, title, source_type, source_name FROM knowledge_sources WHERE id IN ({placeholders})",
                    ids,
                ).fetchall()
                for row in rows:
                    meta[f"knowledge_sources:{row['id']}"] = {
                        "source_label": row["title"] or row["source_name"] or "Documento",
                        "source_type": row["source_type"],
                    }
            elif table == "memories":
                rows = conn.execute(
                    f"SELECT id, memory_type, tags FROM memories WHERE id IN ({placeholders})",
                    ids,
                ).fetchall()
                for row in rows:
                    meta[f"memories:{row['id']}"] = {
                        "source_label": f"Memória ({row['memory_type']})",
                        "source_type": "memory",
                    }

    for r in results:
        key = f"{r['source_table']}:{r['source_id']}"
        r.update(meta.get(key, {"source_label": f"#{r['source_id']}", "source_type": r["source_table"]}))

    return results


def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as n FROM embeddings").fetchone()["n"]
        with_vec = conn.execute(
            "SELECT COUNT(*) as n FROM embeddings WHERE length(embedding) > 0"
        ).fetchone()["n"]
        by_table = conn.execute(
            "SELECT source_table, COUNT(*) as n FROM embeddings GROUP BY source_table"
        ).fetchall()
    return {
        "total_chunks": total,
        "chunks_with_embeddings": with_vec,
        "semantic_enabled": _SEMANTIC_ENABLED,
        "semantic_available": _EMBEDDING_AVAILABLE,
        "by_source": {row["source_table"]: row["n"] for row in by_table},
    }
