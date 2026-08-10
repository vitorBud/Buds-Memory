import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database_v2  # noqa: E402
from cognitive import focus, location  # noqa: E402
from cognitive.focus_capture import detect_focus_candidates, parse_natural_due  # noqa: E402
from datetime import datetime  # noqa: E402


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        result = super().__exit__(exc_type, exc_value, traceback)
        self.close()
        return result


class FocusTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "focus.sqlite3"

        def connection():
            conn = sqlite3.connect(self.database_path, factory=ClosingConnection)
            conn.row_factory = sqlite3.Row
            return conn

        self.connection = connection
        with connection() as conn:
            database_v2._create_focus_tasks(conn)
            database_v2._create_focus_v2_tables(conn)
            database_v2._migrate_focus_capture_columns(conn)
            database_v2._create_location_context(conn)
            conn.commit()
        self.patch = patch.object(focus, "get_db_connection", side_effect=connection)
        self.patch.start()
        self.location_patch = patch.object(location, "get_db_connection", side_effect=connection)
        self.location_patch.start()

    def tearDown(self):
        self.location_patch.stop()
        self.patch.stop()
        self.temp_dir.cleanup()

    def test_priority_order_is_high_medium_low(self):
        focus.create_focus_task("Baixa", priority="low")
        focus.create_focus_task("Alta", priority="high")
        focus.create_focus_task("Média", priority="medium")

        self.assertEqual(
            [task["title"] for task in focus.get_focus_tasks()],
            ["Alta", "Média", "Baixa"],
        )

    def test_invalid_values_are_normalized(self):
        task = focus.create_focus_task("Revisar projeto", category="invalid", priority="urgent")
        self.assertEqual(task["category"], "other")
        self.assertEqual(task["priority"], "medium")

    def test_approving_inbox_really_applies_item(self):
        item = focus.create_focus_inbox_item("TASK", "Preparar apresentação")
        self.assertTrue(focus.resolve_focus_inbox_item(item["id"], "approved"))

        tasks = focus.get_focus_tasks()
        self.assertEqual([task["title"] for task in tasks], ["Preparar apresentação"])
        self.assertEqual(focus.get_focus_inbox(), [])

    def test_analyzed_items_are_bounded_and_validated(self):
        items = focus._sanitize_analyzed_items([
            {
                "type": "MALICIOUS",
                "content": "  conteúdo útil  ",
                "action": "drop_database",
                "category": "unknown",
                "priority": "urgent",
                "confidence": 7,
            }
        ])
        self.assertEqual(items[0]["type"], "NOTE")
        self.assertEqual(items[0]["action"], "none")
        self.assertEqual(items[0]["content"], "conteúdo útil")
        self.assertEqual(items[0]["confidence"], 1.0)
        self.assertNotIn("category", items[0])
        self.assertNotIn("priority", items[0])

    def test_explicit_chat_task_is_created_without_llm(self):
        result = focus.capture_chat_message(
            "Hoje tenho que revisar o frontend do app.",
            session_id="chat-1",
            source_message_id=12,
        )
        self.assertEqual(len(result["created"]), 1)
        task = result["created"][0]
        self.assertEqual(task["title"], "Revisar o frontend do app")
        self.assertEqual(task["category"], "project")
        self.assertEqual(task["source"], "chat")

    def test_explicit_reminder_understands_tomorrow_and_time(self):
        now = datetime(2026, 8, 10, 14, 0)
        candidates = detect_focus_candidates(
            "Me lembra amanhã às 15h de mandar o relatório.",
            now=now,
        )
        self.assertEqual(candidates[0]["type"], "REMINDER")
        self.assertEqual(candidates[0]["content"], "Mandar o relatório")
        self.assertEqual(candidates[0]["due_date"], "2026-08-11T15:00")
        self.assertTrue(candidates[0]["auto_apply"])

    def test_doubt_goes_to_inbox_instead_of_creating(self):
        result = focus.capture_chat_message("Você acha que eu preciso trocar de computador?")
        self.assertEqual(result["created"], [])
        self.assertEqual(len(result["suggested"]), 1)

    def test_semantic_duplicate_is_not_created_twice(self):
        focus.capture_chat_message("Hoje preciso revisar o projeto.")
        focus.capture_chat_message("Hoje eu preciso revisar o projeto!")
        self.assertEqual(len(focus.get_focus_tasks()), 1)

    def test_invalid_calendar_date_is_rejected(self):
        self.assertIsNone(parse_natural_due("dia 31/02 às 10h", datetime(2026, 1, 1)))

    def test_arrival_reminder_is_semantic_and_location_aware(self):
        candidates = detect_focus_candidates(
            "Quando eu chegar em casa, me lembre de tirar o lixo."
        )
        self.assertEqual(candidates[0]["content"], "Tirar o lixo")
        self.assertEqual(candidates[0]["place_context"], "home")
        self.assertTrue(candidates[0]["trigger_on_arrival"])

    def test_current_place_prioritizes_relevant_tasks(self):
        focus.create_focus_task("Tarefa do trabalho", place_context="work")
        focus.create_focus_task("Tarefa de casa", place_context="home")
        location.set_semantic_context("home")
        tasks = focus.get_focus_tasks()
        self.assertEqual(tasks[0]["title"], "Tarefa de casa")
        self.assertTrue(tasks[0]["location_relevant"])

    def test_same_title_can_exist_for_different_places(self):
        focus.create_focus_task("Separar documentos", place_context="home")
        focus.create_focus_task("Separar documentos", place_context="work")
        self.assertEqual(len(focus.get_focus_tasks()), 2)

    def test_coordinates_are_converted_to_context_without_trail(self):
        place = location.save_place(
            name="Casa", context="home", latitude=-23.5505, longitude=-46.6333
        )
        state = location.update_sample(-23.55055, -46.63335, accuracy_m=12)
        self.assertEqual(state["place_id"], place["id"])
        self.assertEqual(state["context"], "home")
        self.assertEqual(len(location.get_recent_events()), 1)

    def test_deleting_active_place_moves_context_to_away(self):
        place = location.save_place(
            name="Academia", context="gym", latitude=-23.55, longitude=-46.63
        )
        location.update_sample(-23.55, -46.63)
        self.assertTrue(location.delete_place(place["id"]))
        self.assertEqual(location.get_state()["context"], "away")

    def test_significant_change_outside_places_means_commuting(self):
        state = location.update_sample(
            -23.56, -46.64, source="significant_change"
        )
        self.assertEqual(state["context"], "commuting")

    def test_explicit_route_records_filtered_points_and_summary(self):
        route = location.start_route("Caminho para o trabalho")
        self.assertEqual(route["status"], "active")
        location.update_sample(
            -23.5505, -46.6333, accuracy_m=12,
            recorded_at="2026-08-10T12:00:00+00:00",
        )
        location.update_sample(
            -23.5495, -46.6323, accuracy_m=10,
            recorded_at="2026-08-10T12:02:00+00:00",
        )
        # Amostra sem precisão suficiente não contamina o caminho.
        location.update_sample(
            -23.5485, -46.6313, accuracy_m=900,
            recorded_at="2026-08-10T12:03:00+00:00",
        )
        completed = location.finish_route()
        self.assertIsNotNone(completed)
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["point_count"], 2)
        self.assertGreater(completed["distance_m"], 100)
        self.assertEqual(len(completed["points"]), 2)
        self.assertIsNone(location.get_active_route())
        semantic = location.semantic_context_for_prompt()
        self.assertIn("Caminho para o trabalho", semantic)
        self.assertIn("sem coordenadas", semantic)
        self.assertNotIn("-23.", semantic)

        dashboard = location.route_dashboard()
        self.assertEqual(dashboard["routes"][0]["name"], "Caminho para o trabalho")
        self.assertTrue(location.delete_route(route["id"]))
        self.assertEqual(location.list_routes(), [])


if __name__ == "__main__":
    unittest.main()
