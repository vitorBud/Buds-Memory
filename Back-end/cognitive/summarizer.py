"""
cognitive/summarizer.py — Sistema de Resumos Automáticos do Buds Memory.

Gera resumos de:
  - Sessões individuais de chat
  - Dia, semana, mês
  - Por projeto
  - Por assunto

Usa lógica determinística para resumos rápidos.
Para resumos ricos, chama o LLM Ollama quando disponível.
"""

from __future__ import annotations

import datetime
import re
from typing import Optional
from database_v2 import get_db_connection, now_iso

SUMMARY_TRIGGER_MESSAGES = 12
SUMMARY_UPDATE_EVERY = 8


# ── Resumo de sessão ──────────────────────────────────────────────────────────

def summarize_session(session_id: str, use_llm: bool = False) -> dict:
    """
    Gera resumo de uma conversa.
    use_llm=True chama Ollama para resumo em linguagem natural.
    """
    with get_db_connection() as conn:
        session = conn.execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
        messages = conn.execute(
            "SELECT sender, text FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        knowledge = conn.execute(
            "SELECT title, source_type FROM knowledge_sources WHERE session_id=?",
            (session_id,),
        ).fetchall()

    if not session:
        return {"error": "Sessão não encontrada"}

    real_msgs = [m for m in messages if m["text"] != "__thinking__"]
    user_msgs = [m for m in real_msgs if m["sender"] == "user"]
    ai_msgs = [m for m in real_msgs if m["sender"] == "ia"]

    topics = _extract_topics_from_messages(real_msgs)
    first_question = user_msgs[0]["text"][:200] if user_msgs else ""

    summary_text = _build_session_summary_text(
        session_title=session["title"],
        user_msgs=user_msgs,
        ai_msgs=ai_msgs,
        topics=topics,
        knowledge=list(knowledge),
        first_question=first_question,
    )

    if use_llm:
        llm_summary = _llm_summarize(summary_text)
        if llm_summary:
            summary_text = llm_summary

    return {
        "session_id": session_id,
        "title": session["title"],
        "created_at": session["created_at"],
        "message_count": len(real_msgs),
        "user_messages": len(user_msgs),
        "ai_messages": len(ai_msgs),
        "topics": topics,
        "knowledge_imported": len(knowledge),
        "first_question": first_question,
        "summary": summary_text,
    }


def get_conversation_summary(session_id: str) -> Optional[dict]:
    """Retorna o resumo persistente da conversa, se existir."""
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM conversation_summaries WHERE session_id=?",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def maybe_update_conversation_summary(session_id: str, use_llm: bool = False) -> Optional[dict]:
    """
    Gera/atualiza resumo persistente quando a conversa passa do limiar.
    Usa estratégia incremental determinística para não travar o chat.
    """
    with get_db_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) as n FROM messages WHERE session_id=? AND text != '__thinking__'",
            (session_id,),
        ).fetchone()["n"]
        existing = conn.execute(
            "SELECT * FROM conversation_summaries WHERE session_id=?",
            (session_id,),
        ).fetchone()

    if count < SUMMARY_TRIGGER_MESSAGES:
        return dict(existing) if existing else None

    if existing and count - int(existing["message_count"] or 0) < SUMMARY_UPDATE_EVERY:
        return dict(existing)

    session_summary = summarize_session(session_id, use_llm=use_llm)
    if session_summary.get("error"):
        return None

    previous = existing["summary"] if existing else ""
    summary_text = _merge_persistent_summary(previous, session_summary["summary"])
    ts = now_iso()

    with get_db_connection() as conn:
        if existing:
            conn.execute(
                """
                UPDATE conversation_summaries
                SET summary=?, updated_at=?, message_count=?
                WHERE session_id=?
                """,
                (summary_text, ts, count, session_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO conversation_summaries
                  (session_id, summary, created_at, updated_at, message_count)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, summary_text, ts, ts, count),
            )
        conn.commit()

    return get_conversation_summary(session_id)


def _merge_persistent_summary(previous: str, current: str) -> str:
    """Compacta resumo anterior + novo em um bloco curto e estável."""
    parts = []
    if previous:
        parts.append(previous.strip())
    if current:
        parts.append(current.strip())

    text = "\n".join(parts)
    lines = []
    seen = set()
    for line in text.splitlines():
        clean = line.strip()
        key = clean.lower()
        if clean and key not in seen:
            lines.append(clean)
            seen.add(key)

    return "\n".join(lines[-14:])[:2400]


def _build_session_summary_text(
    session_title: str,
    user_msgs: list,
    ai_msgs: list,
    topics: list[str],
    knowledge: list,
    first_question: str,
) -> str:
    lines = [
        f"Conversa: {session_title}",
        f"Mensagens: {len(user_msgs)} do usuário, {len(ai_msgs)} da IA",
    ]
    if topics:
        lines.append(f"Assuntos discutidos: {', '.join(topics[:6])}")
    if first_question:
        lines.append(f"Iniciou com: '{first_question[:120]}'")
    if knowledge:
        ks_titles = [k["title"] for k in knowledge[:3]]
        lines.append(f"Documentos importados: {', '.join(ks_titles)}")
    return "\n".join(lines)


# ── Resumo diário ─────────────────────────────────────────────────────────────

def summarize_daily(date: Optional[str] = None) -> dict:
    """Resumo de um dia específico (padrão: hoje)."""
    target = date or datetime.date.today().isoformat()
    next_day = (
        datetime.date.fromisoformat(target) + datetime.timedelta(days=1)
    ).isoformat()

    with get_db_connection() as conn:
        sessions = conn.execute(
            "SELECT * FROM sessions WHERE created_at >= ? AND created_at < ? ORDER BY created_at",
            (target, next_day),
        ).fetchall()

        events = conn.execute(
            "SELECT * FROM timeline_events WHERE event_date >= ? AND event_date < ? ORDER BY event_date",
            (target, next_day),
        ).fetchall()

        memories = conn.execute(
            "SELECT content, tags, importance FROM memories WHERE created_at >= ? AND created_at < ?",
            (target, next_day),
        ).fetchall()

        ks = conn.execute(
            "SELECT title, source_type FROM knowledge_sources WHERE created_at >= ? AND created_at < ?",
            (target, next_day),
        ).fetchall()

    lines = [f"📅 Resumo do dia {target}"]
    lines.append(f"Sessões de chat: {len(sessions)}")
    if events:
        lines.append(f"\nEventos registrados ({len(events)}):")
        for ev in events[:5]:
            lines.append(f"  • [{ev['event_type']}] {ev['title']}")
    if ks:
        lines.append(f"\nConhecimento importado ({len(ks)}):")
        for k in ks[:3]:
            lines.append(f"  • {k['title']} ({k['source_type']})")
    if not events and not sessions and not ks:
        lines.append("Nenhuma atividade registrada neste dia.")

    return {
        "date": target,
        "sessions": len(sessions),
        "events": len(events),
        "knowledge_imported": len(ks),
        "memories_created": len(memories),
        "summary": "\n".join(lines),
    }


# ── Resumo semanal ────────────────────────────────────────────────────────────

def summarize_weekly(week_start: Optional[str] = None) -> dict:
    """Resumo da semana. week_start no formato YYYY-MM-DD (segunda-feira)."""
    if week_start:
        start = datetime.date.fromisoformat(week_start)
    else:
        today = datetime.date.today()
        start = today - datetime.timedelta(days=today.weekday())

    end = start + datetime.timedelta(days=7)
    start_str = start.isoformat()
    end_str = end.isoformat()

    with get_db_connection() as conn:
        sessions_count = conn.execute(
            "SELECT COUNT(*) as n FROM sessions WHERE created_at >= ? AND created_at < ?",
            (start_str, end_str),
        ).fetchone()["n"]

        events = conn.execute(
            "SELECT * FROM timeline_events WHERE event_date >= ? AND event_date < ? ORDER BY event_date",
            (start_str, end_str),
        ).fetchall()

        ks_count = conn.execute(
            "SELECT COUNT(*) as n FROM knowledge_sources WHERE created_at >= ? AND created_at < ?",
            (start_str, end_str),
        ).fetchone()["n"]

        entities = conn.execute(
            "SELECT name, entity_type FROM kg_entities WHERE first_seen >= ? AND first_seen < ? ORDER BY importance DESC LIMIT 10",
            (start_str, end_str),
        ).fetchall()

    learnings = [e for e in events if e["event_type"] == "learning"]
    tasks = [e for e in events if e["event_type"] == "task"]

    lines = [
        f"📊 Resumo da semana ({start_str} → {(end - datetime.timedelta(days=1)).isoformat()})",
        f"Conversas: {sessions_count}",
        f"Aprendizados: {len(learnings)}",
        f"Tarefas: {len(tasks)}",
        f"Documentos importados: {ks_count}",
    ]

    if entities:
        tech_names = [e["name"].title() for e in entities[:5]]
        lines.append(f"Tecnologias em foco: {', '.join(tech_names)}")

    if learnings:
        lines.append("\nPrincipais aprendizados:")
        for lrn in learnings[:4]:
            lines.append(f"  • {lrn['title']}")

    return {
        "week_start": start_str,
        "week_end": end_str,
        "sessions": sessions_count,
        "learning_events": len(learnings),
        "task_events": len(tasks),
        "knowledge_imported": ks_count,
        "new_entities": len(entities),
        "summary": "\n".join(lines),
    }


# ── Resumo mensal ─────────────────────────────────────────────────────────────

def summarize_monthly(year_month: Optional[str] = None) -> dict:
    """Resumo de um mês. year_month no formato YYYY-MM."""
    now = datetime.date.today()
    if year_month:
        year, month = map(int, year_month.split("-"))
    else:
        year, month = now.year, now.month

    start = datetime.date(year, month, 1).isoformat()
    if month == 12:
        end = datetime.date(year + 1, 1, 1).isoformat()
    else:
        end = datetime.date(year, month + 1, 1).isoformat()

    with get_db_connection() as conn:
        sessions_count = conn.execute(
            "SELECT COUNT(*) as n FROM sessions WHERE created_at >= ? AND created_at < ?",
            (start, end),
        ).fetchone()["n"]

        events_count = conn.execute(
            "SELECT COUNT(*) as n FROM timeline_events WHERE event_date >= ? AND event_date < ?",
            (start, end),
        ).fetchone()["n"]

        ks_count = conn.execute(
            "SELECT COUNT(*) as n FROM knowledge_sources WHERE created_at >= ? AND created_at < ?",
            (start, end),
        ).fetchone()["n"]

        top_entities = conn.execute(
            """
            SELECT name, entity_type, access_count FROM kg_entities
            WHERE last_seen >= ? AND last_seen < ?
            ORDER BY access_count DESC LIMIT 8
            """,
            (start, end),
        ).fetchall()

    lines = [
        f"📅 Resumo de {datetime.date(year, month, 1).strftime('%B %Y')}",
        f"Conversas iniciadas: {sessions_count}",
        f"Eventos na timeline: {events_count}",
        f"Documentos importados: {ks_count}",
    ]

    if top_entities:
        names = [e["name"].title() for e in top_entities[:6]]
        lines.append(f"Tecnologias do mês: {', '.join(names)}")

    return {
        "year_month": f"{year:04d}-{month:02d}",
        "sessions": sessions_count,
        "events": events_count,
        "knowledge_imported": ks_count,
        "top_entities": [dict(e) for e in top_entities],
        "summary": "\n".join(lines),
    }


# ── Resumo por projeto ────────────────────────────────────────────────────────

def summarize_project(project_id: int) -> dict:
    """Resumo completo de um projeto."""
    with get_db_connection() as conn:
        proj = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            return {"error": "Projeto não encontrado"}

        session_count = conn.execute(
            "SELECT COUNT(*) as n FROM project_sessions WHERE project_id=?",
            (project_id,),
        ).fetchone()["n"]

        doc_count = conn.execute(
            "SELECT COUNT(*) as n FROM project_documents WHERE project_id=?",
            (project_id,),
        ).fetchone()["n"]

        events = conn.execute(
            "SELECT * FROM timeline_events WHERE entity_id=? AND entity_type='project' ORDER BY event_date DESC LIMIT 5",
            (project_id,),
        ).fetchall()

    import json as _json
    technologies = _json.loads(proj["technologies"] or "[]")
    objectives = _json.loads(proj["objectives"] or "[]")

    lines = [
        f"🚀 Projeto: {proj['name']} [{proj['status']}]",
        f"Criado em: {proj['created_at'][:10]}",
    ]
    if proj["description"]:
        lines.append(f"Descrição: {proj['description']}")
    if technologies:
        lines.append(f"Tecnologias: {', '.join(technologies)}")
    if objectives:
        lines.append("Objetivos:")
        for obj in objectives[:3]:
            lines.append(f"  • {obj}")
    lines.append(f"Conversas vinculadas: {session_count}")
    lines.append(f"Documentos: {doc_count}")
    if events:
        lines.append("Eventos recentes:")
        for ev in events[:3]:
            lines.append(f"  • [{ev['event_date'][:10]}] {ev['title']}")

    last_activity = proj["last_activity"] or proj["created_at"]
    last_dt = datetime.datetime.fromisoformat(last_activity[:19])
    days_ago = (datetime.datetime.now() - last_dt).days

    return {
        "project_id": project_id,
        "name": proj["name"],
        "status": proj["status"],
        "technologies": technologies,
        "session_count": session_count,
        "document_count": doc_count,
        "days_since_activity": days_ago,
        "summary": "\n".join(lines),
    }


# ── LLM summarizer (opcional) ─────────────────────────────────────────────────

def _llm_summarize(context: str, max_tokens: int = 400) -> Optional[str]:
    """Usa Ollama para gerar resumo em linguagem natural. Retorna None se falhar."""
    try:
        import requests
        from agenty import OLLAMA_MODEL

        prompt = (
            "Crie um resumo conciso em português do Brasil com no máximo 3 parágrafos:\n\n"
            f"{context}\n\nResumo:"
        )
        r = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": max_tokens},
            },
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("response", "").strip() or None
    except Exception:
        return None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_topics_from_messages(messages: list, limit: int = 8) -> list[str]:
    stop = {
        "para", "como", "uma", "com", "que", "por", "mais", "isso", "esse",
        "esta", "estar", "pode", "vou", "sim", "não", "tem", "ter",
    }
    counts: dict[str, int] = {}
    for msg in messages:
        words = re.findall(r"\b[a-zA-ZÀ-ÿ]{4,}\b", (msg["text"] or "").lower())
        for w in words:
            if w not in stop:
                counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda x: -x[1])[:limit]]
