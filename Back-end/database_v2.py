"""
database_v2.py — Migração não-destrutiva do banco cognitivo Nexus IA.

Adiciona as tabelas do Second Brain sem tocar nas tabelas existentes
(sessions, messages, knowledge_sources). Seguro para rodar múltiplas vezes.
"""

import sqlite3
import json
from pathlib import Path
import datetime
from storage import get_database_path

BASE = Path(__file__).resolve().parent
DB_PATH = get_database_path()


def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def migrate():
    """Executa todas as migrações cognitivas de forma idempotente."""
    with get_db_connection() as conn:
        _create_memories(conn)
        _create_knowledge_graph(conn)
        _create_projects(conn)
        _create_timeline(conn)
        _create_insights(conn)
        _create_embeddings(conn)
        _create_sync_state(conn)
        _create_indexes(conn)
        conn.commit()
    print("[DB v2] Migração cognitiva concluída com sucesso.")


def _create_memories(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   TEXT,
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


def _create_sync_state(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)


def _create_indexes(conn):
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_memories_type      ON memories(memory_type);",
        "CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id);",
        "CREATE INDEX IF NOT EXISTS idx_memories_expires   ON memories(expires_at);",
        "CREATE INDEX IF NOT EXISTS idx_kg_entities_name   ON kg_entities(name);",
        "CREATE INDEX IF NOT EXISTS idx_kg_entities_type   ON kg_entities(entity_type);",
        "CREATE INDEX IF NOT EXISTS idx_kg_relations_src   ON kg_relations(source_id);",
        "CREATE INDEX IF NOT EXISTS idx_kg_relations_tgt   ON kg_relations(target_id);",
        "CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);",
        "CREATE INDEX IF NOT EXISTS idx_timeline_date      ON timeline_events(event_date);",
        "CREATE INDEX IF NOT EXISTS idx_timeline_type      ON timeline_events(event_type);",
        "CREATE INDEX IF NOT EXISTS idx_insights_read      ON insights(is_read);",
        "CREATE INDEX IF NOT EXISTS idx_embeddings_src     ON embeddings(source_table, source_id);",
    ]
    for sql in indexes:
        conn.execute(sql)


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
