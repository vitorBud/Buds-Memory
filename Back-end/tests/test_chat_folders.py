import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import database_v2  # noqa: E402


class ChatFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "folders.sqlite3"
        self.original_database_path = database.DB_PATH
        self.original_v2_database_path = database_v2.DB_PATH
        database.DB_PATH = self.database_path
        database_v2.DB_PATH = self.database_path
        database.init_db()
        database_v2.migrate()

    def tearDown(self):
        database.DB_PATH = self.original_database_path
        database_v2.DB_PATH = self.original_v2_database_path
        self.temp_dir.cleanup()

    def test_folder_crud_and_session_assignment(self):
        folder = database.create_chat_folder(
            "Trabalho", icon="briefcase", color="#2563eb"
        )
        session = database.create_session("Planejamento", folder["id"])

        self.assertEqual(session["folder_id"], folder["id"])
        self.assertEqual(database.get_chat_folders()[0]["chat_count"], 1)

        updated = database.update_chat_folder(folder["id"], color="#10b981")
        self.assertEqual(updated["color"], "#10b981")

        database.update_session_folder(session["id"], None)
        self.assertIsNone(database.get_session(session["id"])["folder_id"])

    def test_deleting_folder_preserves_conversations(self):
        folder = database.create_chat_folder("Estudo", icon="graduation-cap")
        session = database.create_session("Revisão", folder["id"])

        database.delete_chat_folder(folder["id"])

        preserved = database.get_session(session["id"])
        self.assertIsNotNone(preserved)
        self.assertIsNone(preserved["folder_id"])
        self.assertEqual(database.get_chat_folders(), [])

    def test_duplicate_names_and_invalid_folder_are_rejected(self):
        database.create_chat_folder("Investimentos")
        with self.assertRaises(ValueError):
            database.create_chat_folder("investimentos")
        with self.assertRaises(ValueError):
            database.create_session("Chat inválido", "missing-folder")

    def test_voice_session_is_kept_out_of_regular_chat_lists(self):
        chat = database.create_session("Chat principal")
        voice = database.create_session(channel="voice")

        self.assertEqual([item["id"] for item in database.get_all_sessions()], [chat["id"]])
        self.assertEqual([item["id"] for item in database.get_all_sessions("voice")], [voice["id"]])
        self.assertEqual(voice["title"], "Conversa por voz")
        self.assertEqual(voice["channel"], "voice")

        with self.assertRaises(ValueError):
            database.create_session(channel="desconhecido")


if __name__ == "__main__":
    unittest.main()
