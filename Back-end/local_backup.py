"""
local_backup.py — exportação e importação portátil da memória local.

O Buds Memory é local-first: tudo fica no SQLite. Este módulo cria um backup
JSON autocontido para mover conversas, memórias, documentos, RAG, grafo e perfil
entre computadores sem depender de banco externo.
"""

from __future__ import annotations

import base64
import contextlib
import datetime
import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from database_v2 import get_db_connection, now_iso
from storage import get_data_dir, get_database_path, get_output_dir


BACKUP_FORMAT = "buds_memory_backup"
LEGACY_BACKUP_FORMATS = {"aether_memory_backup"}
BACKUP_VERSION = 6
CLEAR_CONFIRMATION = "APAGAR TUDO"

BACKUP_TABLES = [
    "sessions",
    "messages",
    "knowledge_sources",
    "memories",
    "user_profile_facts",
    "conversation_summaries",
    "kg_entities",
    "kg_relations",
    "kg_entity_mentions",
    "projects",
    "project_sessions",
    "project_documents",
    "timeline_events",
    "insights",
    "embeddings",
    "ingestion_cache",
    "codebase_index",
]

# Extensão v5 opcional. Mantemos BACKUP_TABLES como o núcleo histórico do
# formato para que bancos/consumidores antigos continuem compatíveis, enquanto
# exportações atuais carregam também toda a central Focus quando ela existir.
FOCUS_BACKUP_TABLES = [
    "chat_folders",
    "focus_tasks",
    "focus_ideas",
    "focus_decisions",
    "focus_timeline",
    "focus_inbox",
    "location_places",
    "location_state",
    "location_events",
    "location_routes",
    "location_route_points",
]
PORTABLE_TABLES = [*BACKUP_TABLES, *FOCUS_BACKUP_TABLES]

# A ordem respeita as dependências entre tabelas. Ela é deliberadamente
# separada de BACKUP_TABLES, cuja ordem faz parte do formato público antigo.
IMPORT_ORDER = [
    "chat_folders",
    "sessions",
    "messages",
    "knowledge_sources",
    "user_profile_facts",
    "kg_entities",
    "projects",
    "memories",
    "conversation_summaries",
    "focus_tasks",
    "focus_ideas",
    "focus_decisions",
    "focus_timeline",
    "focus_inbox",
    "location_places",
    "location_state",
    "location_events",
    "location_routes",
    "location_route_points",
    "kg_relations",
    "kg_entity_mentions",
    "project_sessions",
    "project_documents",
    "timeline_events",
    "insights",
    "codebase_index",
    "embeddings",
    "ingestion_cache",
]

IMPORT_MAP_TABLE = "buds_backup_import_map"
LEGACY_IMPORT_MAP_TABLE = "aether_backup_import_map"

# Apaga primeiro as tabelas dependentes e deixa sessões por último. A lista é
# explícita para não apagar configurações técnicas ou tabelas futuras por engano.
CLEAR_ORDER = [
    IMPORT_MAP_TABLE,
    LEGACY_IMPORT_MAP_TABLE,
    "embeddings",
    "ingestion_cache",
    "codebase_index",
    "insights",
    "timeline_events",
    "project_documents",
    "project_sessions",
    "conversation_summaries",
    "focus_inbox",
    "location_route_points",
    "location_routes",
    "location_events",
    "location_state",
    "location_places",
    "focus_timeline",
    "focus_decisions",
    "focus_ideas",
    "focus_tasks",
    "kg_entity_mentions",
    "kg_relations",
    "memories",
    "user_profile_facts",
    "knowledge_sources",
    "messages",
    "projects",
    "kg_entities",
    "sessions",
    "chat_folders",
]

# Referências diretas. Referências polimórficas são tratadas separadamente em
# _remap_row para que source_table/source_id continuem apontando para o registro
# importado mesmo quando sua chave primária colidir no computador de destino.
DIRECT_REFERENCES = {
    "sessions": {"folder_id": "chat_folders"},
    "messages": {"session_id": "sessions"},
    "knowledge_sources": {"session_id": "sessions"},
    "memories": {"session_id": "sessions"},
    "user_profile_facts": {"session_id": "sessions"},
    "conversation_summaries": {"session_id": "sessions"},
    "focus_tasks": {"source_session_id": "sessions", "source_message_id": "messages"},
    "location_state": {"place_id": "location_places"},
    "location_events": {"place_id": "location_places"},
    "location_route_points": {"route_id": "location_routes"},
    "kg_relations": {
        "source_id": "kg_entities",
        "target_id": "kg_entities",
    },
    "kg_entity_mentions": {
        "entity_id": "kg_entities",
        "session_id": "sessions",
    },
    "project_sessions": {
        "project_id": "projects",
        "session_id": "sessions",
    },
    "project_documents": {
        "project_id": "projects",
        "knowledge_source_id": "knowledge_sources",
    },
    "timeline_events": {"session_id": "sessions"},
}

NATURAL_UNIQUES = {
    "chat_folders": (("name",),),
    "user_profile_facts": (("fact_key", "fact_value"),),
    "kg_entities": (("name",),),
    "kg_relations": (("source_id", "target_id", "relation_type"),),
    "focus_tasks": (("dedup_key",),),
    "focus_inbox": (("dedup_key",),),
    "location_places": (("name", "context", "latitude", "longitude"),),
}

TIMELINE_ENTITY_TABLES = {
    "project": "projects",
    "projects": "projects",
    "knowledge_source": "knowledge_sources",
    "knowledge_sources": "knowledge_sources",
    "memory": "memories",
    "memories": "memories",
    "kg_entity": "kg_entities",
    "entity": "kg_entities",
}


def export_backup() -> dict:
    """Exporta o estado local em JSON portátil."""
    tables: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}

    with get_db_connection() as conn:
        for table in PORTABLE_TABLES:
            if not _table_exists(conn, table):
                continue
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            serialized = [_serialize_row(dict(row)) for row in rows]
            tables[table] = serialized
            counts[table] = len(serialized)

    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "app": "Buds Memory",
        "exported_at": now_iso(),
        "counts": counts,
        "tables": tables,
    }


def get_status() -> dict:
    """Retorna métricas locais para a UI de backup, sem depender de nuvem."""
    counts: dict[str, int] = {}

    with get_db_connection() as conn:
        for table in PORTABLE_TABLES:
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
        "storage": _storage_usage(),
    }


def get_conversation_storage() -> dict:
    """Lista dados por conversa, inclusive chats retirados da barra lateral."""
    conversations: list[dict] = []
    with get_db_connection() as conn:
        if not _table_exists(conn, "sessions"):
            return {"conversations": [], "orphaned": []}

        rows = conn.execute(
            "SELECT id, title, created_at, deleted_at FROM sessions ORDER BY deleted_at IS NULL, COALESCE(deleted_at, created_at) DESC"
        ).fetchall()
        for row in rows:
            conversations.append(_conversation_storage_row(conn, dict(row)))

        orphan_ids: set[str] = set()
        for table in ("user_profile_facts", "timeline_events"):
            if not _table_exists(conn, table):
                continue
            found = conn.execute(
                f"""
                SELECT DISTINCT source.session_id
                FROM {_quote_identifier(table)} source
                LEFT JOIN sessions ON sessions.id=source.session_id
                WHERE source.session_id IS NOT NULL AND sessions.id IS NULL
                """
            ).fetchall()
            orphan_ids.update(str(item["session_id"]) for item in found if item["session_id"])

        orphaned = [
            _orphan_storage_row(conn, session_id)
            for session_id in sorted(orphan_ids)
        ]

    return {"conversations": conversations, "orphaned": orphaned}


def purge_conversation_data(session_id: str, confirmation: str) -> dict:
    """Remove definitivamente uma conversa e todos os dados atribuíveis a ela."""
    session_id = str(session_id or "").strip()
    if not session_id or confirmation != f"APAGAR:{session_id}":
        raise ValueError("Confirmação inválida para a exclusão desta conversa.")

    with contextlib.closing(get_db_connection()) as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            session = conn.execute("SELECT id FROM sessions WHERE id=?", (session_id,)).fetchone()
            has_orphan_data = _has_orphan_conversation_data(conn, session_id)
            if not session and not has_orphan_data:
                raise ValueError("Conversa ou dados associados não encontrados.")

            fact_ids = _ids_for_session(conn, "user_profile_facts", session_id)
            entity_ids = _ids_for_session(conn, "kg_entity_mentions", session_id, column="entity_id")
            _delete_memories_for_conversation(conn, session_id, fact_ids)

            if _table_exists(conn, "timeline_events"):
                conn.execute("DELETE FROM timeline_events WHERE session_id=?", (session_id,))
            if _table_exists(conn, "user_profile_facts"):
                conn.execute("DELETE FROM user_profile_facts WHERE session_id=?", (session_id,))

            if session:
                conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))

            # Só remove nós que passaram a não possuir qualquer outra origem.
            if entity_ids and _table_exists(conn, "kg_entity_mentions"):
                placeholders = ",".join("?" for _ in entity_ids)
                conn.execute(
                    f"""
                    DELETE FROM kg_entities
                    WHERE id IN ({placeholders})
                      AND NOT EXISTS (
                          SELECT 1 FROM kg_entity_mentions m
                          WHERE m.entity_id=kg_entities.id
                      )
                    """,
                    entity_ids,
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return get_conversation_storage()


def _conversation_storage_row(conn, session: dict) -> dict:
    session_id = session["id"]
    messages = _count_for_session(conn, "messages", session_id)
    knowledge = _count_for_session(conn, "knowledge_sources", session_id)
    memories = _count_for_session(conn, "memories", session_id)
    facts = _count_for_session(conn, "user_profile_facts", session_id)
    timeline = _count_for_session(conn, "timeline_events", session_id)
    graph = _count_for_session(conn, "kg_entity_mentions", session_id)
    estimated = _session_text_bytes(conn, session_id)
    return {
        **session,
        "state": "removed" if session.get("deleted_at") else "active",
        "message_count": messages,
        "knowledge_count": knowledge,
        "memory_count": memories + facts,
        "timeline_count": timeline,
        "graph_count": graph,
        "total_records": messages + knowledge + memories + facts + timeline + graph + 1,
        "estimated_bytes": estimated,
    }


def _orphan_storage_row(conn, session_id: str) -> dict:
    facts = _count_for_session(conn, "user_profile_facts", session_id)
    timeline = _count_for_session(conn, "timeline_events", session_id)
    direct_memories = _count_for_session(conn, "memories", session_id)
    fact_ids = _ids_for_session(conn, "user_profile_facts", session_id)
    linked_memories = _count_profile_memories(conn, fact_ids)
    total = facts + timeline + direct_memories + linked_memories
    return {
        "id": session_id,
        "title": f"Conversa removida · {session_id[:8]}",
        "created_at": None,
        "deleted_at": None,
        "state": "orphaned",
        "message_count": 0,
        "knowledge_count": 0,
        "memory_count": direct_memories + facts + linked_memories,
        "timeline_count": timeline,
        "graph_count": 0,
        "total_records": total,
        "estimated_bytes": 0,
    }


def _has_orphan_conversation_data(conn, session_id: str) -> bool:
    return any(
        _count_for_session(conn, table, session_id) > 0
        for table in ("user_profile_facts", "timeline_events", "memories")
    )


def _count_for_session(conn, table: str, session_id: str) -> int:
    if not _table_exists(conn, table):
        return 0
    row = conn.execute(
        f"SELECT COUNT(*) AS n FROM {_quote_identifier(table)} WHERE session_id=?",
        (session_id,),
    ).fetchone()
    return int(row["n"] if row else 0)


def _ids_for_session(conn, table: str, session_id: str, column: str = "id") -> list[int]:
    if not _table_exists(conn, table):
        return []
    rows = conn.execute(
        f"SELECT {_quote_identifier(column)} AS id FROM {_quote_identifier(table)} WHERE session_id=?",
        (session_id,),
    ).fetchall()
    return [int(row["id"]) for row in rows]


def _count_profile_memories(conn, fact_ids: list[int]) -> int:
    if not fact_ids or not _table_exists(conn, "memories"):
        return 0
    placeholders = ",".join("?" for _ in fact_ids)
    row = conn.execute(
        f"""
        SELECT COUNT(*) AS n FROM memories
        WHERE source_table='user_profile_facts' AND source_id IN ({placeholders})
        """,
        fact_ids,
    ).fetchone()
    return int(row["n"] if row else 0)


def _delete_memories_for_conversation(conn, session_id: str, fact_ids: list[int]) -> None:
    if not _table_exists(conn, "memories"):
        return
    conn.execute("DELETE FROM memories WHERE session_id=?", (session_id,))
    if fact_ids:
        placeholders = ",".join("?" for _ in fact_ids)
        conn.execute(
            f"""
            DELETE FROM memories
            WHERE source_table='user_profile_facts' AND source_id IN ({placeholders})
            """,
            fact_ids,
        )


def _session_text_bytes(conn, session_id: str) -> int:
    total = 0
    queries = (
        ("messages", "text"),
        ("knowledge_sources", "content"),
        ("memories", "content"),
        ("user_profile_facts", "fact_value"),
    )
    for table, column in queries:
        if not _table_exists(conn, table):
            continue
        row = conn.execute(
            f"SELECT COALESCE(SUM(LENGTH({_quote_identifier(column)})), 0) AS n FROM {_quote_identifier(table)} WHERE session_id=?",
            (session_id,),
        ).fetchone()
        total += int(row["n"] if row else 0)
    return total


def clear_local_data(confirmation: str) -> dict:
    """Apaga somente dados gerados pelo Buds após confirmação explícita."""
    if confirmation != CLEAR_CONFIRMATION:
        raise ValueError(f'Digite exatamente "{CLEAR_CONFIRMATION}" para confirmar.')

    with contextlib.closing(get_db_connection()) as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            for table in CLEAR_ORDER:
                if _table_exists(conn, table):
                    conn.execute(f"DELETE FROM {_quote_identifier(table)}")
            if _table_exists(conn, "sqlite_sequence"):
                conn.execute("DELETE FROM sqlite_sequence")
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        # São otimizações de espaço: os dados já foram apagados mesmo que uma
        # conexão concorrente impeça temporariamente o checkpoint ou o VACUUM.
        with contextlib.suppress(Exception):
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
        with contextlib.suppress(Exception):
            conn.execute("VACUUM")

    output_dir = get_output_dir()
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    return get_status()


def _storage_usage() -> dict[str, int]:
    database_path = get_database_path()
    database_bytes = sum(
        _path_size(Path(f"{database_path}{suffix}"))
        for suffix in ("", "-wal", "-shm")
    )
    audio_bytes = _path_size(get_output_dir())
    try:
        available_bytes = int(shutil.disk_usage(get_data_dir()).free)
    except OSError:
        available_bytes = 0
    return {
        "used_bytes": database_bytes + audio_bytes,
        "database_bytes": database_bytes,
        "model_bytes": 0,
        "audio_bytes": audio_bytes,
        "available_bytes": available_bytes,
    }


def _path_size(path: Path) -> int:
    try:
        if path.is_file():
            return int(path.stat().st_size)
        if not path.is_dir():
            return 0
        return sum(
            int(child.stat().st_size)
            for child in path.rglob("*")
            if child.is_file()
        )
    except OSError:
        return 0


def import_backup(payload: dict) -> dict:
    """
    Importa backup local em modo merge sem substituir registros do destino.

    Chaves importadas são preservadas quando estão livres e recebem novas
    chaves quando colidem. Todas as referências internas são remapeadas dentro
    da mesma transação. Um mapa local, não exportado, torna a reimportação do
    mesmo arquivo idempotente.
    """
    if not isinstance(payload, dict):
        raise ValueError("Arquivo de backup inválido.")
    if payload.get("format") not in {BACKUP_FORMAT, *LEGACY_BACKUP_FORMATS}:
        raise ValueError("Este arquivo não parece ser um backup do Buds Memory.")

    version = payload.get("version", 1)
    if not isinstance(version, int) or version < 1 or version > BACKUP_VERSION:
        raise ValueError(
            f"Versão de backup não suportada: {version!r}. "
            f"Esta instalação aceita versões de 1 a {BACKUP_VERSION}."
        )

    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise ValueError("Backup sem bloco de tabelas.")

    imported: dict[str, int] = {}
    skipped: dict[str, int] = {}
    backup_key = _backup_fingerprint(payload)
    mappings: dict[str, dict[str, Any]] = {}

    with contextlib.closing(get_db_connection()) as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            _create_import_map_table(conn)
            mappings = _load_import_mappings(conn, backup_key)

            for table in IMPORT_ORDER:
                rows = tables.get(table) or []
                if not isinstance(rows, list):
                    raise ValueError(f"Tabela inválida no backup: {table}.")
                imported[table] = 0
                skipped[table] = 0
                if not rows:
                    continue
                if not _table_exists(conn, table):
                    skipped[table] = len(rows)
                    continue

                columns = _table_columns(conn, table)
                pk_cols = _primary_key_columns(columns)
                table_mappings = mappings.setdefault(table, {})

                for row_index, row in enumerate(rows):
                    if not isinstance(row, dict):
                        skipped[table] += 1
                        continue

                    clean = {
                        key: _deserialize_value(value)
                        for key, value in row.items()
                        if key in columns
                    }
                    if not clean:
                        skipped[table] += 1
                        continue

                    source_key = _row_source_key(clean, pk_cols, row_index)
                    previous_target = table_mappings.get(source_key)
                    if previous_target is not None and _target_exists(
                        conn, table, pk_cols, previous_target
                    ):
                        skipped[table] += 1
                        continue

                    remapped = _remap_row(clean, table, mappings)
                    target_key, was_inserted = _insert_without_overwrite(
                        conn,
                        table,
                        remapped,
                        columns,
                        pk_cols,
                    )
                    table_mappings[source_key] = target_key
                    _save_import_mapping(
                        conn,
                        backup_key,
                        table,
                        source_key,
                        target_key,
                    )
                    if was_inserted:
                        imported[table] += 1
                    else:
                        skipped[table] += 1

            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "success": True,
        "message": "Backup local importado com sucesso.",
        "backup_exported_at": payload.get("exported_at"),
        "imported": imported,
        "skipped": skipped,
        "total_imported": sum(imported.values()),
        "idempotent": sum(imported.values()) == 0,
    }


def make_backup_filename() -> str:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"buds-memory-backup-{stamp}.json"


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


def _create_import_map_table(conn) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {_quote_identifier(IMPORT_MAP_TABLE)} (
            backup_key TEXT NOT NULL,
            table_name TEXT NOT NULL,
            source_key TEXT NOT NULL,
            target_key TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            PRIMARY KEY (backup_key, table_name, source_key)
        )
    """)
    if _table_exists(conn, LEGACY_IMPORT_MAP_TABLE):
        conn.execute(f"""
            INSERT OR IGNORE INTO {_quote_identifier(IMPORT_MAP_TABLE)}
              (backup_key, table_name, source_key, target_key, imported_at)
            SELECT backup_key, table_name, source_key, target_key, imported_at
            FROM {_quote_identifier(LEGACY_IMPORT_MAP_TABLE)}
        """)


def _backup_fingerprint(payload: dict) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _json_key(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _row_source_key(row: dict, pk_cols: list[str], row_index: int) -> str:
    if pk_cols and all(column in row for column in pk_cols):
        return _json_key([row[column] for column in pk_cols])
    return _json_key(["__row__", row_index])


def _load_import_mappings(conn, backup_key: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT table_name, source_key, target_key
        FROM {_quote_identifier(IMPORT_MAP_TABLE)}
        WHERE backup_key=?
        """,
        (backup_key,),
    ).fetchall()
    mappings: dict[str, dict[str, Any]] = {}
    for row in rows:
        try:
            target_key = json.loads(row["target_key"])
        except Exception:
            continue
        mappings.setdefault(row["table_name"], {})[row["source_key"]] = target_key
    return mappings


def _save_import_mapping(
    conn,
    backup_key: str,
    table: str,
    source_key: str,
    target_key: Any,
) -> None:
    conn.execute(
        f"""
        INSERT INTO {_quote_identifier(IMPORT_MAP_TABLE)}
          (backup_key, table_name, source_key, target_key, imported_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(backup_key, table_name, source_key) DO UPDATE SET
          target_key=excluded.target_key,
          imported_at=excluded.imported_at
        """,
        (backup_key, table, source_key, _json_key(target_key), now_iso()),
    )


def _lookup_mapping(
    mappings: dict[str, dict[str, Any]],
    table: str,
    source_value: Any,
) -> Any:
    source_key = _json_key([source_value])
    target = mappings.get(table, {}).get(source_key)
    if isinstance(target, list) and len(target) == 1:
        return target[0]
    return source_value


def _remap_row(
    row: dict,
    table: str,
    mappings: dict[str, dict[str, Any]],
) -> dict:
    remapped = dict(row)

    for column, parent_table in DIRECT_REFERENCES.get(table, {}).items():
        if remapped.get(column) is not None:
            remapped[column] = _lookup_mapping(
                mappings, parent_table, remapped[column]
            )

    if table in {"embeddings", "ingestion_cache"}:
        source_table = remapped.get("source_table")
        if source_table and remapped.get("source_id") is not None:
            remapped["source_id"] = _lookup_mapping(
                mappings, str(source_table), remapped["source_id"]
            )

    if table == "memories":
        if "scope" not in remapped:
            is_global = bool(remapped.get("is_core")) or bool(remapped.get("user_confirmed"))
            is_global = is_global or str(remapped.get("origin_type") or "").lower() in {
                "profile", "manual", "core"
            }
            remapped["scope"] = "global" if is_global or not remapped.get("session_id") else "conversation"
        source_table = remapped.get("source_table")
        if source_table and remapped.get("source_id") is not None:
            remapped["source_id"] = _lookup_mapping(
                mappings, str(source_table), remapped["source_id"]
            )
        origin_table = _origin_reference_table(remapped.get("origin_type"))
        if origin_table and remapped.get("origin_id") not in (None, ""):
            original = remapped["origin_id"]
            mapped = _lookup_mapping(mappings, origin_table, _coerce_id(original))
            remapped["origin_id"] = str(mapped)

    if table == "timeline_events":
        entity_table = TIMELINE_ENTITY_TABLES.get(
            str(remapped.get("entity_type") or "").lower()
        )
        if entity_table and remapped.get("entity_id") is not None:
            remapped["entity_id"] = _lookup_mapping(
                mappings, entity_table, remapped["entity_id"]
            )

    return remapped


def _origin_reference_table(origin_type: Any) -> str | None:
    value = str(origin_type or "").lower()
    return {
        "profile": "user_profile_facts",
        "conversation": "messages",
        "message": "messages",
        "document": "knowledge_sources",
        "knowledge": "knowledge_sources",
    }.get(value)


def _coerce_id(value: Any) -> Any:
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _target_exists(
    conn,
    table: str,
    pk_cols: list[str],
    target_key: Any,
) -> bool:
    if not pk_cols or not isinstance(target_key, list) or len(target_key) != len(pk_cols):
        return False
    where = " AND ".join(f"{_quote_identifier(col)}=?" for col in pk_cols)
    return bool(
        conn.execute(
            f"SELECT 1 FROM {_quote_identifier(table)} WHERE {where} LIMIT 1",
            target_key,
        ).fetchone()
    )


def _insert_without_overwrite(
    conn,
    table: str,
    row: dict,
    columns: dict[str, dict],
    pk_cols: list[str],
) -> tuple[list[Any], bool]:
    # O estado representa o lugar atual desta instalação. Em um merge, nunca
    # substituímos esse dado vivo por uma posição possivelmente antiga do backup.
    if table == "location_state":
        current = conn.execute("SELECT id FROM location_state WHERE id=1").fetchone()
        if current:
            return [current["id"]], False

    existing_key = _find_identical_primary_key(conn, table, row, pk_cols)
    if existing_key is not None:
        return existing_key, False

    natural_key = _find_natural_duplicate(conn, table, row, pk_cols)
    if natural_key is not None:
        return natural_key, False

    candidate = dict(row)
    if pk_cols and all(column in candidate for column in pk_cols):
        source_pk = [candidate[column] for column in pk_cols]
        if _target_exists(conn, table, pk_cols, source_pk):
            if len(pk_cols) == 1 and _is_integer_primary_key(columns[pk_cols[0]]):
                candidate.pop(pk_cols[0], None)
            elif table == "sessions":
                candidate["id"] = str(uuid.uuid4())
            else:
                # PK composta representa uma relação. Depois do remapeamento,
                # conflito significa que o vínculo já existe e deve ser mantido.
                return source_pk, False

    cursor = _insert_row(conn, table, candidate)
    if len(pk_cols) == 1:
        pk_column = pk_cols[0]
        if pk_column in candidate:
            target_key = [candidate[pk_column]]
        elif _is_integer_primary_key(columns[pk_column]):
            target_key = [cursor.lastrowid]
        else:
            raise ValueError(f"Não foi possível gerar a chave de {table}.")
    else:
        target_key = [candidate[column] for column in pk_cols]
    return target_key, True


def _find_identical_primary_key(
    conn,
    table: str,
    row: dict,
    pk_cols: list[str],
) -> list[Any] | None:
    if not pk_cols or not all(column in row for column in pk_cols):
        return None
    key = [row[column] for column in pk_cols]
    if not _target_exists(conn, table, pk_cols, key):
        return None
    where = " AND ".join(f"{_quote_identifier(col)}=?" for col in pk_cols)
    existing = conn.execute(
        f"SELECT * FROM {_quote_identifier(table)} WHERE {where} LIMIT 1",
        key,
    ).fetchone()
    if not existing:
        return None
    existing_dict = dict(existing)
    comparable = {
        column: value for column, value in row.items() if column in existing_dict
    }
    if all(existing_dict[column] == value for column, value in comparable.items()):
        return key
    return None


def _find_natural_duplicate(
    conn,
    table: str,
    row: dict,
    pk_cols: list[str],
) -> list[Any] | None:
    for unique_columns in NATURAL_UNIQUES.get(table, ()):
        if not all(column in row for column in unique_columns):
            continue
        where = " AND ".join(
            f"{_quote_identifier(column)}=?" for column in unique_columns
        )
        values = [row[column] for column in unique_columns]
        existing = conn.execute(
            f"SELECT * FROM {_quote_identifier(table)} WHERE {where} LIMIT 1",
            values,
        ).fetchone()
        if existing:
            return [existing[column] for column in pk_cols]
    return None


def _is_integer_primary_key(column: dict) -> bool:
    return "INT" in str(column.get("type") or "").upper()


def _insert_row(conn, table: str, row: dict):
    col_names = list(row.keys())
    placeholders = ", ".join("?" for _ in col_names)
    quoted_cols = ", ".join(_quote_identifier(col) for col in col_names)
    values = [row[col] for col in col_names]
    return conn.execute(
        f"INSERT INTO {_quote_identifier(table)} ({quoted_cols}) "
        f"VALUES ({placeholders})",
        values,
    )


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
