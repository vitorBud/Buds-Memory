import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import local_backup  # noqa: E402
import database  # noqa: E402
import database_v2  # noqa: E402


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        result = super().__exit__(exc_type, exc_value, traceback)
        self.close()
        return result


def make_connection_factory(db_path: Path):
    def _connect():
        conn = sqlite3.connect(str(db_path), factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    return _connect


def create_minimal_schema(db_path: Path):
    with make_connection_factory(db_path)() as conn:
        conn.execute("""
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                audio_url TEXT,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_table TEXT NOT NULL,
                source_id INTEGER NOT NULL,
                chunk_index INTEGER DEFAULT 0,
                chunk_text TEXT NOT NULL,
                embedding BLOB NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.commit()


def create_full_schema(db_path: Path):
    create_minimal_schema(db_path)
    with make_connection_factory(db_path)() as conn:
        conn.execute("""
            CREATE TABLE knowledge_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_name TEXT,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                topics TEXT NOT NULL,
                created_at TEXT NOT NULL,
                executive_summary TEXT DEFAULT '',
                technical_summary TEXT DEFAULT '',
                suggested_questions TEXT DEFAULT '[]',
                detected_entities TEXT DEFAULT '[]',
                metadata_json TEXT DEFAULT '{}',
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        database_v2._create_memories(conn)
        database_v2._create_user_profile(conn)
        database_v2._create_knowledge_graph(conn)
        database_v2._create_projects(conn)
        database_v2._create_timeline(conn)
        database_v2._create_insights(conn)
        database_v2._create_ingestion_cache(conn)
        database_v2._create_conversation_summaries(conn)
        database_v2._create_codebase_index(conn)
        database_v2._migrate_memories_core_columns(conn)
        database_v2._migrate_embeddings_metadata(conn)
        conn.commit()


def seed_all_tables(db_path: Path, prefix: str):
    with make_connection_factory(db_path)() as conn:
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            ("session-1", f"{prefix} session", "2026-07-22T12:00:00"),
        )
        conn.execute(
            """
            INSERT INTO messages
              (id, session_id, sender, text, audio_url, created_at)
            VALUES (1, 'session-1', 'user', ?, NULL, '2026-07-22T12:00:01')
            """,
            (f"{prefix} message",),
        )
        conn.execute(
            """
            INSERT INTO knowledge_sources
              (id, session_id, title, source_type, source_name, summary,
               content, topics, created_at)
            VALUES
              (1, 'session-1', ?, 'text', 'fixture', 'summary',
               ?, 'backup', '2026-07-22T12:00:02')
            """,
            (f"{prefix} document", f"{prefix} content"),
        )
        conn.execute(
            """
            INSERT INTO user_profile_facts
              (id, fact_key, fact_value, confidence, source, session_id,
               created_at, updated_at)
            VALUES
              (1, 'project', ?, 0.9, 'conversation', 'session-1',
               '2026-07-22T12:00:03', '2026-07-22T12:00:03')
            """,
            (f"{prefix} project fact",),
        )
        conn.execute(
            """
            INSERT INTO kg_entities
              (id, name, entity_type, description, importance, access_count,
               first_seen, last_seen, metadata)
            VALUES
              (1, ?, 'concept', NULL, 0.8, 0,
               '2026-07-22T12:00:04', '2026-07-22T12:00:04', '{}'),
              (2, ?, 'concept', NULL, 0.7, 0,
               '2026-07-22T12:00:04', '2026-07-22T12:00:04', '{}')
            """,
            (f"{prefix} entity A", f"{prefix} entity B"),
        )
        conn.execute(
            """
            INSERT INTO projects
              (id, name, description, status, technologies, objectives, tags,
               created_at, updated_at, last_activity)
            VALUES
              (1, ?, NULL, 'active', '[]', '[]', '[]',
               '2026-07-22T12:00:05', '2026-07-22T12:00:05', NULL)
            """,
            (f"{prefix} project",),
        )
        conn.execute(
            """
            INSERT INTO memories
              (id, session_id, content, memory_type, importance, access_count,
               tags, created_at, origin_type, origin_id, source_table, source_id)
            VALUES
              (1, 'session-1', ?, 'long', 0.9, 0, '[]',
               '2026-07-22T12:00:06', 'profile', '1',
               'user_profile_facts', 1)
            """,
            (f"{prefix} memory",),
        )
        conn.execute(
            """
            INSERT INTO conversation_summaries
              (session_id, summary, created_at, updated_at, message_count)
            VALUES
              ('session-1', ?, '2026-07-22T12:00:07',
               '2026-07-22T12:00:07', 1)
            """,
            (f"{prefix} summary",),
        )
        conn.execute(
            """
            INSERT INTO kg_relations
              (id, source_id, target_id, relation_type, strength, created_at)
            VALUES
              (1, 1, 2, 'related_to', 0.8, '2026-07-22T12:00:08')
            """
        )
        conn.execute(
            """
            INSERT INTO project_sessions
              (project_id, session_id, linked_at)
            VALUES (1, 'session-1', '2026-07-22T12:00:09')
            """
        )
        conn.execute(
            """
            INSERT INTO project_documents
              (id, project_id, knowledge_source_id, title, doc_type, created_at)
            VALUES
              (1, 1, 1, ?, 'document', '2026-07-22T12:00:10')
            """,
            (f"{prefix} project document",),
        )
        conn.execute(
            """
            INSERT INTO timeline_events
              (id, title, description, event_type, entity_id, entity_type,
               session_id, event_date, created_at, importance, tags)
            VALUES
              (1, ?, NULL, 'project', 1, 'project', 'session-1',
               '2026-07-22T12:00:11', '2026-07-22T12:00:11', 0.7, '[]')
            """,
            (f"{prefix} timeline",),
        )
        conn.execute(
            """
            INSERT INTO insights
              (id, insight_type, title, body, entities, importance, is_read,
               created_at, expires_at)
            VALUES
              (1, 'usage_pattern', ?, ?, '[]', 0.6, 0,
               '2026-07-22T12:00:12', NULL)
            """,
            (f"{prefix} insight", f"{prefix} insight body"),
        )
        conn.execute(
            """
            INSERT INTO codebase_index
              (id, project_root, relative_path, file_name, kind, indexed_at)
            VALUES
              (1, ?, 'main.py', 'main.py', 'file', '2026-07-22T12:00:13')
            """,
            (f"/{prefix}",),
        )
        conn.execute(
            """
            INSERT INTO embeddings
              (id, source_table, source_id, chunk_index, chunk_text, embedding,
               created_at, chunk_metadata)
            VALUES
              (1, 'knowledge_sources', 1, 0, ?, X'0102',
               '2026-07-22T12:00:14', '{}')
            """,
            (f"{prefix} chunk",),
        )
        conn.execute(
            """
            INSERT INTO ingestion_cache
              (source_table, source_id, content_hash, chunk_count, pipeline_key,
               metadata, indexed_at)
            VALUES
              ('knowledge_sources', 1, ?, 1, 'pipeline', '{}',
               '2026-07-22T12:00:15')
            """,
            (f"{prefix}-hash",),
        )
        conn.commit()


class LocalBackupTests(unittest.TestCase):
    def test_storage_status_and_confirmed_clear(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            db_path = root / "chat_history.db"
            out_dir = root / "out"
            out_dir.mkdir()
            (out_dir / "answer.wav").write_bytes(b"audio")
            create_minimal_schema(db_path)
            with make_connection_factory(db_path)() as conn:
                conn.execute(
                    "INSERT INTO sessions VALUES ('s1', 'Sessão', '2026-08-03')"
                )
                conn.execute(
                    """
                    INSERT INTO messages
                      (session_id, sender, text, created_at)
                    VALUES ('s1', 'user', 'teste', '2026-08-03')
                    """
                )
                conn.commit()

            patches = (
                patch.object(local_backup, "get_db_connection", make_connection_factory(db_path)),
                patch.object(local_backup, "get_database_path", return_value=db_path),
                patch.object(local_backup, "get_output_dir", return_value=out_dir),
                patch.object(local_backup, "get_data_dir", return_value=root),
            )
            with patches[0], patches[1], patches[2], patches[3]:
                status = local_backup.get_status()
                self.assertGreaterEqual(status["storage"]["used_bytes"], 5)
                self.assertEqual(status["local_records"]["sessions"], 1)

                with self.assertRaises(ValueError):
                    local_backup.clear_local_data("apagar")

                cleared = local_backup.clear_local_data("APAGAR TUDO")
                self.assertEqual(cleared["local_records"]["total"], 0)
                self.assertEqual(list(out_dir.iterdir()), [])

            with make_connection_factory(db_path)() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)

    def test_export_and_import_local_memory_backup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_db = Path(temp_dir) / "source.db"
            target_db = Path(temp_dir) / "target.db"
            create_minimal_schema(source_db)
            create_minimal_schema(target_db)

            with make_connection_factory(source_db)() as conn:
                conn.execute(
                    "INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)",
                    ("session-1", "Primeira conversa", "2026-07-22T12:00:00"),
                )
                conn.execute(
                    "INSERT INTO messages (session_id, sender, text, audio_url, created_at) VALUES (?, ?, ?, ?, ?)",
                    ("session-1", "user", "Meu nome é Vitor", None, "2026-07-22T12:00:01"),
                )
                conn.execute(
                    """
                    INSERT INTO embeddings (source_table, source_id, chunk_index, chunk_text, embedding, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    ("messages", 1, 0, "Meu nome é Vitor", b"\x01\x02\x03", "2026-07-22T12:00:02"),
                )
                conn.commit()

            with patch.object(local_backup, "get_db_connection", make_connection_factory(source_db)):
                payload = local_backup.export_backup()
                status = local_backup.get_status()

            self.assertEqual(status["mode"], "local-backup")
            self.assertEqual(status["local_records"]["sessions"], 1)
            self.assertEqual(status["device_id"], "local")

            with patch.object(local_backup, "get_db_connection", make_connection_factory(target_db)):
                result = local_backup.import_backup(payload)

            self.assertTrue(result["success"])
            self.assertEqual(result["imported"]["sessions"], 1)
            self.assertEqual(result["imported"]["messages"], 1)
            self.assertEqual(result["imported"]["embeddings"], 1)

            with make_connection_factory(target_db)() as conn:
                session = conn.execute("SELECT * FROM sessions WHERE id='session-1'").fetchone()
                message = conn.execute("SELECT * FROM messages WHERE session_id='session-1'").fetchone()
                embedding = conn.execute("SELECT embedding FROM embeddings WHERE source_table='messages'").fetchone()

            self.assertEqual(session["title"], "Primeira conversa")
            self.assertEqual(message["text"], "Meu nome é Vitor")
            self.assertEqual(embedding["embedding"], b"\x01\x02\x03")

    def test_merge_remaps_colliding_primary_keys_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_db = Path(temp_dir) / "source-full.db"
            target_db = Path(temp_dir) / "target-full.db"
            create_full_schema(source_db)
            create_full_schema(target_db)
            seed_all_tables(source_db, "imported")
            seed_all_tables(target_db, "local")

            with patch.object(local_backup, "get_db_connection", make_connection_factory(source_db)):
                payload = local_backup.export_backup()
            payload["version"] = 1  # compatibilidade explícita com o formato antigo

            with patch.object(local_backup, "get_db_connection", make_connection_factory(target_db)):
                first = local_backup.import_backup(payload)
                second = local_backup.import_backup(payload)

            self.assertGreater(first["total_imported"], 0)
            self.assertEqual(second["total_imported"], 0)
            self.assertTrue(second["idempotent"])

            with make_connection_factory(target_db)() as conn:
                local_session = conn.execute(
                    "SELECT * FROM sessions WHERE id='session-1'"
                ).fetchone()
                imported_session = conn.execute(
                    "SELECT * FROM sessions WHERE title='imported session'"
                ).fetchone()
                self.assertEqual(local_session["title"], "local session")
                self.assertIsNotNone(imported_session)
                self.assertNotEqual(imported_session["id"], "session-1")

                imported_message = conn.execute(
                    "SELECT * FROM messages WHERE text='imported message'"
                ).fetchone()
                imported_knowledge = conn.execute(
                    "SELECT * FROM knowledge_sources WHERE title='imported document'"
                ).fetchone()
                imported_fact = conn.execute(
                    "SELECT * FROM user_profile_facts WHERE fact_value='imported project fact'"
                ).fetchone()
                imported_memory = conn.execute(
                    "SELECT * FROM memories WHERE content='imported memory'"
                ).fetchone()
                imported_project = conn.execute(
                    "SELECT * FROM projects WHERE name='imported project'"
                ).fetchone()
                imported_entities = conn.execute(
                    "SELECT * FROM kg_entities WHERE name LIKE 'imported entity %' ORDER BY name"
                ).fetchall()

                self.assertEqual(imported_message["session_id"], imported_session["id"])
                self.assertEqual(imported_knowledge["session_id"], imported_session["id"])
                self.assertEqual(imported_fact["session_id"], imported_session["id"])
                self.assertEqual(imported_memory["session_id"], imported_session["id"])
                self.assertEqual(imported_memory["source_id"], imported_fact["id"])
                self.assertEqual(imported_memory["origin_id"], str(imported_fact["id"]))

                summary = conn.execute(
                    "SELECT * FROM conversation_summaries WHERE summary='imported summary'"
                ).fetchone()
                relation = conn.execute(
                    "SELECT * FROM kg_relations WHERE id<>1"
                ).fetchone()
                project_session = conn.execute(
                    "SELECT * FROM project_sessions WHERE project_id=?",
                    (imported_project["id"],),
                ).fetchone()
                project_document = conn.execute(
                    "SELECT * FROM project_documents WHERE title='imported project document'"
                ).fetchone()
                timeline = conn.execute(
                    "SELECT * FROM timeline_events WHERE title='imported timeline'"
                ).fetchone()
                embedding = conn.execute(
                    "SELECT * FROM embeddings WHERE chunk_text='imported chunk'"
                ).fetchone()
                cache = conn.execute(
                    "SELECT * FROM ingestion_cache WHERE content_hash='imported-hash'"
                ).fetchone()

                self.assertEqual(summary["session_id"], imported_session["id"])
                self.assertEqual(
                    {relation["source_id"], relation["target_id"]},
                    {row["id"] for row in imported_entities},
                )
                self.assertEqual(project_session["session_id"], imported_session["id"])
                self.assertEqual(project_document["project_id"], imported_project["id"])
                self.assertEqual(
                    project_document["knowledge_source_id"], imported_knowledge["id"]
                )
                self.assertEqual(timeline["session_id"], imported_session["id"])
                self.assertEqual(timeline["entity_id"], imported_project["id"])
                self.assertEqual(embedding["source_id"], imported_knowledge["id"])
                self.assertEqual(cache["source_id"], imported_knowledge["id"])

                for table in local_backup.BACKUP_TABLES:
                    count = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                    expected = 4 if table == "kg_entities" else 2
                    self.assertEqual(count, expected, table)

    def test_import_is_atomic_when_a_late_row_is_invalid(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target_db = Path(temp_dir) / "atomic.db"
            create_minimal_schema(target_db)
            payload = {
                "format": local_backup.BACKUP_FORMAT,
                "version": 1,
                "tables": {
                    "sessions": [{
                        "id": "atomic-session",
                        "title": "Não deve persistir",
                        "created_at": "2026-07-22T12:00:00",
                    }],
                    "messages": [{
                        "id": 1,
                        "session_id": "atomic-session",
                        "sender": "user",
                        # text NOT NULL ausente para provocar rollback
                        "created_at": "2026-07-22T12:00:01",
                    }],
                },
            }

            with patch.object(local_backup, "get_db_connection", make_connection_factory(target_db)):
                with self.assertRaises(sqlite3.IntegrityError):
                    local_backup.import_backup(payload)

            with make_connection_factory(target_db)() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)


class RagCleanupTests(unittest.TestCase):
    def test_migration_cleans_orphans_and_deletes_cascade_to_rag(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "rag-cleanup.db"
            with patch.object(database, "DB_PATH", db_path):
                database.init_db()

            with make_connection_factory(db_path)() as conn:
                database_v2._create_embeddings(conn)
                database_v2._create_ingestion_cache(conn)
                conn.execute(
                    """
                    INSERT INTO embeddings
                      (source_table, source_id, chunk_text, embedding, created_at)
                    VALUES
                      ('knowledge_sources', 999, 'órfão doc', X'', '2026-07-22'),
                      ('messages', 999, 'órfão msg', X'', '2026-07-22')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO ingestion_cache
                      (source_table, source_id, content_hash, pipeline_key, indexed_at)
                    VALUES
                      ('knowledge_sources', 999, 'a', 'p', '2026-07-22'),
                      ('messages', 999, 'b', 'p', '2026-07-22')
                    """
                )
                conn.commit()

            with patch.object(database_v2, "DB_PATH", db_path):
                database_v2.migrate()

            with make_connection_factory(db_path)() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM ingestion_cache").fetchone()[0], 0)

                conn.execute(
                    "INSERT INTO sessions VALUES ('s1', 'Sessão', '2026-07-22')"
                )
                message_id = conn.execute(
                    """
                    INSERT INTO messages
                      (session_id, sender, text, created_at)
                    VALUES ('s1', 'user', 'mensagem', '2026-07-22')
                    """
                ).lastrowid
                knowledge_id = conn.execute(
                    """
                    INSERT INTO knowledge_sources
                      (session_id, title, source_type, summary, content, topics, created_at)
                    VALUES
                      ('s1', 'Documento', 'text', 'resumo', 'conteúdo', '', '2026-07-22')
                    """
                ).lastrowid
                conn.executemany(
                    """
                    INSERT INTO embeddings
                      (source_table, source_id, chunk_text, embedding, created_at)
                    VALUES (?, ?, 'chunk', X'', '2026-07-22')
                    """,
                    [("messages", message_id), ("knowledge_sources", knowledge_id)],
                )
                conn.executemany(
                    """
                    INSERT INTO ingestion_cache
                      (source_table, source_id, content_hash, pipeline_key, indexed_at)
                    VALUES (?, ?, 'hash', 'pipeline', '2026-07-22')
                    """,
                    [("messages", message_id), ("knowledge_sources", knowledge_id)],
                )
                conn.commit()

            with patch.object(database, "DB_PATH", db_path):
                self.assertTrue(database.delete_knowledge_source(knowledge_id, "s1"))

            with make_connection_factory(db_path)() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM embeddings WHERE source_table='knowledge_sources'"
                    ).fetchone()[0],
                    0,
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM ingestion_cache WHERE source_table='knowledge_sources'"
                    ).fetchone()[0],
                    0,
                )

                second_knowledge_id = conn.execute(
                    """
                    INSERT INTO knowledge_sources
                      (session_id, title, source_type, summary, content, topics, created_at)
                    VALUES
                      ('s1', 'Documento 2', 'text', 'resumo', 'conteúdo', '', '2026-07-22')
                    """
                ).lastrowid
                conn.execute(
                    """
                    INSERT INTO embeddings
                      (source_table, source_id, chunk_text, embedding, created_at)
                    VALUES ('knowledge_sources', ?, 'chunk', X'', '2026-07-22')
                    """,
                    (second_knowledge_id,),
                )
                conn.execute(
                    """
                    INSERT INTO ingestion_cache
                      (source_table, source_id, content_hash, pipeline_key, indexed_at)
                    VALUES ('knowledge_sources', ?, 'hash', 'pipeline', '2026-07-22')
                    """,
                    (second_knowledge_id,),
                )
                conn.commit()

            with patch.object(database, "DB_PATH", db_path):
                database.delete_session("s1")

            with make_connection_factory(db_path)() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM knowledge_sources").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0], 0)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM ingestion_cache").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
