import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from cognitive import location_context  # noqa: E402


NOW = datetime(2026, 8, 11, 15, 0, tzinfo=timezone.utc)


def iso(seconds_ago: int) -> str:
    return (NOW - timedelta(seconds=seconds_ago)).isoformat()


class LocationContextEngineTests(unittest.TestCase):
    def test_leaving_home_with_active_trip_is_high_relevance(self):
        snapshot = location_context.derive_context(
            state={"place_id": None, "context": "away", "status": "away"},
            events=[{
                "event_type": "exit", "place_id": 1, "place_name": "Casa",
                "context": "home", "created_at": iso(60),
            }],
            active_trip={"id": 7, "status": "active", "started_at": iso(50), "duration_s": 50},
            recent_trip=None,
            now=NOW,
        )
        self.assertEqual(snapshot["state"], "LEAVING_HOME")
        self.assertEqual(snapshot["relevance"], "HIGH")
        self.assertTrue(snapshot["trip_active"])
        self.assertEqual(snapshot["trip_origin"]["name"], "Casa")

    def test_old_arrival_becomes_stable_place_without_recent_event(self):
        snapshot = location_context.derive_context(
            state={"place_id": 2, "place_name": "Escritório", "context": "work", "status": "inside"},
            events=[{
                "event_type": "enter", "place_id": 2, "place_name": "Escritório",
                "context": "work", "created_at": iso(4 * 60 * 60),
            }],
            active_trip=None,
            recent_trip=None,
            now=NOW,
        )
        self.assertEqual(snapshot["state"], "AT_WORK")
        self.assertEqual(snapshot["relevance"], "LOW")
        self.assertIsNone(snapshot["recent_event"])

    def test_recent_arrival_at_work(self):
        snapshot = location_context.derive_context(
            state={"place_id": 2, "place_name": "Trabalho", "context": "work", "status": "inside"},
            events=[{
                "event_type": "enter", "place_id": 2, "place_name": "Trabalho",
                "context": "work", "created_at": iso(90),
            }],
            active_trip=None,
            recent_trip=None,
            now=NOW,
        )
        self.assertEqual(snapshot["state"], "ARRIVING_WORK")
        self.assertEqual(snapshot["recent_event"], "ARRIVED_WORK")
        self.assertEqual(snapshot["recent_event_age_seconds"], 90)

    def test_chat_gate_accepts_greeting_but_rejects_technical_question(self):
        snapshot = {"relevance": "HIGH", "state": "LEAVING_HOME"}
        self.assertTrue(location_context.should_attach_to_chat("eai", snapshot))
        self.assertTrue(location_context.should_attach_to_chat("eai chat", snapshot))
        self.assertTrue(location_context.should_attach_to_chat("finalmente", snapshot))
        self.assertFalse(location_context.should_attach_to_chat("como funciona useEffect?", snapshot))
        self.assertFalse(location_context.should_attach_to_chat("como funciona useEffect hoje?", snapshot))

    def test_commuting_gate_accepts_natural_movement_without_inventing_destination(self):
        snapshot = {"relevance": "MEDIUM", "state": "COMMUTING"}
        self.assertTrue(location_context.should_attach_to_chat("to indo resolver umas coisas", snapshot))

    def test_explicit_location_question_receives_unknown_snapshot(self):
        snapshot = {"relevance": "NONE", "state": "UNKNOWN"}
        self.assertTrue(location_context.should_attach_to_chat("onde estou?", snapshot))

    def test_relevance_decays_from_medium_to_low_and_then_expires(self):
        def leaving_snapshot(seconds_ago: int):
            return location_context.derive_context(
                state={"place_id": None, "context": "away", "status": "away"},
                events=[{
                    "event_type": "exit", "place_id": 1, "place_name": "Casa",
                    "context": "home", "created_at": iso(seconds_ago),
                }],
                active_trip=None, recent_trip=None, now=NOW,
            )

        self.assertEqual(leaving_snapshot(8 * 60)["relevance"], "MEDIUM")
        self.assertEqual(leaving_snapshot(30 * 60)["relevance"], "LOW")
        expired = leaving_snapshot(46 * 60)
        self.assertEqual(expired["relevance"], "NONE")
        self.assertIsNone(expired["recent_event"])

    def test_requested_relevance_samples(self):
        def leaving_relevance(seconds_ago: int):
            return location_context.derive_context(
                state={"place_id": None, "context": "away", "status": "away"},
                events=[{
                    "event_type": "exit", "place_id": 1, "place_name": "Casa",
                    "context": "home", "created_at": iso(seconds_ago),
                }],
                active_trip=None, recent_trip=None, now=NOW,
            )["relevance"]

        self.assertEqual(leaving_relevance(10), "HIGH")
        self.assertEqual(leaving_relevance(2 * 60), "HIGH")
        self.assertEqual(leaving_relevance(20 * 60), "LOW")

        stable_home = location_context.derive_context(
            state={"place_id": 1, "place_name": "Casa", "context": "home", "status": "inside"},
            events=[{
                "event_type": "enter", "place_id": 1, "place_name": "Casa",
                "context": "home", "created_at": iso(3 * 60 * 60),
            }],
            active_trip=None, recent_trip=None, now=NOW,
        )
        self.assertEqual(stable_home["state"], "AT_HOME")
        self.assertEqual(stable_home["relevance"], "LOW")

    def test_prompt_is_minimal_and_never_contains_coordinates(self):
        snapshot = location_context.derive_context(
            state={"place_id": None, "context": "away", "status": "away", "latitude": -23.1, "longitude": -46.2},
            events=[{
                "event_type": "exit", "place_id": 1, "place_name": "Casa",
                "context": "home", "created_at": iso(30),
            }],
            active_trip={"id": 3, "status": "active", "started_at": iso(20), "duration_s": 20},
            recent_trip=None,
            now=NOW,
        )
        with patch.object(location_context, "current_context", return_value=snapshot):
            prompt = location_context.context_for_chat("eai chat", now=NOW)
        self.assertIn("LEAVING_HOME", prompt)
        self.assertIn("origem do trajeto: Casa", prompt)
        self.assertIn("destino do trajeto: desconhecido", prompt)
        self.assertNotIn("latitude", prompt.lower())
        self.assertNotIn("longitude", prompt.lower())
        self.assertNotIn("-23.1", prompt)
        self.assertNotIn("-46.2", prompt)

    def test_exact_location_is_included_only_when_explicitly_requested(self):
        snapshot = location_context.derive_context(
            state={"place_id": 1, "place_name": "Casa", "context": "home", "status": "inside"},
            events=[], active_trip=None, recent_trip=None, now=NOW,
        )
        with patch.object(location_context, "current_context", return_value=snapshot), patch.object(
            location_context.location,
            "get_state",
            return_value={
                "latitude": -23.550520,
                "longitude": -46.633308,
                "accuracy_m": 8,
                "updated_at": iso(4),
            },
        ):
            prompt = location_context.context_for_chat("onde exatamente estou?", now=NOW)
        self.assertIn("latitude local: -23.550520", prompt)
        self.assertIn("longitude local: -46.633308", prompt)
        self.assertIn("precisão estimada: 8 metros", prompt)

    def test_repeated_transitions_predict_destination_without_model(self):
        events = [{
            "event_type": "exit", "place_id": 1, "place_name": "Casa",
            "context": "home", "created_at": iso(60),
        }]
        for days in (1, 2, 3):
            events.extend([
                {
                    "event_type": "exit", "place_id": 1, "place_name": "Casa",
                    "context": "home", "created_at": iso(days * 86_400 + 3_600),
                },
                {
                    "event_type": "enter", "place_id": 2, "place_name": "Trabalho",
                    "context": "work", "created_at": iso(days * 86_400 + 1_800),
                },
            ])
        snapshot = location_context.derive_context(
            state={"place_id": None, "context": "away", "status": "away"},
            events=events,
            active_trip={"id": 9, "status": "active", "started_at": iso(50), "duration_s": 50},
            recent_trip=None,
            now=NOW,
        )
        self.assertEqual(snapshot["trip_destination"]["name"], "Trabalho")
        self.assertEqual(snapshot["routine"]["sample_count"], 3)
        self.assertEqual(snapshot["destination_confidence"], 1.0)

    def test_location_failure_is_fail_open_for_chat(self):
        with patch.object(location_context, "current_context", side_effect=RuntimeError("GPS indisponível")):
            self.assertEqual(location_context.context_for_chat("eai"), "")

    def test_functional_chat_gate_matrix(self):
        cases = [
            ({"state": "AT_HOME", "relevance": "LOW"}, "eai", False),
            ({"state": "LEAVING_HOME", "relevance": "HIGH"}, "eai chat", True),
            ({"state": "COMMUTING", "relevance": "MEDIUM"}, "to indo resolver umas coisas", True),
            ({"state": "ARRIVING_WORK", "relevance": "HIGH"}, "cheguei", True),
            ({"state": "AT_WORK", "relevance": "LOW"}, "me explica promises em JavaScript", False),
            ({"state": "LEAVING_WORK", "relevance": "HIGH"}, "finalmente", True),
            ({"state": "UNKNOWN", "relevance": "NONE"}, "onde estou?", True),
        ]
        for snapshot, message, expected in cases:
            with self.subTest(state=snapshot["state"], message=message):
                self.assertEqual(location_context.should_attach_to_chat(message, snapshot), expected)

    def test_hundred_location_events_require_no_model_dependency(self):
        events = [{
            "event_type": "exit" if index % 2 else "enter",
            "place_id": 1,
            "place_name": "Casa",
            "context": "home",
            "created_at": iso(index + 1),
        } for index in range(100)]
        snapshot = location_context.derive_context(
            state={"place_id": 1, "place_name": "Casa", "context": "home", "status": "inside"},
            events=events,
            active_trip=None,
            recent_trip=None,
            now=NOW,
        )
        self.assertEqual(snapshot["recent_event_age_seconds"], 1)
        self.assertFalse(any(name.startswith(("llm_", "qwen", "ollama")) for name in vars(location_context)))

    def test_explicit_manual_place_context_is_supported(self):
        snapshot = location_context.derive_context(
            state={"place_id": None, "context": "home", "status": "manual"},
            events=[], active_trip=None, recent_trip=None, now=NOW,
        )
        self.assertEqual(snapshot["state"], "AT_HOME")
        self.assertEqual(snapshot["current_place"]["name"], "Casa")
        self.assertEqual(snapshot["movement"], "UNKNOWN")

    def test_unknown_has_no_invented_stationary_state(self):
        snapshot = location_context.derive_context(
            state={"place_id": None, "context": "away", "status": "away"},
            events=[], active_trip=None, recent_trip=None, now=NOW,
        )
        self.assertEqual(snapshot["state"], "UNKNOWN")
        self.assertEqual(snapshot["movement"], "UNKNOWN")
        self.assertEqual(snapshot["relevance"], "NONE")


if __name__ == "__main__":
    unittest.main()
