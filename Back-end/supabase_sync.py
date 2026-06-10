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


def run_sync(table: Optional[str] = None, limit: Optional[int] = None, dry_run: bool = False) -> dict:
    config = get_supabase_config()
    records = list(iter_sync_records(table=table, limit=limit))

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
    if not records:
        _set_state("last_sync_at", now_iso())
        _set_state("last_sync_error", "")
        return _sync_result(True, "Nada novo para sincronizar.", 0)

    try:
        uploaded = 0
        for batch in _chunks(records, 100):
            _post_batch(config, batch)
            uploaded += len(batch)

        _set_state("last_sync_at", now_iso())
        _set_state("last_sync_error", "")
        return _sync_result(True, "Sincronização concluída.", uploaded)
    except Exception as exc:
        _set_state("last_sync_error", str(exc))
        return _sync_result(False, str(exc), 0)


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
    headers = {
        "apikey": config["key"],
        "Authorization": f"Bearer {config['key']}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    response = requests.post(url, headers=headers, json=batch, timeout=20)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase respondeu {response.status_code}: {response.text[:500]}")


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


def _sync_result(success: bool, message: str, uploaded: int) -> dict:
    return {
        "success": success,
        "message": message,
        "uploaded": uploaded,
        "status": get_status(),
    }


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
