import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
import database_v2  # noqa: E402
from cognitive import knowledge_graph  # noqa: E402


class KnowledgeGraphVisibilityTests(unittest.TestCase):
    def test_first_real_mention_is_visible_in_full_graph(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "knowledge-graph.db"
            with patch.object(database, "DB_PATH", db_path):
                database.init_db()
            with patch.object(database_v2, "DB_PATH", db_path):
                database_v2.migrate()
                entity = knowledge_graph.upsert_entity(
                    "Arquitetura de Software",
                    importance=0.8,
                )
                graph = knowledge_graph.get_full_graph()

            self.assertEqual(entity["access_count"], 1)
            self.assertEqual(
                [item["name"] for item in graph["entities"]],
                ["arquitetura de software"],
            )


if __name__ == "__main__":
    unittest.main()
