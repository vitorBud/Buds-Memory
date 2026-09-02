"""
database_v2.py — Migração não-destrutiva do banco cognitivo Buds Memory.

Adiciona as tabelas do Second Brain sem tocar nas tabelas existentes
(sessions, messages, knowledge_sources). Seguro para rodar múltiplas vezes.
"""

import sqlite3
import json
import platform
import socket
import uuid
from pathlib import Path
import datetime
from storage import get_database_path

BASE = Path(__file__).resolve().parent
DB_PATH = get_database_path()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        result = super().__exit__(exc_type, exc_value, traceback)
        self.close()
        return result


def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def migrate():
    """Executa todas as migrações cognitivas de forma idempotente."""
    with get_db_connection() as conn:
        _create_memories(conn)
        _create_user_profile(conn)
        _create_knowledge_graph(conn)
        _create_projects(conn)
        _create_timeline(conn)
        _create_insights(conn)
        _create_embeddings(conn)
        _create_ingestion_cache(conn)
        _create_backup_import_map(conn)
        _create_conversation_summaries(conn)
        _create_codebase_index(conn)
        _create_focus_tasks(conn)
        _create_focus_v2_tables(conn)
        _create_finance_tables(conn)
        _migrate_focus_capture_columns(conn)
        _create_local_sync_v0(conn)
        _upgrade_local_sync_v1(conn)
        _create_location_context(conn)
        _create_chat_folders(conn)
        _migrate_session_retention(conn)
        _migrate_memories_core_columns(conn)
        _migrate_memory_scope(conn)
        _migrate_knowledge_source_intelligence(conn)
        _migrate_embeddings_metadata(conn)
        _migrate_entity_mention_counts(conn)
        _create_graph_provenance(conn)
        _create_indexes(conn)
        _create_rag_cleanup_triggers(conn)
        _cleanup_orphaned_rag(conn)
        _create_fts_tables(conn)
        conn.commit()
    print("[DB v2] Migração cognitiva concluída com sucesso.")


def _create_focus_tasks(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_tasks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT    NOT NULL,
            category     TEXT    DEFAULT 'other',
            priority     TEXT    DEFAULT 'medium',
            completed    BOOLEAN DEFAULT 0,
            is_focus     BOOLEAN DEFAULT 0,
            created_at   TEXT    NOT NULL,
            updated_at   TEXT    NOT NULL,
            due_date     TEXT,
            item_type    TEXT    NOT NULL DEFAULT 'TASK',
            source       TEXT    NOT NULL DEFAULT 'manual',
            source_session_id TEXT,
            source_message_id INTEGER,
            dedup_key    TEXT,
            confidence   REAL    NOT NULL DEFAULT 1.0
        );
    """)


def _create_finance_tables(conn):
    """Livro financeiro pessoal, local e independente do texto do chat."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS finance_transactions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            kind          TEXT NOT NULL CHECK(kind IN ('income','expense','investment','card')),
            amount_cents  INTEGER NOT NULL CHECK(amount_cents > 0),
            description   TEXT NOT NULL,
            category      TEXT NOT NULL DEFAULT 'Outros',
            occurred_on   TEXT NOT NULL,
            invoice_month TEXT,
            status        TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','pending','paid')),
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_finance_month "
        "ON finance_transactions(occurred_on,invoice_month,kind,status)"
    )

def _create_focus_v2_tables(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_ideas (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content      TEXT    NOT NULL,
            status       TEXT    DEFAULT 'active',
            source       TEXT    DEFAULT 'dump',
            created_at   TEXT    NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_decisions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content      TEXT    NOT NULL,
            source       TEXT    DEFAULT 'dump',
            created_at   TEXT    NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_timeline (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type   TEXT    NOT NULL,
            title        TEXT    NOT NULL,
            details      TEXT    DEFAULT '{}',
            created_at   TEXT    NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_inbox (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type    TEXT    NOT NULL,
            content      TEXT    NOT NULL,
            metadata     TEXT    DEFAULT '{}',
            source       TEXT    DEFAULT 'chat',
            status       TEXT    DEFAULT 'pending',
            created_at   TEXT    NOT NULL,
            dedup_key    TEXT
        );
    """)


def _migrate_focus_capture_columns(conn):
    """Expande o Focus sem recriar tabelas ou perder dados existentes."""
    _add_column_if_missing(conn, "focus_tasks", "item_type", "TEXT NOT NULL DEFAULT 'TASK'")
    _add_column_if_missing(conn, "focus_tasks", "source", "TEXT NOT NULL DEFAULT 'manual'")
    _add_column_if_missing(conn, "focus_tasks", "source_session_id", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "source_message_id", "INTEGER")
    _add_column_if_missing(conn, "focus_tasks", "dedup_key", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "confidence", "REAL NOT NULL DEFAULT 1.0")
    _add_column_if_missing(conn, "focus_inbox", "dedup_key", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "place_context", "TEXT NOT NULL DEFAULT 'anywhere'")
    _add_column_if_missing(conn, "focus_tasks", "trigger_on_arrival", "BOOLEAN NOT NULL DEFAULT 0")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_tasks_dedup "
        "ON focus_tasks(dedup_key) WHERE dedup_key IS NOT NULL AND completed=0"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_inbox_dedup "
        "ON focus_inbox(dedup_key) WHERE dedup_key IS NOT NULL AND status='pending'"
    )


def _create_local_sync_v0(conn):
    """Cria a base compatível do Local Sync e prepara deltas do Focus.

    O nome da migração permanece ``v0`` porque bancos já instalados dependem
    dele. O protocolo atual também usa tabelas/colunas adicionadas por migrações
    posteriores para receber chats, pastas, mensagens e memórias do iPhone.
    O ``id`` inteiro continua sendo a chave local da UI; ``sync_uid`` identifica
    a mesma tarefa Focus entre instalações independentes.
    """
    _add_column_if_missing(conn, "focus_tasks", "sync_uid", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "sync_version", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "focus_tasks", "sync_origin_device_id", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "sync_modified_at", "TEXT")
    _add_column_if_missing(conn, "focus_tasks", "deleted_at", "TEXT")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_device (
            singleton       INTEGER PRIMARY KEY CHECK(singleton = 1),
            device_id       TEXT NOT NULL UNIQUE,
            device_name     TEXT NOT NULL,
            device_type     TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_trusted_peers (
            peer_device_id  TEXT PRIMARY KEY,
            device_name     TEXT NOT NULL,
            device_type     TEXT NOT NULL,
            token_hash      TEXT NOT NULL,
            paired_at       TEXT NOT NULL,
            last_seen_at    TEXT,
            revoked_at      TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_peer_state (
            peer_device_id       TEXT PRIMARY KEY,
            last_remote_seq      INTEGER NOT NULL DEFAULT 0,
            last_acknowledged_seq INTEGER NOT NULL DEFAULT 0,
            last_sync_at         TEXT,
            last_error           TEXT,
            FOREIGN KEY(peer_device_id)
                REFERENCES local_sync_trusted_peers(peer_device_id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_changes (
            seq              INTEGER PRIMARY KEY AUTOINCREMENT,
            change_id        TEXT NOT NULL UNIQUE,
            entity_type      TEXT NOT NULL CHECK(entity_type = 'focus_task'),
            entity_uid       TEXT NOT NULL,
            entity_version   INTEGER NOT NULL,
            origin_device_id TEXT NOT NULL,
            changed_at       TEXT NOT NULL
        )
    """)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_tasks_sync_uid "
        "ON focus_tasks(sync_uid) WHERE sync_uid IS NOT NULL"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_sync_changes_seq "
        "ON local_sync_changes(seq, entity_type)"
    )

    now = datetime.datetime.utcnow().isoformat()
    existing_device = conn.execute(
        "SELECT device_id FROM local_sync_device WHERE singleton=1"
    ).fetchone()
    if existing_device:
        device_id = str(existing_device["device_id"])
    else:
        system = platform.system().lower()
        device_type = "mac" if system == "darwin" else ("windows" if system == "windows" else "desktop")
        device_id = str(uuid.uuid4())
        device_name = socket.gethostname().split(".", 1)[0] or "Buds Desktop"
        conn.execute(
            """INSERT INTO local_sync_device
               (singleton,device_id,device_name,device_type,created_at,updated_at)
               VALUES (1,?,?,?,?,?)""",
            (device_id, device_name[:100], device_type, now, now),
        )

    # Tarefas anteriores à V0 tornam-se mudanças locais iniciais. A migração é
    # idempotente: somente linhas ainda sem UUID entram no change log.
    legacy_rows = conn.execute(
        "SELECT id,updated_at FROM focus_tasks WHERE sync_uid IS NULL OR sync_uid=''"
    ).fetchall()
    for row in legacy_rows:
        task_uid = str(uuid.uuid4())
        modified_at = str(row["updated_at"] or now)
        conn.execute(
            """UPDATE focus_tasks
               SET sync_uid=?,sync_version=1,sync_origin_device_id=?,sync_modified_at=?
               WHERE id=?""",
            (task_uid, device_id, modified_at, int(row["id"])),
        )
        conn.execute(
            """INSERT INTO local_sync_changes
               (change_id,entity_type,entity_uid,entity_version,origin_device_id,changed_at)
               VALUES (?,'focus_task',?,?,?,?)""",
            (str(uuid.uuid4()), task_uid, 1, device_id, modified_at),
        )


def _upgrade_local_sync_v1(conn):
    """Adiciona presença, histórico e métricas sem substituir o motor da V0."""
    _add_column_if_missing(conn, "local_sync_trusted_peers", "protocol_version", "INTEGER NOT NULL DEFAULT 1")
    _add_column_if_missing(conn, "local_sync_trusted_peers", "app_version", "TEXT")
    _add_column_if_missing(conn, "local_sync_trusted_peers", "capabilities", "TEXT NOT NULL DEFAULT '[]'")
    _add_column_if_missing(conn, "local_sync_trusted_peers", "last_presence_at", "TEXT")
    _add_column_if_missing(conn, "local_sync_trusted_peers", "remote_pending", "TEXT NOT NULL DEFAULT '{}'")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_sent_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_received_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "total_sent_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "total_received_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_duration_ms", "REAL")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_bytes_sent", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_bytes_received", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "conflict_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "retry_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "local_sync_peer_state", "last_upload_ack_seq", "INTEGER NOT NULL DEFAULT 0")
    if _table_exists(conn, "sessions"):
        _add_column_if_missing(conn, "sessions", "sync_origin_device_id", "TEXT")
    if _table_exists(conn, "chat_folders"):
        _add_column_if_missing(conn, "chat_folders", "sync_origin_device_id", "TEXT")
    if _table_exists(conn, "messages"):
        _add_column_if_missing(conn, "messages", "sync_uid", "TEXT")
        _add_column_if_missing(conn, "messages", "sync_origin_device_id", "TEXT")
    if _table_exists(conn, "memories"):
        _add_column_if_missing(conn, "memories", "sync_uid", "TEXT")
        _add_column_if_missing(conn, "memories", "sync_origin_device_id", "TEXT")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_requests (
            request_id      TEXT PRIMARY KEY,
            peer_device_id  TEXT NOT NULL,
            requested_at    TEXT NOT NULL,
            consumed_at     TEXT,
            FOREIGN KEY(peer_device_id)
                REFERENCES local_sync_trusted_peers(peer_device_id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            peer_device_id  TEXT NOT NULL,
            status          TEXT NOT NULL,
            sent_count      INTEGER NOT NULL DEFAULT 0,
            received_count  INTEGER NOT NULL DEFAULT 0,
            conflict_count  INTEGER NOT NULL DEFAULT 0,
            bytes_sent      INTEGER NOT NULL DEFAULT 0,
            bytes_received  INTEGER NOT NULL DEFAULT 0,
            duration_ms     REAL,
            error_message   TEXT,
            created_at      TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_exchanges (
            exchange_id TEXT PRIMARY KEY,
            peer_device_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'awaiting_ack',
            server_cursor INTEGER NOT NULL DEFAULT 0,
            ack_client_seq INTEGER NOT NULL DEFAULT 0,
            sent_count INTEGER NOT NULL DEFAULT 0,
            received_count INTEGER NOT NULL DEFAULT 0,
            bytes_sent INTEGER NOT NULL DEFAULT 0,
            bytes_received INTEGER NOT NULL DEFAULT 0,
            duration_ms REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            acknowledged_at TEXT,
            FOREIGN KEY(peer_device_id)
                REFERENCES local_sync_trusted_peers(peer_device_id) ON DELETE CASCADE
        )
    """)
    _add_column_if_missing(conn, "local_sync_exchanges", "exchange_kind", "TEXT NOT NULL DEFAULT 'focus'")
    _add_column_if_missing(conn, "local_sync_exchanges", "entity_counts", "TEXT NOT NULL DEFAULT '{}'")
    _add_column_if_missing(conn, "local_sync_exchanges", "sync_run_id", "TEXT")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_ingested_changes (
            change_id TEXT PRIMARY KEY,
            peer_device_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_uid TEXT NOT NULL,
            entity_version INTEGER NOT NULL,
            operation TEXT NOT NULL,
            applied_at TEXT NOT NULL,
            FOREIGN KEY(peer_device_id)
                REFERENCES local_sync_trusted_peers(peer_device_id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS local_sync_ingested_entities (
            peer_device_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_uid TEXT NOT NULL,
            entity_version INTEGER NOT NULL,
            deleted_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(peer_device_id,entity_type,entity_uid),
            FOREIGN KEY(peer_device_id)
                REFERENCES local_sync_trusted_peers(peer_device_id) ON DELETE CASCADE
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_sync_history_peer "
        "ON local_sync_history(peer_device_id, id DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_sync_requests_peer "
        "ON local_sync_requests(peer_device_id, requested_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_sync_exchanges_peer "
        "ON local_sync_exchanges(peer_device_id, created_at DESC)"
    )
    if _table_exists(conn, "messages"):
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sync_uid "
            "ON messages(sync_uid) WHERE sync_uid IS NOT NULL"
        )
    if _table_exists(conn, "memories"):
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_sync_uid "
            "ON memories(sync_uid) WHERE sync_uid IS NOT NULL"
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_local_sync_ingested_entity "
        "ON local_sync_ingested_changes(peer_device_id,entity_type,entity_uid)"
    )


def _create_location_context(conn):
    """Cria o contexto semântico de lugar sem armazenar rastreamento contínuo."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS location_places (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            context     TEXT NOT NULL DEFAULT 'other',
            latitude    REAL NOT NULL,
            longitude   REAL NOT NULL,
            radius_m    REAL NOT NULL DEFAULT 180,
            enabled     BOOLEAN NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS location_state (
            id          INTEGER PRIMARY KEY CHECK(id = 1),
            place_id    INTEGER,
            context     TEXT NOT NULL DEFAULT 'unknown',
            status      TEXT NOT NULL DEFAULT 'unknown',
            latitude    REAL,
            longitude   REAL,
            accuracy_m  REAL,
            source      TEXT NOT NULL DEFAULT 'manual',
            updated_at  TEXT NOT NULL,
            FOREIGN KEY(place_id) REFERENCES location_places(id) ON DELETE SET NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS location_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id    INTEGER,
            event_type  TEXT NOT NULL,
            context     TEXT NOT NULL,
            source      TEXT NOT NULL DEFAULT 'system',
            created_at  TEXT NOT NULL,
            FOREIGN KEY(place_id) REFERENCES location_places(id) ON DELETE SET NULL
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_location_places_context ON location_places(context, enabled)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_location_events_created ON location_events(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_focus_tasks_place ON focus_tasks(place_context, completed)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS location_routes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'active',
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            distance_m  REAL NOT NULL DEFAULT 0,
            duration_s  INTEGER NOT NULL DEFAULT 0,
            point_count INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS location_route_points (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id    INTEGER NOT NULL,
            latitude    REAL NOT NULL,
            longitude   REAL NOT NULL,
            accuracy_m  REAL,
            altitude_m  REAL,
            speed_mps   REAL,
            recorded_at TEXT NOT NULL,
            FOREIGN KEY(route_id) REFERENCES location_routes(id) ON DELETE CASCADE
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_location_routes_started ON location_routes(started_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_location_route_points_route ON location_route_points(route_id, id)")


def _create_chat_folders(conn):
    """Organização visual de chats, sem alterar mensagens ou memórias."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_folders (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
            icon        TEXT NOT NULL DEFAULT 'folder',
            color       TEXT NOT NULL DEFAULT '#8b5cf6',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
    """)
    _add_column_if_missing(conn, "sessions", "folder_id", "TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_folder ON sessions(folder_id, created_at DESC)")

def _create_memories(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   TEXT,
            scope        TEXT    NOT NULL DEFAULT 'global',
            content      TEXT    NOT NULL,
            memory_type  TEXT    NOT NULL DEFAULT 'short',
            importance   REAL    DEFAULT 0.5,
            access_count INTEGER DEFAULT 0,
            last_accessed TEXT,
            expires_at   TEXT,
            tags         TEXT    DEFAULT '[]',
            created_at   TEXT    NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );
    """)


def _create_user_profile(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_profile_facts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            fact_key    TEXT    NOT NULL,
            fact_value  TEXT    NOT NULL,
            confidence  REAL    DEFAULT 0.6,
            source      TEXT    DEFAULT 'conversation',
            session_id  TEXT,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            UNIQUE(fact_key, fact_value)
        );
    """)


def _create_knowledge_graph(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS kg_entities (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL,
            entity_type  TEXT    NOT NULL DEFAULT 'concept',
            description  TEXT,
            importance   REAL    DEFAULT 0.5,
            access_count INTEGER DEFAULT 0,
            first_seen   TEXT    NOT NULL,
            last_seen    TEXT    NOT NULL,
            metadata     TEXT    DEFAULT '{}',
            UNIQUE(name)
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS kg_relations (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id     INTEGER NOT NULL,
            target_id     INTEGER NOT NULL,
            relation_type TEXT    NOT NULL DEFAULT 'related_to',
            strength      REAL    DEFAULT 0.5,
            created_at    TEXT    NOT NULL,
            FOREIGN KEY (source_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
            FOREIGN KEY (target_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
            UNIQUE(source_id, target_id, relation_type)
        );
    """)


def _create_projects(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            description   TEXT,
            status        TEXT    DEFAULT 'active',
            technologies  TEXT    DEFAULT '[]',
            objectives    TEXT    DEFAULT '[]',
            tags          TEXT    DEFAULT '[]',
            created_at    TEXT    NOT NULL,
            updated_at    TEXT    NOT NULL,
            last_activity TEXT
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_sessions (
            project_id INTEGER NOT NULL,
            session_id TEXT    NOT NULL,
            linked_at  TEXT    NOT NULL,
            PRIMARY KEY (project_id, session_id),
            FOREIGN KEY (project_id) REFERENCES projects(id)  ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id)  ON DELETE CASCADE
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_documents (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id         INTEGER NOT NULL,
            knowledge_source_id INTEGER,
            title              TEXT    NOT NULL,
            doc_type           TEXT    NOT NULL DEFAULT 'document',
            created_at         TEXT    NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    """)


def _create_timeline(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS timeline_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            description TEXT,
            event_type  TEXT    NOT NULL DEFAULT 'learning',
            entity_id   INTEGER,
            entity_type TEXT,
            session_id  TEXT,
            event_date  TEXT    NOT NULL,
            created_at  TEXT    NOT NULL,
            importance  REAL    DEFAULT 0.5,
            tags        TEXT    DEFAULT '[]'
        );
    """)


def _create_insights(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS insights (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            insight_type TEXT    NOT NULL DEFAULT 'usage_pattern',
            title        TEXT    NOT NULL,
            body         TEXT    NOT NULL,
            entities     TEXT    DEFAULT '[]',
            importance   REAL    DEFAULT 0.5,
            is_read      INTEGER DEFAULT 0,
            created_at   TEXT    NOT NULL,
            expires_at   TEXT
        );
    """)


def _create_embeddings(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source_table TEXT    NOT NULL,
            source_id    INTEGER NOT NULL,
            chunk_index  INTEGER DEFAULT 0,
            chunk_text   TEXT    NOT NULL,
            embedding    BLOB    NOT NULL,
            created_at   TEXT    NOT NULL
        );
    """)


def _create_ingestion_cache(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ingestion_cache (
            source_table  TEXT    NOT NULL,
            source_id     INTEGER NOT NULL,
            content_hash  TEXT    NOT NULL,
            chunk_count   INTEGER DEFAULT 0,
            pipeline_key  TEXT    NOT NULL,
            metadata      TEXT    DEFAULT '{}',
            indexed_at    TEXT    NOT NULL,
            PRIMARY KEY (source_table, source_id)
        );
    """)


def _create_backup_import_map(conn):
    """Mapa interno usado para reimportações de backup idempotentes."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS buds_backup_import_map (
            backup_key TEXT NOT NULL,
            table_name TEXT NOT NULL,
            source_key TEXT NOT NULL,
            target_key TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            PRIMARY KEY (backup_key, table_name, source_key)
        );
    """)


def _create_conversation_summaries(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS conversation_summaries (
            session_id    TEXT PRIMARY KEY,
            summary       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            message_count INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
    """)


def _create_codebase_index(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS codebase_index (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            project_root   TEXT NOT NULL,
            relative_path  TEXT NOT NULL,
            file_name      TEXT NOT NULL,
            language       TEXT,
            kind           TEXT NOT NULL DEFAULT 'file',
            symbol_name    TEXT,
            signature      TEXT,
            imports        TEXT DEFAULT '[]',
            dependencies   TEXT DEFAULT '[]',
            routes         TEXT DEFAULT '[]',
            hooks          TEXT DEFAULT '[]',
            classes        TEXT DEFAULT '[]',
            functions      TEXT DEFAULT '[]',
            summary        TEXT,
            content        TEXT,
            metadata       TEXT DEFAULT '{}',
            indexed_at     TEXT NOT NULL
        );
    """)


def _migrate_session_retention(conn):
    """Adiciona a lixeira lógica sem remover conversas de bancos existentes."""
    _add_column_if_missing(conn, "sessions", "deleted_at", "TEXT")


def _create_graph_provenance(conn):
    """Registra quais conversas criaram cada ponto/relação do grafo.

    Entidades antigas recebem uma origem legada sem sessão. Dessa forma uma
    limpeza nova nunca apaga silenciosamente um nó cuja procedência histórica
    não pode ser provada.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS kg_entity_mentions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id     INTEGER NOT NULL,
            session_id    TEXT,
            mention_count INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            FOREIGN KEY (entity_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_entity_mentions_session
        ON kg_entity_mentions(entity_id, session_id)
        WHERE session_id IS NOT NULL
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_entity_mentions_legacy
        ON kg_entity_mentions(entity_id)
        WHERE session_id IS NULL
    """)
    conn.execute("""
        INSERT OR IGNORE INTO kg_entity_mentions
          (entity_id, session_id, mention_count, created_at, updated_at)
        SELECT id, NULL, MAX(1, COALESCE(access_count, 1)), first_seen, last_seen
        FROM kg_entities
        WHERE NOT EXISTS (
            SELECT 1 FROM kg_entity_mentions m WHERE m.entity_id=kg_entities.id
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kg_entity_mentions_chat ON kg_entity_mentions(session_id)")


def _create_indexes(conn):
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_memories_type      ON memories(memory_type);",
        "CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id);",
        "CREATE INDEX IF NOT EXISTS idx_memories_scope     ON memories(scope, session_id);",
        "CREATE INDEX IF NOT EXISTS idx_memories_expires   ON memories(expires_at);",
        "CREATE INDEX IF NOT EXISTS idx_user_profile_key   ON user_profile_facts(fact_key);",
        "CREATE INDEX IF NOT EXISTS idx_user_profile_conf  ON user_profile_facts(confidence);",
        "CREATE INDEX IF NOT EXISTS idx_kg_entities_name   ON kg_entities(name);",
        "CREATE INDEX IF NOT EXISTS idx_kg_entities_type   ON kg_entities(entity_type);",
        "CREATE INDEX IF NOT EXISTS idx_kg_relations_src   ON kg_relations(source_id);",
        "CREATE INDEX IF NOT EXISTS idx_kg_relations_tgt   ON kg_relations(target_id);",
        "CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);",
        "CREATE INDEX IF NOT EXISTS idx_timeline_date      ON timeline_events(event_date);",
        "CREATE INDEX IF NOT EXISTS idx_timeline_type      ON timeline_events(event_type);",
        "CREATE INDEX IF NOT EXISTS idx_insights_read      ON insights(is_read);",
        "CREATE INDEX IF NOT EXISTS idx_embeddings_src     ON embeddings(source_table, source_id);",
        "CREATE INDEX IF NOT EXISTS idx_embeddings_created ON embeddings(created_at);",
        "CREATE INDEX IF NOT EXISTS idx_ingestion_hash     ON ingestion_cache(content_hash);",
        "CREATE INDEX IF NOT EXISTS idx_ingestion_key      ON ingestion_cache(pipeline_key);",
        "CREATE INDEX IF NOT EXISTS idx_codebase_project   ON codebase_index(project_root);",
        "CREATE INDEX IF NOT EXISTS idx_codebase_path      ON codebase_index(relative_path);",
        "CREATE INDEX IF NOT EXISTS idx_codebase_symbol    ON codebase_index(symbol_name);",
        "CREATE INDEX IF NOT EXISTS idx_codebase_language  ON codebase_index(language);",
        "CREATE INDEX IF NOT EXISTS idx_core_memories      ON memories(is_core, locked);",
        "CREATE INDEX IF NOT EXISTS idx_summary_session    ON conversation_summaries(session_id);",
    ]
    for sql in indexes:
        conn.execute(sql)


def _create_fts_tables(conn):
    # memories_fts
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            content='memories',
            content_rowid='id'
        );
    """)
    # Triggers memories
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
            INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
        END;
    """)

    # embeddings_fts
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
            chunk_text,
            content='embeddings',
            content_rowid='id'
        );
    """)
    # Triggers embeddings
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS embeddings_ai AFTER INSERT ON embeddings BEGIN
            INSERT INTO embeddings_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS embeddings_ad AFTER DELETE ON embeddings BEGIN
            INSERT INTO embeddings_fts(embeddings_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS embeddings_au AFTER UPDATE OF chunk_text ON embeddings BEGIN
            INSERT INTO embeddings_fts(embeddings_fts, rowid, chunk_text) VALUES('delete', old.id, old.chunk_text);
            INSERT INTO embeddings_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
        END;
    """)

    # Popula índices antigos apenas quando necessário. Rebuild em todo startup
    # fica caro conforme memórias/documentos crescem.
    _rebuild_fts_if_empty(conn, "memories_fts", "memories")
    _rebuild_fts_if_empty(conn, "embeddings_fts", "embeddings")


def _create_rag_cleanup_triggers(conn):
    """
    Embeddings e cache usam referência polimórfica e, por isso, não podem ter
    uma FOREIGN KEY SQLite convencional. Triggers mantêm o mesmo comportamento
    de ON DELETE CASCADE para as fontes atualmente indexáveis.
    """
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS knowledge_sources_cleanup_rag
        AFTER DELETE ON knowledge_sources
        BEGIN
            DELETE FROM embeddings
            WHERE source_table='knowledge_sources' AND source_id=OLD.id;
            DELETE FROM ingestion_cache
            WHERE source_table='knowledge_sources' AND source_id=OLD.id;
            UPDATE project_documents
            SET knowledge_source_id=NULL
            WHERE knowledge_source_id=OLD.id;
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS messages_cleanup_rag
        AFTER DELETE ON messages
        BEGIN
            DELETE FROM embeddings
            WHERE source_table='messages' AND source_id=OLD.id;
            DELETE FROM ingestion_cache
            WHERE source_table='messages' AND source_id=OLD.id;
        END;
    """)


def _cleanup_orphaned_rag(conn):
    """Remove chunks/cache órfãos deixados por versões anteriores."""
    conn.execute("""
        DELETE FROM embeddings
        WHERE source_table='knowledge_sources'
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_sources
              WHERE knowledge_sources.id=embeddings.source_id
          )
    """)
    conn.execute("""
        DELETE FROM ingestion_cache
        WHERE source_table='knowledge_sources'
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_sources
              WHERE knowledge_sources.id=ingestion_cache.source_id
          )
    """)
    conn.execute("""
        DELETE FROM embeddings
        WHERE source_table='messages'
          AND NOT EXISTS (
              SELECT 1 FROM messages
              WHERE messages.id=embeddings.source_id
          )
    """)
    conn.execute("""
        DELETE FROM ingestion_cache
        WHERE source_table='messages'
          AND NOT EXISTS (
              SELECT 1 FROM messages
              WHERE messages.id=ingestion_cache.source_id
          )
    """)


def _table_count(conn, table_name: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) as n FROM {table_name}").fetchone()["n"])
    except Exception:
        return 0


def _table_exists(conn, table_name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone())


def _rebuild_fts_if_empty(conn, fts_table: str, source_table: str) -> None:
    source_count = _table_count(conn, source_table)
    fts_count = _table_count(conn, fts_table)
    if source_count != fts_count:
        conn.execute(f"INSERT INTO {fts_table}({fts_table}) VALUES('rebuild');")



def _add_column_if_missing(conn, table: str, column: str, definition: str):
    try:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except Exception:
        pass


def _migrate_memories_core_columns(conn):
    """Adiciona metadados de Core Memory e origem sem tocar nos dados atuais."""
    _add_column_if_missing(conn, "memories", "is_core", "INTEGER DEFAULT 0")
    _add_column_if_missing(conn, "memories", "locked", "INTEGER DEFAULT 0")
    _add_column_if_missing(conn, "memories", "user_confirmed", "INTEGER DEFAULT 0")
    _add_column_if_missing(conn, "memories", "origin_type", "TEXT DEFAULT 'conversation'")
    _add_column_if_missing(conn, "memories", "origin_id", "TEXT")
    _add_column_if_missing(conn, "memories", "source_table", "TEXT")
    _add_column_if_missing(conn, "memories", "source_id", "INTEGER")


def _migrate_memory_scope(conn):
    """Separa memória global de contexto exclusivo de uma conversa.

    Bancos antigos não possuíam esse conceito. Registros vinculados a uma
    sessão são classificados de modo conservador como conversacionais, salvo
    Core Memories, fatos confirmados e fatos de perfil. A classificação só é
    executada quando a coluna nasce, preservando edições posteriores.
    """
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(memories)").fetchall()}
    if "scope" in columns:
        return

    conn.execute("ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'")
    conn.execute(
        """
        UPDATE memories
        SET scope='conversation'
        WHERE session_id IS NOT NULL
          AND COALESCE(is_core, 0)=0
          AND COALESCE(user_confirmed, 0)=0
          AND COALESCE(origin_type, 'conversation') NOT IN ('profile', 'manual', 'core')
        """
    )


def _migrate_knowledge_source_intelligence(conn):
    """Expande knowledge_sources para análise de documento sem quebrar a API antiga."""
    _add_column_if_missing(conn, "knowledge_sources", "executive_summary", "TEXT DEFAULT ''")
    _add_column_if_missing(conn, "knowledge_sources", "technical_summary", "TEXT DEFAULT ''")
    _add_column_if_missing(conn, "knowledge_sources", "suggested_questions", "TEXT DEFAULT '[]'")
    _add_column_if_missing(conn, "knowledge_sources", "detected_entities", "TEXT DEFAULT '[]'")
    _add_column_if_missing(conn, "knowledge_sources", "metadata_json", "TEXT DEFAULT '{}'")


def _migrate_embeddings_metadata(conn):
    """
    Adiciona coluna chunk_metadata à tabela embeddings de forma idempotente.
    Necessário para o Code Search Engine (RAG Avançado).
    """
    try:
        conn.execute("ALTER TABLE embeddings ADD COLUMN chunk_metadata TEXT DEFAULT '{}'")
    except Exception:
        pass  # Coluna já existe — sem problema


def _migrate_entity_mention_counts(conn):
    """
    Corrige a semântica histórica: a primeira menção era gravada como zero.

    O grafo exige ao menos uma menção para exibir uma entidade, portanto esses
    registros existentes representam uma menção real e devem começar em 1.
    """
    conn.execute(
        "UPDATE kg_entities SET access_count=1 WHERE access_count IS NULL OR access_count < 1"
    )


# ── Helpers de data ──────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.datetime.now().isoformat()


def iso_from_delta(**kwargs) -> str:
    return (datetime.datetime.now() + datetime.timedelta(**kwargs)).isoformat()


def json_dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def json_loads(text: str, fallback=None):
    try:
        return json.loads(text or "[]")
    except Exception:
        return fallback if fallback is not None else []


if __name__ == "__main__":
    migrate()
