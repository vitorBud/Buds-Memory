"""
cognitive/insights.py — Gerador de Insights Automáticos do Buds Memory.

Gera insights determinísticos baseados em padrões reais de uso:
  - "Você está estudando mais Python"
  - "Projeto X está parado há 20 dias"
  - "Você usou React em 8 projetos"
  - "SQLite é uma tecnologia recorrente"

Insights são armazenados em banco e retornados apenas os não lidos.
"""

from __future__ import annotations

import datetime
import json
import re
from typing import Optional
from database_v2 import get_db_connection, now_iso, json_dumps, json_loads


INSIGHT_TYPES = {
    "usage_pattern",    # padrão de uso
    "project_status",   # status de projeto
    "learning_streak",  # sequência de aprendizado
    "suggestion",       # sugestão de ação
    "achievement",      # conquista
    "warning",          # alerta (projeto parado, etc.)
}


# ── Geração de insights ───────────────────────────────────────────────────────

def generate_all_insights() -> list[dict]:
    """Executa todos os geradores e salva insights novos."""
    all_insights = []
    all_insights.extend(_insights_top_technologies())
    all_insights.extend(_insights_project_status())
    all_insights.extend(_insights_learning_streak())
    all_insights.extend(_insights_knowledge_growth())
    all_insights.extend(_insights_memory_stats())
    return all_insights


def _insights_top_technologies() -> list[dict]:
    """Detecta tecnologias mais usadas e gera insights."""
    results = []
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT name, access_count, importance, entity_type
            FROM kg_entities
            WHERE entity_type IN ('technology', 'library', 'tool')
            ORDER BY access_count DESC
            LIMIT 5
            """,
        ).fetchall()

    if not rows:
        return results

    top = rows[0]
    if top["access_count"] > 2:
        insight = _save_insight(
            title=f"Tecnologia mais usada: {top['name'].title()}",
            body=(
                f"Você mencionou {top['name'].title()} em {top['access_count']} conversas. "
                "É claramente uma das suas ferramentas principais."
            ),
            insight_type="usage_pattern",
            importance=0.7,
            entities=[top["name"]],
        )
        if insight:
            results.append(insight)

    if len(rows) >= 3:
        techs = [r["name"].title() for r in rows[:3]]
        insight = _save_insight(
            title="Seu stack técnico atual",
            body=f"As tecnologias mais presentes nas suas conversas são: {', '.join(techs)}.",
            insight_type="usage_pattern",
            importance=0.6,
            entities=[r["name"] for r in rows[:3]],
        )
        if insight:
            results.append(insight)

    return results


def _insights_project_status() -> list[dict]:
    """Detecta projetos parados e gera alertas."""
    results = []
    cutoff_active = (datetime.datetime.now() - datetime.timedelta(days=20)).isoformat()
    cutoff_warning = (datetime.datetime.now() - datetime.timedelta(days=7)).isoformat()

    with get_db_connection() as conn:
        # Projetos ativos sem atividade recente
        stale = conn.execute(
            """
            SELECT * FROM projects
            WHERE status = 'active'
            AND (last_activity IS NULL OR last_activity < ?)
            ORDER BY last_activity ASC
            LIMIT 3
            """,
            (cutoff_active,),
        ).fetchall()

        # Projetos com atividade recente
        active_recent = conn.execute(
            """
            SELECT COUNT(*) as n FROM projects
            WHERE status = 'active' AND last_activity >= ?
            """,
            (cutoff_warning,),
        ).fetchone()["n"]

    for proj in stale:
        last = proj["last_activity"] or proj["created_at"]
        last_dt = datetime.datetime.fromisoformat(last[:19])
        days_ago = (datetime.datetime.now() - last_dt).days

        insight = _save_insight(
            title=f"Projeto '{proj['name']}' está parado",
            body=(
                f"O projeto '{proj['name']}' não tem atividade há {days_ago} dias. "
                "Considere retomá-lo ou marcar como pausado."
            ),
            insight_type="warning",
            importance=0.8,
            entities=[proj["name"]],
        )
        if insight:
            results.append(insight)

    if active_recent > 0:
        insight = _save_insight(
            title=f"{active_recent} projeto(s) ativo(s) esta semana",
            body=f"Você trabalhou em {active_recent} projeto(s) nos últimos 7 dias. Continue assim!",
            insight_type="achievement",
            importance=0.5,
        )
        if insight:
            results.append(insight)

    return results


def _insights_learning_streak() -> list[dict]:
    """Detecta sequências de aprendizado na timeline."""
    results = []
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT COUNT(*) as n FROM timeline_events
            WHERE event_type = 'learning'
            AND event_date >= ?
            """,
            ((datetime.datetime.now() - datetime.timedelta(days=7)).isoformat(),),
        ).fetchone()

    count = rows["n"] if rows else 0
    if count >= 3:
        insight = _save_insight(
            title=f"{count} aprendizados esta semana! 🔥",
            body=(
                f"Você registrou {count} aprendizados nos últimos 7 dias. "
                "Seu ritmo de estudo está excelente!"
            ),
            insight_type="learning_streak",
            importance=0.75,
        )
        if insight:
            results.append(insight)
    elif count >= 1:
        insight = _save_insight(
            title="Você está aprendendo",
            body=f"{count} novo(s) aprendizado(s) registrado(s) esta semana.",
            insight_type="learning_streak",
            importance=0.5,
        )
        if insight:
            results.append(insight)

    return results


def _insights_knowledge_growth() -> list[dict]:
    """Detecta crescimento da base de conhecimento."""
    results = []
    with get_db_connection() as conn:
        total_ks = conn.execute("SELECT COUNT(*) as n FROM knowledge_sources").fetchone()["n"]
        total_entities = conn.execute("SELECT COUNT(*) as n FROM kg_entities").fetchone()["n"]
        total_relations = conn.execute("SELECT COUNT(*) as n FROM kg_relations").fetchone()["n"]

    if total_ks >= 5:
        insight = _save_insight(
            title=f"Base de conhecimento crescendo: {total_ks} documentos",
            body=(
                f"Você importou {total_ks} documento(s) para o Buds Memory. "
                f"O cérebro digital já conecta {total_entities} conceitos com {total_relations} relações."
            ),
            insight_type="achievement",
            importance=0.6,
        )
        if insight:
            results.append(insight)

    return results


def _insights_memory_stats() -> list[dict]:
    """Insights sobre a memória do sistema."""
    results = []
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT
              SUM(CASE WHEN memory_type='long' THEN 1 ELSE 0 END) as long_count,
              COUNT(*) as total
            FROM memories
            WHERE expires_at IS NULL OR expires_at > ?
            """,
            (now_iso(),),
        ).fetchone()

    if row and row["long_count"] and row["long_count"] >= 10:
        insight = _save_insight(
            title=f"{row['long_count']} memórias permanentes consolidadas",
            body=(
                f"O Buds Memory consolidou {row['long_count']} memórias de longo prazo. "
                "Seu segundo cérebro está madurando."
            ),
            insight_type="achievement",
            importance=0.65,
        )
        if insight:
            results.append(insight)

    return results


# ── CRUD de insights ──────────────────────────────────────────────────────────

def _save_insight(
    title: str,
    body: str,
    insight_type: str = "usage_pattern",
    importance: float = 0.5,
    entities: Optional[list] = None,
    expires_days: int = 14,
) -> Optional[dict]:
    """
    Salva insight apenas se não existir um igual nos últimos 7 dias.
    Evita duplicatas.
    """
    recent_cutoff = (datetime.datetime.now() - datetime.timedelta(days=7)).isoformat()
    with get_db_connection() as conn:
        existing = conn.execute(
            """
            SELECT id FROM insights
            WHERE title=? AND created_at >= ?
            """,
            (title, recent_cutoff),
        ).fetchone()

        if existing:
            return None  # Já gerado recentemente

        expires_at = (
            (datetime.datetime.now() + datetime.timedelta(days=expires_days)).isoformat()
            if expires_days
            else None
        )

        cursor = conn.execute(
            """
            INSERT INTO insights
              (insight_type, title, body, entities, importance, is_read, created_at, expires_at)
            VALUES (?,?,?,?,?,0,?,?)
            """,
            (
                insight_type,
                title,
                body,
                json_dumps(entities or []),
                importance,
                now_iso(),
                expires_at,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM insights WHERE id=?", (cursor.lastrowid,)).fetchone()

    return _row_to_dict(row)


def get_all_insights(include_read: bool = False, limit: int = 50) -> list[dict]:
    with get_db_connection() as conn:
        if include_read:
            rows = conn.execute(
                "SELECT * FROM insights ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM insights WHERE is_read=0
                AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY importance DESC LIMIT ?
                """,
                (now_iso(), limit),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def mark_read(insight_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute(
            "UPDATE insights SET is_read=1 WHERE id=?", (insight_id,)
        )
        conn.commit()
    return cursor.rowcount > 0


def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as n FROM insights").fetchone()["n"]
        unread = conn.execute(
            "SELECT COUNT(*) as n FROM insights WHERE is_read=0"
        ).fetchone()["n"]
        by_type = conn.execute(
            "SELECT insight_type, COUNT(*) as n FROM insights GROUP BY insight_type"
        ).fetchall()
    return {
        "total": total,
        "unread": unread,
        "by_type": {r["insight_type"]: r["n"] for r in by_type},
    }


def _row_to_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    d["entities"] = json_loads(d.get("entities") or "[]", fallback=[])
    return d
