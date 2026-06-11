"""
cognitive/memory.py — Sistema de memória hierárquica do Nexus IA.

Três níveis:
  - short   → expira em 24 horas (contexto da sessão)
  - medium  → expira em 30–90 dias (conhecimentos recentes)
  - long    → permanente (aprendizados consolidados)

A importância de cada memória determina se ela sobe de nível
no processo de consolidação.
"""

from __future__ import annotations

import json
import re
from typing import Optional
from database_v2 import get_db_connection, now_iso, iso_from_delta, json_dumps, json_loads


# ── Constantes de expiração ──────────────────────────────────────────────────

SHORT_TERM_HOURS = 24
MEDIUM_TERM_DAYS_MIN = 30
MEDIUM_TERM_DAYS_MAX = 90
CONSOLIDATION_THRESHOLD = 0.65  # importância mínima para short→medium

# Limites mínimos para salvar (filtro de segurança)
MIN_CONTENT_LENGTH = 15   # número mínimo de caracteres no conteúdo
MIN_SHORT_IMPORTANCE  = 0.20   # importância mínima para short-term
MIN_MEDIUM_IMPORTANCE = 0.40   # importância mínima para medium-term
MIN_LONG_IMPORTANCE   = 0.65   # importância mínima para long-term


# ── Escrita ──────────────────────────────────────────────────────────────────

def save_memory(
    content: str,
    memory_type: str = "short",
    session_id: Optional[str] = None,
    importance: float = 0.5,
    tags: Optional[list] = None,
) -> dict:
    """Salva uma memória no nível indicado com expiração automática."""
    tags = tags or []
    expires_at = _compute_expiry(memory_type, importance)

    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO memories
              (session_id, content, memory_type, importance, last_accessed, expires_at, tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (session_id, content, memory_type, importance, now_iso(), expires_at,
             json_dumps(tags), now_iso()),
        )
        conn.commit()
        row_id = cursor.lastrowid

    return {"id": row_id, "memory_type": memory_type, "content": content,
            "importance": importance, "tags": tags, "expires_at": expires_at}


def save_short_term(content: str, session_id: Optional[str] = None,
                    importance: float = 0.4, tags: Optional[list] = None) -> Optional[dict]:
    """Salva memória de curto prazo. Descarta conteúdo vazio ou pouco relevante."""
    if len((content or "").strip()) < MIN_CONTENT_LENGTH:
        return None
    if importance < MIN_SHORT_IMPORTANCE:
        return None
    return save_memory(content, "short", session_id, importance, tags)


def save_medium_term(content: str, session_id: Optional[str] = None,
                     importance: float = 0.6, tags: Optional[list] = None) -> Optional[dict]:
    """Salva memória de médio prazo. Exige importância mínima de 0.40."""
    if len((content or "").strip()) < MIN_CONTENT_LENGTH:
        return None
    if importance < MIN_MEDIUM_IMPORTANCE:
        return None
    return save_memory(content, "medium", session_id, importance, tags)


def save_long_term(content: str, session_id: Optional[str] = None,
                   importance: float = 0.85, tags: Optional[list] = None) -> Optional[dict]:
    """Salva memória permanente. Exige importância mínima de 0.65."""
    if len((content or "").strip()) < MIN_CONTENT_LENGTH:
        return None
    if importance < MIN_LONG_IMPORTANCE:
        return None
    return save_memory(content, "long", session_id, importance, tags)


# ── Leitura e Recall ─────────────────────────────────────────────────────────

def get_memories(
    memory_types: Optional[list] = None,
    session_id: Optional[str] = None,
    tags: Optional[list] = None,
    include_expired: bool = False,
    limit: int = 50,
) -> list[dict]:
    """Lista memórias com filtros opcionais."""
    conditions = []
    params: list = []

    if not include_expired:
        conditions.append("(expires_at IS NULL OR expires_at > ?)")
        params.append(now_iso())

    if memory_types:
        placeholders = ",".join("?" * len(memory_types))
        conditions.append(f"memory_type IN ({placeholders})")
        params.extend(memory_types)

    if session_id:
        conditions.append("session_id = ?")
        params.append(session_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM memories
            {where}
            ORDER BY importance DESC, last_accessed DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    memories = [_row_to_dict(row) for row in rows]

    if tags:
        tag_set = {t.lower() for t in tags}
        memories = [m for m in memories
                    if tag_set.intersection({t.lower() for t in m.get("tags", [])})]

    return memories


def recall(query: str, memory_types: Optional[list] = None, limit: int = 8) -> list[dict]:
    """
    Recupera memórias relevantes para uma consulta.
    Usa correspondência de termos simples (tokens) — o RAG semântico
    complementa isso via rag.py.
    """
    tokens = _tokenize(query)
    if not tokens:
        return get_memories(memory_types=memory_types, limit=limit)

    candidates = get_memories(memory_types=memory_types, include_expired=False, limit=500)

    scored = []
    for mem in candidates:
        score = _text_score(mem["content"] + " " + " ".join(mem.get("tags", [])), tokens)
        if score > 0:
            scored.append((score * 0.6 + mem["importance"] * 0.4, mem))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Registra acesso nas memórias retornadas
    top = [m for _, m in scored[:limit]]
    _bump_access([m["id"] for m in top])

    return top


# ── Consolidação ─────────────────────────────────────────────────────────────

def consolidate_session(session_id: str) -> dict:
    """
    Ao final de uma sessão, eleva memórias short→medium e medium→long
    baseado na importância.
    Retorna contagem de memórias promovidas.
    """
    promoted = {"short_to_medium": 0, "medium_to_long": 0}

    with get_db_connection() as conn:
        # short → medium
        rows = conn.execute(
            """
            SELECT id, importance FROM memories
            WHERE session_id = ? AND memory_type = 'short' AND importance >= ?
            """,
            (session_id, CONSOLIDATION_THRESHOLD),
        ).fetchall()

        for row in rows:
            new_expires = iso_from_delta(days=_medium_days(row["importance"]))
            conn.execute(
                "UPDATE memories SET memory_type='medium', expires_at=? WHERE id=?",
                (new_expires, row["id"]),
            )
            promoted["short_to_medium"] += 1

        # medium → long (importância muito alta)
        rows = conn.execute(
            """
            SELECT id FROM memories
            WHERE session_id = ? AND memory_type = 'medium' AND importance >= 0.85
            """,
            (session_id,),
        ).fetchall()

        for row in rows:
            conn.execute(
                "UPDATE memories SET memory_type='long', expires_at=NULL WHERE id=?",
                (row["id"],),
            )
            promoted["medium_to_long"] += 1

        conn.commit()

    return promoted


def prune_expired() -> int:
    """Remove memórias expiradas. Retorna quantas foram removidas."""
    with get_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?",
            (now_iso(),),
        )
        conn.commit()
        return cursor.rowcount


def get_stats() -> dict:
    with get_db_connection() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN memory_type = 'short'  THEN 1 ELSE 0 END) as short_count,
                SUM(CASE WHEN memory_type = 'medium' THEN 1 ELSE 0 END) as medium_count,
                SUM(CASE WHEN memory_type = 'long'   THEN 1 ELSE 0 END) as long_count,
                AVG(importance) as avg_importance
            FROM memories
            WHERE expires_at IS NULL OR expires_at > ?
        """, (now_iso(),)).fetchone()
    return dict(row) if row else {}


# ── Helpers internos ─────────────────────────────────────────────────────────

def _compute_expiry(memory_type: str, importance: float) -> Optional[str]:
    if memory_type == "long":
        return None
    if memory_type == "medium":
        days = _medium_days(importance)
        return iso_from_delta(days=days)
    # short
    return iso_from_delta(hours=SHORT_TERM_HOURS)


def _medium_days(importance: float) -> int:
    """Quanto mais importante, mais tempo na memória média."""
    return int(MEDIUM_TERM_DAYS_MIN + (MEDIUM_TERM_DAYS_MAX - MEDIUM_TERM_DAYS_MIN) * importance)


def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower())
    return [w for w in clean.split() if len(w) > 3]


def _text_score(text: str, tokens: list[str]) -> float:
    lower = text.lower()
    return sum(lower.count(t) for t in tokens)


def _bump_access(ids: list[int]):
    if not ids:
        return
    with get_db_connection() as conn:
        placeholders = ",".join("?" * len(ids))
        conn.execute(
            f"UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN ({placeholders})",
            [now_iso()] + ids,
        )
        conn.commit()


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["tags"] = json_loads(d.get("tags") or "[]", fallback=[])
    return d
