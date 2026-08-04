"""
cognitive/timeline.py — Timeline Inteligente do Buds Memory.

Registra eventos cronológicos:
  - Aprendizados
  - Projetos criados/concluídos
  - Marcos pessoais
  - Conversas importantes
  - Conquistas

Permite responder perguntas como:
  "O que aprendi esta semana?"
  "Quando comecei o Projeto X?"
  "O que fiz ontem?"
"""

from __future__ import annotations

import re
import datetime
from typing import Optional
from database_v2 import get_db_connection, now_iso, json_dumps, json_loads


EVENT_TYPES = {
    "learning",       # aprendizado de novo conceito/tecnologia
    "project",        # criação/atualização de projeto
    "milestone",      # marco pessoal/profissional
    "conversation",   # conversa importante
    "achievement",    # conquista
    "task",           # tarefa concluída
    "import",         # documento importado
}


# ── Escrita ──────────────────────────────────────────────────────────────────

def add_event(
    title: str,
    event_type: str = "learning",
    description: Optional[str] = None,
    event_date: Optional[str] = None,
    entity_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    session_id: Optional[str] = None,
    importance: float = 0.5,
    tags: Optional[list] = None,
) -> dict:
    """Registra um evento na timeline."""
    event_type = event_type if event_type in EVENT_TYPES else "learning"
    event_date = event_date or now_iso()
    ts = now_iso()

    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO timeline_events
              (title, description, event_type, entity_id, entity_type,
               session_id, event_date, created_at, importance, tags)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (
                title.strip(),
                description,
                event_type,
                entity_id,
                entity_type,
                session_id,
                event_date,
                ts,
                importance,
                json_dumps(tags or []),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM timeline_events WHERE id=?", (cursor.lastrowid,)
        ).fetchone()

    return _row_to_dict(row)


# ── Leitura ──────────────────────────────────────────────────────────────────

def get_timeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    event_types: Optional[list] = None,
    limit: int = 100,
) -> list[dict]:
    """Lista eventos com filtros opcionais de data e tipo."""
    conditions = []
    params: list = []

    if start_date:
        conditions.append("event_date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("event_date <= ?")
        params.append(end_date)
    if event_types:
        placeholders = ",".join("?" * len(event_types))
        conditions.append(f"event_type IN ({placeholders})")
        params.extend(event_types)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM timeline_events
            {where}
            ORDER BY event_date DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    return [_row_to_dict(r) for r in rows]


def get_recent_activity(days: int = 7) -> list[dict]:
    """Atividade dos últimos N dias."""
    since = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat()
    return get_timeline(start_date=since, limit=50)


def get_today() -> list[dict]:
    today = datetime.date.today().isoformat()
    return get_timeline(start_date=today, limit=30)


def get_this_week() -> list[dict]:
    monday = (
        datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday())
    ).isoformat()
    return get_timeline(start_date=monday, limit=50)


def get_this_month() -> list[dict]:
    first = datetime.date.today().replace(day=1).isoformat()
    return get_timeline(start_date=first, limit=100)


def search_events(query: str, limit: int = 20) -> list[dict]:
    """Busca textual em eventos da timeline."""
    tokens = _tokenize(query)
    if not tokens:
        return get_timeline(limit=limit)

    all_events = get_timeline(limit=1000)
    scored = []
    for event in all_events:
        haystack = f"{event['title']} {event.get('description', '')} {' '.join(event.get('tags', []))}"
        score = sum(haystack.lower().count(t) for t in tokens)
        if score > 0:
            scored.append((score, event))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:limit]]


def answer_temporal_query(question: str) -> dict:
    """
    Responde perguntas temporais simples sobre a timeline.
    Retorna: {answer: str, events: list, period: str}
    """
    lower = question.lower()

    # Detecta período
    if any(w in lower for w in ["hoje", "today"]):
        events = get_today()
        period = "hoje"
    elif any(w in lower for w in ["ontem", "yesterday"]):
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        events = get_timeline(
            start_date=yesterday,
            end_date=(datetime.date.today()).isoformat(),
            limit=30,
        )
        period = "ontem"
    elif any(w in lower for w in ["semana", "week"]):
        events = get_this_week()
        period = "esta semana"
    elif any(w in lower for w in ["mês", "mes", "month"]):
        events = get_this_month()
        period = "este mês"
    else:
        # Busca textual
        events = search_events(question, limit=10)
        period = "histórico"

    if not events:
        answer = f"Não encontrei atividades registradas para '{period}'."
    else:
        lines = [f"Atividades de {period} ({len(events)} evento(s)):"]
        for ev in events[:10]:
            date_short = ev["event_date"][:10]
            lines.append(f"  [{date_short}] {ev['title']}")
            if ev.get("description"):
                lines.append(f"    → {ev['description'][:120]}")
        answer = "\n".join(lines)

    return {"answer": answer, "events": events[:20], "period": period}


def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as n FROM timeline_events").fetchone()["n"]
        by_type = conn.execute(
            "SELECT event_type, COUNT(*) as n FROM timeline_events GROUP BY event_type"
        ).fetchall()
        recent = conn.execute(
            "SELECT COUNT(*) as n FROM timeline_events WHERE event_date >= ?",
            ((datetime.datetime.now() - datetime.timedelta(days=7)).isoformat(),),
        ).fetchone()["n"]
    return {
        "total": total,
        "recent_7d": recent,
        "by_type": {r["event_type"]: r["n"] for r in by_type},
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", (text or "").lower())
    return [w for w in clean.split() if len(w) > 2]


def _row_to_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    d["tags"] = json_loads(d.get("tags") or "[]", fallback=[])
    return d
