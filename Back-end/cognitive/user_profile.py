"""
cognitive/user_profile.py — Perfil estruturado local do usuário.

Extrai e consolida fatos pessoais úteis para contexto prioritário:
nome, profissão, tecnologias, projetos e objetivos. Tudo fica em SQLite,
sem serviços externos e sem depender do LLM.
"""

from __future__ import annotations

import re
from typing import Optional

from database_v2 import get_db_connection, now_iso, json_loads
from cognitive import knowledge_graph


CORE_PROFILE_KEYS = {"name", "profession", "project"}
CORE_PROFILE_MIN_CONFIDENCE = 0.65


PROFILE_KEYS = {
    "name": "Nome",
    "profession": "Profissão",
    "technology": "Tecnologias",
    "project": "Projetos",
    "goal": "Objetivos",
}


def update_from_text(text: str, session_id: Optional[str] = None, source: str = "conversation") -> list[dict]:
    """Extrai fatos estruturados de uma mensagem e salva/upserta no perfil."""
    facts = extract_profile_facts(text)
    saved = []
    for fact in facts:
        saved_fact = upsert_fact(
            fact["key"],
            fact["value"],
            confidence=fact.get("confidence", 0.6),
            source=source,
            session_id=session_id,
        )
        _sync_core_memory(saved_fact)
        saved.append(saved_fact)
    return saved


def extract_profile_facts(text: str) -> list[dict]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    lower = clean.lower()
    facts: list[dict] = []

    name_patterns = [
        r"\bmeu nome (?:é|e)\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ' -]{1,50})",
        r"\bme chamo\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ' -]{1,50})",
        r"\bsou o\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ' -]{1,50})",
        r"\bsou a\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ' -]{1,50})",
    ]
    for pattern in name_patterns:
        match = re.search(pattern, clean, flags=re.I)
        if match:
            value = _clean_name_value(match.group(1))
            if value:
                facts.append({"key": "name", "value": value, "confidence": 0.9})
                break

    profession_patterns = [
        r"\bsou\s+(?:um|uma)?\s*([A-Za-zÀ-ÿ ]{3,60}(?:developer|dev|programador|programadora|engenheiro|engenheira|estudante|designer|analista)[A-Za-zÀ-ÿ ]*)",
        r"\btrabalho como\s+([A-Za-zÀ-ÿ ]{3,80})",
        r"\bminha profissão (?:é|e)\s+([A-Za-zÀ-ÿ ]{3,80})",
    ]
    for pattern in profession_patterns:
        match = re.search(pattern, lower, flags=re.I)
        if match:
            value = _clean_value(match.group(1))
            if value:
                facts.append({"key": "profession", "value": value, "confidence": 0.75})
                break

    for tech in knowledge_graph.KNOWN_TECHNOLOGIES:
        if re.search(r"\b" + re.escape(tech) + r"\b", lower):
            facts.append({"key": "technology", "value": knowledge_graph._clean_name(tech), "confidence": 0.7})

    project_match = re.search(r"\b(?:meu projeto|projeto)\s+([A-Za-zÀ-ÿ0-9 _.-]{3,80})", clean, flags=re.I)
    if project_match:
        value = _clean_value(project_match.group(1))
        if value:
            facts.append({"key": "project", "value": value, "confidence": 0.65})

    goal_patterns = [
        r"\b(?:meu objetivo|objetivo) (?:é|e)\s+(.{8,140})",
        r"\bquero\s+(.{8,140})",
        r"\bpreciso\s+(.{8,140})",
    ]
    for pattern in goal_patterns:
        match = re.search(pattern, clean, flags=re.I)
        if match:
            value = _clean_value(match.group(1))
            if value:
                facts.append({"key": "goal", "value": value, "confidence": 0.6})
                break

    deduped = []
    seen = set()
    for fact in facts:
        key = (fact["key"], fact["value"].lower())
        if key not in seen:
            seen.add(key)
            deduped.append(fact)
    return deduped[:12]


def upsert_fact(
    fact_key: str,
    fact_value: str,
    confidence: float = 0.6,
    source: str = "conversation",
    session_id: Optional[str] = None,
) -> dict:
    fact_key = fact_key if fact_key in PROFILE_KEYS else "goal"
    fact_value = _clean_value(fact_value)
    ts = now_iso()

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM user_profile_facts
            WHERE fact_key=? AND lower(fact_value)=lower(?)
            """,
            (fact_key, fact_value),
        ).fetchone()
        if row:
            new_conf = max(float(row["confidence"] or 0.0), float(confidence))
            conn.execute(
                """
                UPDATE user_profile_facts
                SET confidence=?, source=?, session_id=COALESCE(?, session_id), updated_at=?
                WHERE id=?
                """,
                (new_conf, source, session_id, ts, row["id"]),
            )
            fact_id = row["id"]
        else:
            cursor = conn.execute(
                """
                INSERT INTO user_profile_facts
                  (fact_key, fact_value, confidence, source, session_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (fact_key, fact_value, confidence, source, session_id, ts, ts),
            )
            fact_id = cursor.lastrowid
        conn.commit()
        saved = conn.execute("SELECT * FROM user_profile_facts WHERE id=?", (fact_id,)).fetchone()

    return dict(saved)


def get_profile(limit_per_key: int = 8) -> dict:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM user_profile_facts
            ORDER BY confidence DESC, updated_at DESC
            """
        ).fetchall()

    grouped: dict[str, list[dict]] = {}
    for row in rows:
        item = dict(row)
        bucket = grouped.setdefault(item["fact_key"], [])
        if len(bucket) < limit_per_key:
            bucket.append(item)
    return grouped


def get_profile_context() -> str:
    profile = get_profile(limit_per_key=6)
    lines = []

    for key, label in PROFILE_KEYS.items():
        facts = profile.get(key) or []
        values = [fact["fact_value"] for fact in facts if fact.get("fact_value")]
        if values:
            if key in {"technology", "project", "goal"}:
                lines.append(f"{label}: {', '.join(values[:8])}")
            else:
                lines.append(f"{label}: {values[0]}")

    core_memories = _core_memory_lines()
    if core_memories:
        lines.append("Core Memory:")
        lines.extend(f"- {item}" for item in core_memories[:8])

    return "\n".join(lines)


def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM user_profile_facts").fetchone()["n"]
        by_key = conn.execute(
            "SELECT fact_key, COUNT(*) AS n FROM user_profile_facts GROUP BY fact_key"
        ).fetchall()
    return {"total": total, "by_key": {row["fact_key"]: row["n"] for row in by_key}}


def _sync_core_memory(fact: dict) -> None:
    """Espelha fatos pessoais estáveis em Core Memory visível na Obsidian."""
    key = fact.get("fact_key")
    confidence = float(fact.get("confidence") or 0.0)
    if key not in CORE_PROFILE_KEYS or confidence < CORE_PROFILE_MIN_CONFIDENCE:
        return

    content = _core_memory_content(key, fact.get("fact_value", ""))
    if not content:
        return

    fact_id = int(fact["id"])
    session_id = fact.get("session_id")
    tags = ["perfil", key]
    try:
        from cognitive import memory

        with get_db_connection() as conn:
            if session_id:
                exists = conn.execute("SELECT 1 FROM sessions WHERE id=? LIMIT 1", (session_id,)).fetchone()
                if not exists:
                    session_id = None
            row = conn.execute(
                """
                SELECT id FROM memories
                WHERE source_table='user_profile_facts' AND source_id=?
                LIMIT 1
                """,
                (fact_id,),
            ).fetchone()

        if row:
            memory.update_memory(
                row["id"],
                content=content,
                memory_type="long",
                importance=0.97,
                tags=tags,
                is_core=True,
                locked=True,
                user_confirmed=True,
                origin_type="profile",
                origin_id=str(fact_id),
                source_table="user_profile_facts",
                source_id=fact_id,
                expires_at=None,
            )
            return

        memory.save_memory(
            content=content,
            memory_type="long",
            session_id=session_id,
            importance=0.97,
            tags=tags,
            is_core=True,
            locked=True,
            user_confirmed=True,
            origin_type="profile",
            origin_id=str(fact_id),
            source_table="user_profile_facts",
            source_id=fact_id,
        )
    except Exception as exc:
        print(f"[UserProfile] Core Memory ignorada: {exc}")


def _core_memory_lines() -> list[str]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT content FROM memories
            WHERE COALESCE(is_core, 0) = 1
            ORDER BY importance DESC, last_accessed DESC
            LIMIT 12
            """
        ).fetchall()
    return [str(row["content"]).strip() for row in rows if str(row["content"]).strip()]


def _core_memory_content(key: str, value: str) -> str:
    value = _clean_value(value)
    if not value:
        return ""
    if key == "name":
        value = _format_name(value)
    labels = {
        "name": "Nome do usuário",
        "profession": "Profissão do usuário",
        "project": "Projeto importante do usuário",
    }
    label = labels.get(key)
    return f"{label}: {value}." if label else ""


def _clean_value(value: str) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip(" .,:;!?-_")
    value = re.sub(r"\b(eu|meu|minha|para mim)$", "", value, flags=re.I).strip()
    return value[:160]


def _clean_name_value(value: str) -> str:
    value = _clean_value(value)
    value = re.split(
        r"\s+(?:e|que|mas|porque|na verdade|na real|mesmo)\b",
        value,
        maxsplit=1,
        flags=re.I,
    )[0]
    words = value.split()
    if len(words) > 4:
        value = " ".join(words[:4])
    return value.strip()


def _format_name(value: str) -> str:
    return " ".join(part.capitalize() for part in str(value or "").split())
