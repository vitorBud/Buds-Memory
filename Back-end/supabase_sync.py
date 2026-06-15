"""
supabase_sync.py — sincronização local-first do Nexus IA.

O app continua funcionando offline com SQLite. Quando SUPABASE_URL e chave
estiverem configurados, este módulo envia snapshots locais para uma tabela
genérica no Supabase: nexus_sync_records.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
from pathlib import Path
from typing import Iterable, Optional

import requests

from database_v2 import get_db_connection, now_iso
from storage import get_env_path

BASE = Path(__file__).resolve().parent
ENV_FILE = BASE / ".env"

SYNC_TABLES = [
    "sessions",
    "messages",
    "knowledge_sources",
    "memories",
    "kg_entities",
    "kg_relations",
    "projects",
    "project_sessions",
    "project_documents",
    "timeline_events",
    "insights",
]

PULL_CHAT_TABLES = {"sessions", "messages"}


def load_env_file(path: Path = ENV_FILE):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(get_env_path())
load_env_file(ENV_FILE)


def get_supabase_config() -> dict:
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    enabled = os.getenv("SUPABASE_SYNC_ENABLED", "0").lower() in {"1", "true", "yes", "sim"}
    return {
        "enabled": enabled,
        "configured": bool(url and key),
        "url": url,
        "key": key,
        "table": os.getenv("SUPABASE_SYNC_TABLE", "nexus_sync_records"),
    }


def get_device_id() -> str:
    value = _get_state("device_id")
    if value:
        return value
    device_id = f"nexus-mac-{uuid.uuid4()}"
    _set_state("device_id", device_id)
    return device_id


def get_status() -> dict:
    config = get_supabase_config()
    return {
        "mode": "local-first",
        "online_sync_enabled": config["enabled"],
        "supabase_configured": config["configured"],
        "remote_table": config["table"],
        "device_id": get_device_id(),
        "last_sync_at": _get_state("last_sync_at"),
        "last_sync_error": _get_state("last_sync_error"),
        "local_records": count_local_records(),
    }


def count_local_records() -> dict:
    counts = {}
    with get_db_connection() as conn:
        for table in SYNC_TABLES:
            try:
                counts[table] = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            except Exception:
                counts[table] = 0
    counts["total"] = sum(counts.values())
    return counts


def run_sync(
    table: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
    mode: str = "both",
) -> dict:
    config = get_supabase_config()
    mode = mode if mode in {"both", "push", "pull"} else "both"
    records = [] if mode == "pull" else list(iter_sync_records(table=table, limit=limit))

    if dry_run:
        return {
            "success": True,
            "dry_run": True,
            "records_found": len(records),
            "status": get_status(),
        }

    if not config["enabled"]:
        return _sync_result(False, "Sync desativado. Defina SUPABASE_SYNC_ENABLED=1.", 0)
    if not config["configured"]:
        return _sync_result(False, "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY.", 0)

    try:
        uploaded = 0
        if mode != "pull" and records:
            for batch in _chunks(records, 100):
                _post_batch(config, batch)
                uploaded += len(batch)

        pulled = 0
        if mode != "push" and (not table or table in PULL_CHAT_TABLES):
            pulled = pull_chat_records(config, limit=limit)

        _set_state("last_sync_at", now_iso())
        _set_state("last_sync_error", "")
        if uploaded or pulled:
            return _sync_result(True, "Sincronização concluída.", uploaded, pulled)
        return _sync_result(True, "Nada novo para sincronizar.", 0, 0)
    except Exception as exc:
        _set_state("last_sync_error", str(exc))
        return _sync_result(False, str(exc), 0, 0)


def pull_chat_records(config: dict, limit: Optional[int] = None) -> int:
    """Importa sessoes e mensagens remotas para o SQLite local."""
    current_device_id = get_device_id()
    remote_records = _fetch_remote_chat_records(config, limit=limit)
    imported = 0

    session_records = [
        record for record in remote_records
        if record.get("table_name") == "sessions" and record.get("device_id") != current_device_id
    ]
    message_records = [
        record for record in remote_records
        if record.get("table_name") == "messages" and record.get("device_id") != current_device_id
    ]

    with get_db_connection() as conn:
        _ensure_sync_imports(conn)

        for record in session_records:
            if _import_session_record(conn, record):
                imported += 1

        for record in message_records:
            if _import_message_record(conn, record):
                imported += 1

        conn.commit()

    return imported


def _fetch_remote_chat_records(config: dict, limit: Optional[int] = None) -> list[dict]:
    url = f"{config['url']}/rest/v1/{config['table']}"
    params = {
        "select": "device_id,table_name,local_id,payload,updated_at",
        "table_name": "in.(sessions,messages)",
        "order": "updated_at.asc",
    }
    if limit:
        params["limit"] = str(limit)

    response = requests.get(url, headers=_supabase_headers(config), params=params, timeout=25)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase respondeu {response.status_code}: {response.text[:500]}")
    return response.json() or []


def iter_sync_records(table: Optional[str] = None, limit: Optional[int] = None) -> Iterable[dict]:
    device_id = get_device_id()
    selected_tables = [table] if table else SYNC_TABLES
    emitted = 0

    with get_db_connection() as conn:
        for table_name in selected_tables:
            if table_name not in SYNC_TABLES:
                continue

            try:
                rows = conn.execute(f"SELECT * FROM {table_name}").fetchall()
            except Exception:
                continue

            for row in rows:
                payload = _serialize_row(dict(row))
                local_id = _local_id(table_name, payload)
                yield {
                    "device_id": device_id,
                    "table_name": table_name,
                    "local_id": local_id,
                    "payload": payload,
                    "updated_at": _row_timestamp(payload),
                }
                emitted += 1
                if limit and emitted >= limit:
                    return


def _post_batch(config: dict, batch: list[dict]):
    url = f"{config['url']}/rest/v1/{config['table']}?on_conflict=device_id,table_name,local_id"
    headers = _supabase_headers(config)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    response = requests.post(url, headers=headers, json=batch, timeout=20)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase respondeu {response.status_code}: {response.text[:500]}")


def _supabase_headers(config: dict) -> dict:
    return {
        "apikey": config["key"],
        "Authorization": f"Bearer {config['key']}",
        "Content-Type": "application/json",
    }


def _serialize_row(row: dict) -> dict:
    data = {}
    for key, value in row.items():
        if isinstance(value, bytes):
            data[key] = {
                "__type": "base64",
                "value": base64.b64encode(value).decode("ascii"),
            }
        else:
            data[key] = value
    return data


def _local_id(table_name: str, row: dict) -> str:
    if table_name == "project_sessions":
        return f"{row.get('project_id')}:{row.get('session_id')}"
    return str(row.get("id") or row.get("local_id") or uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(row, sort_keys=True)))


def _row_timestamp(row: dict) -> str:
    for key in ("updated_at", "created_at", "last_seen", "last_activity", "event_date", "linked_at"):
        value = row.get(key)
        if value:
            return value
    return now_iso()


def _chunks(items: list, size: int):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _sync_result(success: bool, message: str, uploaded: int, pulled: int = 0) -> dict:
    return {
        "success": success,
        "message": message,
        "uploaded": uploaded,
        "pulled": pulled,
        "status": get_status(),
    }


def _import_session_record(conn, record: dict) -> bool:
    payload = record.get("payload") or {}
    session_id = str(payload.get("id") or "").strip()
    title = str(payload.get("title") or "").strip()
    created_at = str(payload.get("created_at") or record.get("updated_at") or now_iso())

    if not session_id or not title:
        return False

    conn.execute(
        """
        INSERT INTO sessions (id, title, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            created_at=COALESCE(sessions.created_at, excluded.created_at)
        """,
        (session_id, title, created_at),
    )
    return _mark_imported(conn, record)


def _import_message_record(conn, record: dict) -> bool:
    if _was_imported(conn, record):
        return False

    payload = record.get("payload") or {}
    session_id = str(payload.get("session_id") or "").strip()
    sender = str(payload.get("sender") or "").strip()
    text = str(payload.get("text") or "")
    audio_url = payload.get("audio_url")
    created_at = str(payload.get("created_at") or record.get("updated_at") or now_iso())

    if not session_id or sender not in {"user", "ia"} or not text:
        return False

    session_exists = conn.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session_exists:
        conn.execute(
            """
            INSERT INTO sessions (id, title, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (session_id, "Conversa sincronizada", created_at),
        )

    duplicate = conn.execute(
        """
        SELECT 1 FROM messages
        WHERE session_id=? AND sender=? AND text=? AND created_at=?
        LIMIT 1
        """,
        (session_id, sender, text, created_at),
    ).fetchone()
    if duplicate:
        return _mark_imported(conn, record)

    conn.execute(
        """
        INSERT INTO messages (session_id, sender, text, audio_url, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (session_id, sender, text, audio_url, created_at),
    )
    return _mark_imported(conn, record)


def _was_imported(conn, record: dict) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM sync_imports
        WHERE device_id=? AND table_name=? AND local_id=?
        LIMIT 1
        """,
        (record.get("device_id"), record.get("table_name"), record.get("local_id")),
    ).fetchone()
    return bool(row)


def _mark_imported(conn, record: dict) -> bool:
    if _was_imported(conn, record):
        return False

    conn.execute(
        """
        INSERT INTO sync_imports (device_id, table_name, local_id, imported_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(device_id, table_name, local_id) DO NOTHING
        """,
        (record.get("device_id"), record.get("table_name"), record.get("local_id"), now_iso()),
    )
    return True


def _get_state(key: str) -> Optional[str]:
    with get_db_connection() as conn:
        _ensure_sync_state(conn)
        row = conn.execute("SELECT value FROM sync_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _set_state(key: str, value: str):
    with get_db_connection() as conn:
        _ensure_sync_state(conn)
        conn.execute(
            """
            INSERT INTO sync_state (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """,
            (key, value or "", now_iso()),
        )
        conn.commit()


def _ensure_sync_state(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)


def _ensure_sync_imports(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_imports (
            device_id   TEXT NOT NULL,
            table_name  TEXT NOT NULL,
            local_id    TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            PRIMARY KEY (device_id, table_name, local_id)
        );
    """)
