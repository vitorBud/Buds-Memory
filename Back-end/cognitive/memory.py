"""
cognitive/memory.py — Sistema de memória hierárquica do Aether Memory.

Três níveis:
  - short   → expira em 24 horas (contexto da sessão)
  - medium  → expira em 30–90 dias (conhecimentos recentes)
  - long    → permanente (aprendizados consolidados)
  - archive → permanente, baixa frequência, só entra sob demanda

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

def _normalize_content(text: str) -> str:
    """Normaliza conteúdo para comparação de duplicatas."""
    import unicodedata
    text = unicodedata.normalize("NFKC", (text or "").strip().lower())
    return re.sub(r"\s+", " ", text)


def save_memory(
    content: str,
    memory_type: str = "short",
    session_id: Optional[str] = None,
    importance: float = 0.5,
    tags: Optional[list] = None,
    is_core: bool = False,
    locked: bool = False,
    user_confirmed: bool = False,
    origin_type: str = "conversation",
    origin_id: Optional[str] = None,
    source_table: Optional[str] = None,
    source_id: Optional[int] = None,
    scope: Optional[str] = None,
) -> dict:
    """Salva uma memória no nível indicado com expiração automática.
    Se uma memória com conteúdo semanticamente idêntico já existir (não expirada),
    incrementa seu access_count em vez de criar duplicata.
    """
    tags = tags or []
    if scope is None:
        is_explicit_global = is_core or user_confirmed or origin_type in {"profile", "manual", "core"}
        scope = "global" if is_explicit_global or not session_id else "conversation"
    if scope not in {"global", "conversation"}:
        raise ValueError("Escopo de memória inválido.")
    if scope == "conversation" and not session_id:
        raise ValueError("Memória de conversa exige session_id.")
    if is_core:
        memory_type = "long"
        locked = True
        user_confirmed = True if user_confirmed is None else user_confirmed
        importance = max(float(importance), 0.95)
    expires_at = None if is_core or locked else _compute_expiry(memory_type, importance)

    # ── Deduplicação por conteúdo normalizado ──────────────────────────────────
    normalized = _normalize_content(content)
    with get_db_connection() as conn:
        existing = conn.execute(
            """
            SELECT id FROM memories
            WHERE LOWER(TRIM(content)) = ?
              AND memory_type = ?
              AND scope = ?
              AND ((? = 'global') OR session_id = ?)
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1
            """,
            (normalized, memory_type, scope, scope, session_id, now_iso()),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE memories SET access_count = access_count + 1, last_accessed = ?, importance = MAX(importance, ?) WHERE id = ?",
                (now_iso(), importance, existing["id"]),
            )
            conn.commit()
            return {"id": existing["id"], "memory_type": memory_type, "content": content,
                    "importance": importance, "tags": tags, "expires_at": expires_at,
                    "is_core": is_core, "locked": locked, "user_confirmed": user_confirmed,
                    "origin_type": origin_type, "origin_id": origin_id,
                    "source_table": source_table, "source_id": source_id,
                    "scope": scope, "session_id": session_id,
                    "_deduplicated": True}

        cursor = conn.execute(
            """
            INSERT INTO memories
              (session_id, scope, content, memory_type, importance, last_accessed, expires_at, tags, created_at,
               is_core, locked, user_confirmed, origin_type, origin_id, source_table, source_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (session_id, scope, content, memory_type, importance, now_iso(), expires_at,
             json_dumps(tags), now_iso(), int(is_core), int(locked), int(user_confirmed),
             origin_type, origin_id, source_table, source_id),
        )
        conn.commit()
        row_id = cursor.lastrowid

    return {"id": row_id, "memory_type": memory_type, "content": content,
            "importance": importance, "tags": tags, "expires_at": expires_at,
            "is_core": is_core, "locked": locked, "user_confirmed": user_confirmed,
            "origin_type": origin_type, "origin_id": origin_id,
            "source_table": source_table, "source_id": source_id,
            "scope": scope, "session_id": session_id}


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


def save_archive(content: str, session_id: Optional[str] = None,
                 importance: float = 0.45, tags: Optional[list] = None) -> Optional[dict]:
    """Salva memória arquivada: persistente, mas de baixa prioridade no contexto."""
    if len((content or "").strip()) < MIN_CONTENT_LENGTH:
        return None
    return save_memory(content, "archive", session_id, importance, tags)


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


def recall(
    query: str,
    memory_types: Optional[list] = None,
    limit: int = 8,
    session_id: Optional[str] = None,
) -> list[dict]:
    """
    Recupera memórias relevantes para uma consulta de forma extremamente rápida.
    Usa tabela virtual memories_fts via FTS5 do SQLite com MATCH e ranking cognitivo.
    """
    tokens = _tokenize(query)
    if not tokens:
        return _context_memories(memory_types, session_id, limit)

    # Prepara consulta MATCH
    # Usamos OR para maior abrangência de busca textual
    match_query = " OR ".join(f'"{t}"' for t in tokens)

    # Filtros de tipo de memória
    type_conditions = []
    params: list = [match_query, now_iso(), session_id, session_id]

    if memory_types:
        placeholders = ",".join("?" * len(memory_types))
        type_conditions.append(f"m.memory_type IN ({placeholders})")
        params.extend(memory_types)

    type_filter = f"AND {' AND '.join(type_conditions)}" if type_conditions else ""
    params.append(limit * 4) # Pega uma quantidade maior de candidatos para re-rankear em Python com o core_boost

    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT m.*, fts.rank as fts_rank FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE fts.content MATCH ?
              AND (m.expires_at IS NULL OR m.expires_at > ?)
              AND (m.scope = 'global' OR (m.scope = 'conversation' AND ? IS NOT NULL AND m.session_id = ?))
              {type_filter}
            LIMIT ?
            """,
            params
        ).fetchall()

    candidates = [_row_to_dict(row) for row in rows]

    # Fallback se não houver candidatos textuais via FTS5
    if not candidates:
        return _context_memories(memory_types, session_id, limit)

    scored = []
    for mem in candidates:
        # No SQLite FTS5, valores de rank mais baixos/negativos são melhores.
        # Normalizamos o fts_rank para um score positivo para a fórmula.
        rank_val = float(mem.get("fts_rank") or 0.0)
        text_score = max(0.1, -rank_val)

        # Boost de tags caso coincida com os tokens da busca
        tag_match_count = sum(1 for t in mem.get("tags", []) if t.lower() in tokens)
        tag_boost = tag_match_count * 0.5

        core_boost = 3.0 if mem.get("is_core") else 0.0
        # Combina relevância do texto, importância intrínseca, tags e se é Core Memory
        final_score = text_score * 0.5 + mem["importance"] * 0.5 + tag_boost + core_boost
        scored.append((final_score, mem))

    scored.sort(key=lambda x: x[0], reverse=True)

    top = [m for _, m in scored[:limit]]

    # Registra acesso nas memórias retornadas
    _bump_access([m["id"] for m in top])

    return top


def _context_memories(memory_types: Optional[list], session_id: Optional[str], limit: int) -> list[dict]:
    """Lista somente fatos globais e contexto da sessão solicitada."""
    conditions = ["(expires_at IS NULL OR expires_at > ?)"]
    params: list = [now_iso()]
    if memory_types:
        placeholders = ",".join("?" * len(memory_types))
        conditions.append(f"memory_type IN ({placeholders})")
        params.extend(memory_types)
    conditions.append("(scope='global' OR (scope='conversation' AND ? IS NOT NULL AND session_id=?))")
    params.extend([session_id, session_id, limit])
    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM memories
            WHERE {' AND '.join(conditions)}
            ORDER BY importance DESC, last_accessed DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


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
            WHERE session_id = ? AND memory_type = 'short' AND importance >= ? AND COALESCE(is_core, 0) = 0
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
            WHERE session_id = ? AND memory_type = 'medium' AND importance >= 0.85 AND COALESCE(is_core, 0) = 0
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
            """
            DELETE FROM memories
            WHERE expires_at IS NOT NULL
              AND expires_at < ?
              AND COALESCE(is_core, 0) = 0
              AND COALESCE(locked, 0) = 0
            """,
            (now_iso(),),
        )
        conn.commit()
        return cursor.rowcount


def archive_stale_memories(days_without_access: int = 90, max_importance: float = 0.55) -> int:
    """
    Move memórias antigas e pouco importantes para Archive Memory.
    Core/locked nunca são arquivadas automaticamente.
    """
    cutoff = iso_from_delta(days=-days_without_access)
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE memories
            SET memory_type='archive', expires_at=NULL
            WHERE memory_type IN ('short', 'medium')
              AND importance <= ?
              AND COALESCE(access_count, 0) <= 1
              AND COALESCE(is_core, 0) = 0
              AND COALESCE(locked, 0) = 0
              AND COALESCE(last_accessed, created_at) < ?
            """,
            (max_importance, cutoff),
        )
        conn.commit()
        return cursor.rowcount


def update_memory(memory_id: int, **updates) -> Optional[dict]:
    """Edita conteúdo, importância, tags, origem e flags de memória."""
    allowed = {
        "content", "memory_type", "importance", "tags", "is_core", "locked",
        "user_confirmed", "origin_type", "origin_id", "source_table", "source_id", "expires_at",
    }
    values = {}
    for key, value in updates.items():
        if key not in allowed:
            continue
        if key in {"is_core", "locked", "user_confirmed"}:
            value = int(bool(value))
        elif key == "tags":
            value = json_dumps(value if isinstance(value, list) else [])
        values[key] = value

    if not values:
        return get_memory(memory_id)

    if values.get("is_core"):
        values["locked"] = 1
        values["memory_type"] = "long"
        values["scope"] = "global"
        values["expires_at"] = None
        values["importance"] = max(float(values.get("importance", 0.95)), 0.95)

    set_clause = ", ".join(f"{key}=?" for key in values)
    with get_db_connection() as conn:
        conn.execute(f"UPDATE memories SET {set_clause} WHERE id=?", list(values.values()) + [memory_id])
        conn.commit()
    return get_memory(memory_id)


def set_core(memory_id: int, enabled: bool = True, user_confirmed: bool = True) -> Optional[dict]:
    """Fixa/desfixa uma memória como Core Memory."""
    if enabled:
        return update_memory(
            memory_id,
            is_core=True,
            locked=True,
            user_confirmed=user_confirmed,
            memory_type="long",
            importance=0.95,
        )
    return update_memory(memory_id, is_core=False, locked=False, user_confirmed=user_confirmed)


def delete_memory(memory_id: int, force: bool = False) -> bool:
    """Remove memória, protegendo Core/locked salvo quando force=True."""
    with get_db_connection() as conn:
        row = conn.execute("SELECT locked, is_core FROM memories WHERE id=?", (memory_id,)).fetchone()
        if not row:
            return False
        if not force and (row["locked"] or row["is_core"]):
            raise ValueError("Memória protegida. Desfixe ou use force=true para remover.")
        cursor = conn.execute("DELETE FROM memories WHERE id=?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0


def get_memory(memory_id: int) -> Optional[dict]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
    return _row_to_dict(row) if row else None


def get_stats() -> dict:
    with get_db_connection() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN memory_type = 'short'  THEN 1 ELSE 0 END) as short_count,
                SUM(CASE WHEN memory_type = 'medium' THEN 1 ELSE 0 END) as medium_count,
                SUM(CASE WHEN memory_type = 'long'   THEN 1 ELSE 0 END) as long_count,
                SUM(CASE WHEN memory_type = 'archive' THEN 1 ELSE 0 END) as archive_count,
                SUM(CASE WHEN COALESCE(is_core, 0) = 1 THEN 1 ELSE 0 END) as core_count,
                AVG(importance) as avg_importance
            FROM memories
            WHERE expires_at IS NULL OR expires_at > ?
        """, (now_iso(),)).fetchone()
    return dict(row) if row else {}


# ── Helpers internos ─────────────────────────────────────────────────────────

def _compute_expiry(memory_type: str, importance: float) -> Optional[str]:
    if memory_type in {"long", "core", "archive"}:
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
    for key in ("is_core", "locked", "user_confirmed"):
        d[key] = bool(d.get(key, 0))
    return d
