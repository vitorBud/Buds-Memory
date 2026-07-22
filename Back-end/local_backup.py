"""
local_backup.py — exportação e importação portátil da memória local.

O Aether Memory é local-first: tudo fica no SQLite. Este módulo cria um backup
JSON autocontido para mover conversas, memórias, documentos, RAG, grafo e perfil
entre computadores sem depender de banco externo.
"""

from __future__ import annotations

import base64
import datetime
from typing import Any

from database_v2 import get_db_connection, now_iso


BACKUP_FORMAT = "aether_memory_backup"
BACKUP_VERSION = 1

BACKUP_TABLES = [
    "sessions",
    "messages",
    "knowledge_sources",
    "memories",
    "user_profile_facts",
    "conversation_summaries",
    "kg_entities",
    "kg_relations",
    "projects",
    "project_sessions",
    "project_documents",
    "timeline_events",
    "insights",
    "embeddings",
    "ingestion_cache",
    "codebase_index",
]


def export_backup() -> dict:
    """Exporta o estado local em JSON portátil."""
    tables: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}

    with get_db_connection() as conn:
        for table in BACKUP_TABLES:
            if not _table_exists(conn, table):
                continue
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            serialized = [_serialize_row(dict(row)) for row in rows]
            tables[table] = serialized
            counts[table] = len(serialized)

    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "app": "Aether Memory",
        "exported_at": now_iso(),
        "counts": counts,
        "tables": tables,
    }


def get_status() -> dict:
    """Retorna métricas locais para a UI de backup, sem depender de nuvem."""
    counts: dict[str, int] = {}

    with get_db_connection() as conn:
        for table in BACKUP_TABLES:
            if not _table_exists(conn, table):
                continue
            row = conn.execute(f"SELECT COUNT(*) AS n FROM {_quote_identifier(table)}").fetchone()
            counts[table] = int(row["n"] if row else 0)

    counts["total"] = sum(counts.values())
    return {
        "mode": "local-backup",
        "device_id": "local",
        "last_backup_error": None,
        "local_records": counts,
    }


def import_backup(payload: dict) -> dict:
    """Importa backup local em modo merge, preservando dados existentes."""
    if not isinstance(payload, dict):
        raise ValueError("Arquivo de backup inválido.")
    if payload.get("format") != BACKUP_FORMAT:
        raise ValueError("Este arquivo não parece ser um backup do Aether Memory.")

    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise ValueError("Backup sem bloco de tabelas.")

    imported: dict[str, int] = {}
    skipped: dict[str, int] = {}

    with get_db_connection() as conn:
        for table in BACKUP_TABLES:
            rows = tables.get(table) or []
            if not rows:
                imported[table] = 0
                skipped[table] = 0
                continue
            if not _table_exists(conn, table):
                imported[table] = 0
                skipped[table] = len(rows)
                continue

            columns = _table_columns(conn, table)
            count = 0
            ignored = 0
            for row in rows:
                if not isinstance(row, dict):
                    ignored += 1
                    continue
                clean = {
                    key: _deserialize_value(value)
                    for key, value in row.items()
                    if key in columns
                }
                if not clean:
                    ignored += 1
                    continue
                _upsert_row(conn, table, clean, columns)
                count += 1

            imported[table] = count
            skipped[table] = ignored

        conn.commit()

    return {
        "success": True,
        "message": "Backup local importado com sucesso.",
        "backup_exported_at": payload.get("exported_at"),
        "imported": imported,
        "skipped": skipped,
        "total_imported": sum(imported.values()),
    }


def make_backup_filename() -> str:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"aether-memory-backup-{stamp}.json"


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return bool(row)


def _table_columns(conn, table: str) -> dict[str, dict]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"]: dict(row) for row in rows}


def _primary_key_columns(columns: dict[str, dict]) -> list[str]:
    return [
        name
        for name, meta in sorted(columns.items(), key=lambda item: item[1].get("pk") or 0)
        if int(meta.get("pk") or 0) > 0
    ]


def _upsert_row(conn, table: str, row: dict, columns: dict[str, dict]) -> None:
    col_names = list(row.keys())
    placeholders = ", ".join("?" for _ in col_names)
    quoted_cols = ", ".join(_quote_identifier(col) for col in col_names)
    values = [row[col] for col in col_names]
    pk_cols = [col for col in _primary_key_columns(columns) if col in row]

    if pk_cols:
        update_cols = [col for col in col_names if col not in pk_cols]
        if update_cols:
            conflict_cols = ", ".join(_quote_identifier(col) for col in pk_cols)
            assignments = ", ".join(
                f"{_quote_identifier(col)}=excluded.{_quote_identifier(col)}"
                for col in update_cols
            )
            sql = (
                f"INSERT INTO {_quote_identifier(table)} ({quoted_cols}) "
                f"VALUES ({placeholders}) "
                f"ON CONFLICT({conflict_cols}) DO UPDATE SET {assignments}"
            )
            conn.execute(sql, values)
            return

    sql = (
        f"INSERT OR REPLACE INTO {_quote_identifier(table)} ({quoted_cols}) "
        f"VALUES ({placeholders})"
    )
    conn.execute(sql, values)


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _serialize_row(row: dict) -> dict:
    return {key: _serialize_value(value) for key, value in row.items()}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {
            "__type": "base64",
            "value": base64.b64encode(value).decode("ascii"),
        }
    return value


def _deserialize_value(value: Any) -> Any:
    if isinstance(value, dict) and value.get("__type") == "base64":
        encoded = value.get("value") or ""
        try:
            return base64.b64decode(encoded.encode("ascii"))
        except Exception:
            return b""
    return value
