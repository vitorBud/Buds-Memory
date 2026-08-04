"""
cognitive/search.py — Busca Global Unificada do Buds Memory.

Pesquisa em paralelo em todas as fontes:
  sessions, messages, knowledge_sources, memories,
  projects, timeline_events, kg_entities

Retorna resultados ranqueados por relevância com tipo e contexto de origem.
"""

from __future__ import annotations

import re
import math
from typing import Optional
from database_v2 import get_db_connection, now_iso
from cognitive.utils import freshness_score as _freshness_score


def global_search(query: str, limit: int = 30, session_id: Optional[str] = None) -> dict:
    """
    Busca unificada em todas as tabelas cognitivas.
    Retorna resultados agrupados por tipo e ordenados por score.
    """
    if not query or not query.strip():
        return {"results": [], "total": 0, "query": query}

    tokens = _tokenize(query)
    if not tokens:
        return {"results": [], "total": 0, "query": query}

    all_results: list[dict] = []

    all_results.extend(_search_sessions(tokens, limit))
    all_results.extend(_search_messages(tokens, limit, session_id))
    all_results.extend(_search_knowledge_sources(tokens, limit))
    all_results.extend(_search_memories(tokens, limit))
    all_results.extend(_search_projects(tokens, limit))
    all_results.extend(_search_timeline(tokens, limit))
    all_results.extend(_search_kg_entities(tokens, limit))

    # Reranking global: normaliza scores + deduplica por conteúdo
    seen_contents: set[str] = set()
    deduped = []
    for r in sorted(all_results, key=lambda x: x["score"], reverse=True):
        fingerprint = r["content"][:80].lower()
        if fingerprint not in seen_contents:
            seen_contents.add(fingerprint)
            deduped.append(r)

    final = deduped[:limit]

    # Agrupa por tipo para o front-end
    grouped: dict[str, list] = {}
    for r in final:
        grouped.setdefault(r["type"], []).append(r)

    return {
        "results": final,
        "grouped": grouped,
        "total": len(final),
        "query": query,
        "tokens": tokens,
    }


# ── Pesquisas por tabela ──────────────────────────────────────────────────────

def _search_sessions(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at FROM sessions ORDER BY created_at DESC LIMIT 200"
        ).fetchall()

    results = []
    for row in rows:
        base = _score(row["title"], tokens, weight=1.2)
        if base > 0:
            freshness = _freshness_score(row["created_at"])
            results.append({
                "type": "session",
                "id": row["id"],
                "title": row["title"],
                "content": row["title"],
                "score": base * 0.80 + freshness * 0.20,
                "created_at": row["created_at"],
                "meta": {"session_id": row["id"]},
            })
    return _top(results, limit)


def _search_messages(tokens: list[str], limit: int, session_id: Optional[str]) -> list[dict]:
    with get_db_connection() as conn:
        if session_id:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 500",
                (session_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM messages ORDER BY id DESC LIMIT 1000"
            ).fetchall()

    results = []
    for row in rows:
        if row["text"] == "__thinking__":
            continue
        base = _score(row["text"], tokens)
        if base > 0:
            freshness = _freshness_score(row["created_at"])
            snippet = _snippet(row["text"], tokens)
            results.append({
                "type": "message",
                "id": row["id"],
                "title": f"Mensagem ({row['sender']})",
                "content": snippet,
                "score": base * 0.80 + freshness * 0.20,
                "created_at": row["created_at"],
                "meta": {"session_id": row["session_id"], "sender": row["sender"]},
            })
    return _top(results, limit)


def _search_knowledge_sources(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id, session_id, title, summary, source_type, source_name, topics, created_at FROM knowledge_sources ORDER BY id DESC LIMIT 300"
        ).fetchall()

    results = []
    for row in rows:
        haystack = f"{row['title']} {row['summary']} {row['topics']}"
        base = _score(haystack, tokens, weight=1.1)
        if base > 0:
            freshness = _freshness_score(row["created_at"])
            results.append({
                "type": "knowledge",
                "id": row["id"],
                "title": row["title"],
                "content": _snippet(row["summary"], tokens),
                "score": base * 0.75 + freshness * 0.25,
                "created_at": row["created_at"],
                "meta": {
                    "session_id": row["session_id"],
                    "source_type": row["source_type"],
                    "source_name": row["source_name"],
                },
            })
    return _top(results, limit)


def _search_memories(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM memories
            WHERE expires_at IS NULL OR expires_at > ?
            ORDER BY importance DESC LIMIT 300
            """,
            (now_iso(),),
        ).fetchall()

    results = []
    for row in rows:
        score = _score(f"{row['content']} {row['tags']}", tokens, weight=0.9)
        if score > 0:
            results.append({
                "type": "memory",
                "id": row["id"],
                "title": f"Memória ({row['memory_type']})",
                "content": _snippet(row["content"], tokens),
                "score": score * row["importance"],
                "created_at": row["created_at"],
                "meta": {"memory_type": row["memory_type"], "importance": row["importance"]},
            })
    return _top(results, limit)


def _search_projects(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC LIMIT 100"
        ).fetchall()

    results = []
    for row in rows:
        haystack = f"{row['name']} {row['description']} {row['technologies']} {row['tags']}"
        score = _score(haystack, tokens, weight=1.3)
        if score > 0:
            results.append({
                "type": "project",
                "id": row["id"],
                "title": row["name"],
                "content": row["description"] or row["name"],
                "score": score,
                "created_at": row["created_at"],
                "meta": {"status": row["status"]},
            })
    return _top(results, limit)


def _search_timeline(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM timeline_events ORDER BY event_date DESC LIMIT 300"
        ).fetchall()

    results = []
    for row in rows:
        haystack = f"{row['title']} {row['description']} {row['tags']}"
        score = _score(haystack, tokens, weight=1.0)
        if score > 0:
            results.append({
                "type": "timeline",
                "id": row["id"],
                "title": row["title"],
                "content": row["description"] or row["title"],
                "score": score,
                "created_at": row["event_date"],
                "meta": {"event_type": row["event_type"]},
            })
    return _top(results, limit)


def _search_kg_entities(tokens: list[str], limit: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM kg_entities ORDER BY importance DESC LIMIT 300"
        ).fetchall()

    results = []
    for row in rows:
        haystack = f"{row['name']} {row['description']}"
        score = _score(haystack, tokens, weight=0.8)
        if score > 0:
            results.append({
                "type": "concept",
                "id": row["id"],
                "title": row["name"],
                "content": row["description"] or row["name"],
                "score": score * row["importance"],
                "created_at": row["last_seen"],
                "meta": {"entity_type": row["entity_type"]},
            })
    return _top(results, limit)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower())
    return [w for w in clean.split() if len(w) > 2]


def _score(text: str, tokens: list[str], weight: float = 1.0) -> float:
    if not text or not tokens:
        return 0.0
    lower = text.lower()
    raw = sum(lower.count(t) * (1 + math.log(len(t))) for t in tokens)
    return raw * weight


def _snippet(text: str, tokens: list[str], length: int = 180) -> str:
    """Extrai trecho do texto ao redor do primeiro token encontrado."""
    if not text:
        return ""
    lower = text.lower()
    best_pos = -1
    for token in tokens:
        pos = lower.find(token)
        if pos != -1:
            best_pos = pos
            break
    if best_pos == -1:
        return text[:length] + ("..." if len(text) > length else "")
    start = max(0, best_pos - 40)
    end = min(len(text), start + length)
    snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
    return snippet


def _top(results: list[dict], limit: int) -> list[dict]:
    return sorted(results, key=lambda x: x["score"], reverse=True)[:limit]
