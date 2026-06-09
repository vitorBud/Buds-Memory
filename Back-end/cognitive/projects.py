"""
cognitive/projects.py — Modo Projeto do Nexus IA.

Gerencia entidades de projeto: criação, status, vinculação com sessões
e documentos, geração de contexto para o LLM.
"""

from __future__ import annotations

import json
import re
from typing import Optional
from database_v2 import get_db_connection, now_iso, json_dumps, json_loads


STATUS_OPTIONS = {"active", "paused", "completed", "abandoned"}


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_project(
    name: str,
    description: Optional[str] = None,
    technologies: Optional[list] = None,
    objectives: Optional[list] = None,
    tags: Optional[list] = None,
) -> dict:
    ts = now_iso()
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO projects
              (name, description, status, technologies, objectives, tags, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                name.strip(),
                description,
                "active",
                json_dumps(technologies or []),
                json_dumps(objectives or []),
                json_dumps(tags or []),
                ts, ts,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id=?", (cursor.lastrowid,)).fetchone()
    return _row_to_dict(row)


def get_project(project_id: int) -> Optional[dict]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        return None
    project = _row_to_dict(row)
    project["sessions"] = get_project_sessions(project_id)
    project["documents"] = get_project_documents(project_id)
    return project


def get_all_projects(status: Optional[str] = None) -> list[dict]:
    with get_db_connection() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM projects WHERE status=? ORDER BY updated_at DESC", (status,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_project(project_id: int, **kwargs) -> Optional[dict]:
    """Atualiza campos do projeto. Aceita: name, description, status, technologies, objectives, tags."""
    allowed = {"name", "description", "status", "technologies", "objectives", "tags"}
    updates = {}

    for key, value in kwargs.items():
        if key not in allowed:
            continue
        if key == "status":
            value = value if value in STATUS_OPTIONS else "active"
        elif key in ("technologies", "objectives", "tags"):
            value = json_dumps(value if isinstance(value, list) else [])
        updates[key] = value

    if not updates:
        return get_project(project_id)

    updates["updated_at"] = now_iso()
    set_clause = ", ".join(f"{k}=?" for k in updates)
    params = list(updates.values()) + [project_id]

    with get_db_connection() as conn:
        conn.execute(f"UPDATE projects SET {set_clause} WHERE id=?", params)
        conn.commit()

    return get_project(project_id)


def delete_project(project_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        conn.commit()
    return cursor.rowcount > 0


# ── Vínculos ─────────────────────────────────────────────────────────────────

def link_session(project_id: int, session_id: str) -> bool:
    """Vincula uma sessão a um projeto."""
    try:
        with get_db_connection() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO project_sessions (project_id, session_id, linked_at) VALUES (?,?,?)",
                (project_id, session_id, now_iso()),
            )
            conn.execute(
                "UPDATE projects SET updated_at=?, last_activity=? WHERE id=?",
                (now_iso(), now_iso(), project_id),
            )
            conn.commit()
        return True
    except Exception:
        return False


def unlink_session(project_id: int, session_id: str) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM project_sessions WHERE project_id=? AND session_id=?",
            (project_id, session_id),
        )
        conn.commit()
    return cursor.rowcount > 0


def get_project_sessions(project_id: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT s.*, ps.linked_at
            FROM sessions s
            JOIN project_sessions ps ON s.id = ps.session_id
            WHERE ps.project_id=?
            ORDER BY ps.linked_at DESC
            """,
            (project_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def add_document(project_id: int, title: str, doc_type: str,
                 knowledge_source_id: Optional[int] = None) -> dict:
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO project_documents
              (project_id, knowledge_source_id, title, doc_type, created_at)
            VALUES (?,?,?,?,?)
            """,
            (project_id, knowledge_source_id, title, doc_type, now_iso()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM project_documents WHERE id=?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def get_project_documents(project_id: int) -> list[dict]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM project_documents WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── Detecção automática ───────────────────────────────────────────────────────

def find_project_by_name(name: str) -> Optional[dict]:
    """Tenta encontrar um projeto pelo nome (busca parcial)."""
    name_lower = name.strip().lower()
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    for row in rows:
        if name_lower in row["name"].lower() or row["name"].lower() in name_lower:
            return _row_to_dict(row)
    return None


def auto_detect_and_link(session_id: str, text: str) -> Optional[dict]:
    """
    Analisa o texto em busca de menções a projetos existentes.
    Se encontrar, vincula a sessão automaticamente.
    Retorna o projeto encontrado ou None.
    """
    with get_db_connection() as conn:
        projects = conn.execute("SELECT id, name FROM projects WHERE status='active'").fetchall()

    text_lower = text.lower()
    for proj in projects:
        pattern = r"\b" + re.escape(proj["name"].lower()) + r"\b"
        if re.search(pattern, text_lower):
            link_session(proj["id"], session_id)
            return {"id": proj["id"], "name": proj["name"]}
    return None


# ── Contexto para LLM ─────────────────────────────────────────────────────────

def get_project_context(project_id: int) -> str:
    """Retorna contexto completo do projeto para injetar no prompt."""
    project = get_project(project_id)
    if not project:
        return ""

    lines = [
        f"Projeto: {project['name']} [{project['status']}]",
        f"Criado em: {project['created_at'][:10]}",
    ]
    if project.get("description"):
        lines.append(f"Descrição: {project['description']}")
    if project.get("technologies"):
        lines.append(f"Tecnologias: {', '.join(project['technologies'])}")
    if project.get("objectives"):
        lines.append("Objetivos:")
        for obj in project["objectives"]:
            lines.append(f"  - {obj}")
    if project.get("sessions"):
        lines.append(f"Conversas relacionadas: {len(project['sessions'])}")
    if project.get("documents"):
        lines.append(f"Documentos: {len(project['documents'])}")

    return "\n".join(lines)


def get_stats() -> dict:
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as n FROM projects").fetchone()["n"]
        by_status = conn.execute(
            "SELECT status, COUNT(*) as n FROM projects GROUP BY status"
        ).fetchall()
        links = conn.execute("SELECT COUNT(*) as n FROM project_sessions").fetchone()["n"]
    return {
        "total": total,
        "links": links,
        "by_status": {r["status"]: r["n"] for r in by_status},
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    for key in ("technologies", "objectives", "tags"):
        d[key] = json_loads(d.get(key) or "[]", fallback=[])
    return d
