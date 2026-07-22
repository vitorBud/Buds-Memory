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


def make_connection_factory(db_path: Path):
    def _connect():
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
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


class LocalBackupTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
