import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database_v2  # noqa: E402
import local_sync  # noqa: E402
from cognitive import focus  # noqa: E402


class LocalSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "sync.sqlite3"
        self.previous_path = database_v2.DB_PATH
        database_v2.DB_PATH = self.database_path
        with database_v2.get_db_connection() as conn:
            database_v2._create_focus_tasks(conn)
            database_v2._create_focus_v2_tables(conn)
            database_v2._migrate_focus_capture_columns(conn)
            database_v2._create_local_sync_v0(conn)
            database_v2._upgrade_local_sync_v1(conn)
            database_v2._create_location_context(conn)
            conn.commit()
        self.mac = local_sync.get_local_device()
        self.iphone_id = str(uuid.uuid4())
        self.token = "test-token-with-enough-entropy"
        with database_v2.get_db_connection() as conn:
            conn.execute(
                """INSERT INTO local_sync_trusted_peers
                   (peer_device_id,device_name,device_type,token_hash,paired_at)
                   VALUES (?,?,?,?,?)""",
                (self.iphone_id, "iPhone", "iphone", local_sync._token_hash(self.token), local_sync.utc_now()),
            )
            conn.execute(
                "INSERT INTO local_sync_peer_state(peer_device_id) VALUES (?)",
                (self.iphone_id,),
            )
            conn.commit()

    def tearDown(self):
        database_v2.DB_PATH = self.previous_path
        self.temp_dir.cleanup()

    def iphone_change(self, *, uid=None, version=1, title="Estudar React às 20h", **updates):
        now = local_sync.utc_now()
        task = {
            "sync_uid": uid or str(uuid.uuid4()),
            "title": title,
            "category": "study",
            "priority": "medium",
            "completed": False,
            "is_focus": False,
            "created_at": now,
            "updated_at": now,
            "due_date": "2026-08-12T20:00:00",
            "item_type": "TASK",
            "source": "manual",
            "confidence": 1,
            "place_context": "anywhere",
            "trigger_on_arrival": False,
            "sync_version": version,
            "sync_origin_device_id": self.iphone_id,
            "sync_modified_at": now,
            "deleted_at": None,
        }
        task.update(updates)
        return {
            "client_seq": version,
            "change_id": str(uuid.uuid4()),
            "task": task,
        }

    def exchange(self, changes=None, cursor=0, ack=0):
        return local_sync.exchange_focus(self.iphone_id, {
            "protocol_version": 1,
            "schema_version": 1,
            "server_cursor": cursor,
            "acknowledged_client_seq": ack,
            "changes": changes or [],
        })

    def test_schema_has_stable_identity_version_and_tombstone(self):
        with database_v2.get_db_connection() as conn:
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(focus_tasks)")}
        self.assertTrue({"sync_uid", "sync_version", "sync_origin_device_id", "deleted_at"} <= columns)

    def test_iphone_create_arrives_once_on_mac(self):
        change = self.iphone_change()
        first = self.exchange([change])
        # Simula a resposta do primeiro sync perdida na rede: o iPhone repete
        # exatamente o mesmo lote e os mesmos cursores, sem criar duplicata.
        second = self.exchange([change], cursor=0, ack=0)
        tasks = focus.get_focus_tasks()
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["title"], "Estudar React às 20h")
        self.assertEqual(second["applied"], 0)

    def test_mac_edit_is_returned_to_iphone_without_new_identity(self):
        change = self.iphone_change()
        initial = self.exchange([change])
        task = focus.get_focus_tasks()[0]
        uid = task["sync_uid"]
        focus.update_focus_task(task["id"], {"title": "Estudar React e TypeScript às 20h"})
        response = self.exchange([], cursor=initial["server_cursor"], ack=initial["ack_client_seq"])
        matching = [item for item in response["changes"] if item["task"]["sync_uid"] == uid]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["task"]["title"], "Estudar React e TypeScript às 20h")

    def test_completion_propagates(self):
        change = self.iphone_change()
        first = self.exchange([change])
        completed = self.iphone_change(
            uid=change["task"]["sync_uid"], version=2,
            title=change["task"]["title"], completed=True,
        )
        self.exchange([completed], cursor=first["server_cursor"], ack=first["ack_client_seq"])
        self.assertTrue(focus.get_focus_tasks()[0]["completed"])

    def test_tombstone_wins_and_task_does_not_resurrect(self):
        change = self.iphone_change()
        first = self.exchange([change])
        deleted = self.iphone_change(
            uid=change["task"]["sync_uid"], version=2,
            title=change["task"]["title"], deleted_at=local_sync.utc_now(),
        )
        after_delete = self.exchange([deleted], cursor=first["server_cursor"], ack=first["ack_client_seq"])
        self.assertEqual(focus.get_focus_tasks(), [])
        stale = dict(change)
        stale["change_id"] = str(uuid.uuid4())
        self.exchange([stale], cursor=after_delete["server_cursor"], ack=after_delete["ack_client_seq"])
        self.assertEqual(focus.get_focus_tasks(), [])

    def test_equal_version_conflict_uses_origin_device_id_tiebreaker(self):
        uid = str(uuid.uuid4())
        first = self.iphone_change(uid=uid, version=1, title="Original")
        self.exchange([first])
        with database_v2.get_db_connection() as conn:
            row = conn.execute("SELECT id FROM focus_tasks WHERE sync_uid=?", (uid,)).fetchone()
        focus.update_focus_task(int(row["id"]), {"title": "Mac Hooks"})
        with database_v2.get_db_connection() as conn:
            current = dict(conn.execute("SELECT * FROM focus_tasks WHERE sync_uid=?", (uid,)).fetchone())
        concurrent = self.iphone_change(uid=uid, version=current["sync_version"], title="Revisar React")
        self.exchange([concurrent])
        with database_v2.get_db_connection() as conn:
            final = dict(conn.execute("SELECT * FROM focus_tasks WHERE sync_uid=?", (uid,)).fetchone())
        expected = "Revisar React" if self.iphone_id > self.mac["device_id"] else "Mac Hooks"
        self.assertEqual(final["title"], expected)

    def test_concurrent_different_fields_use_documented_whole_record_policy(self):
        change = self.iphone_change(title="Estudar React")
        self.exchange([change])
        task = focus.get_focus_tasks()[0]
        focus.update_focus_task(task["id"], {"category": "work"})
        with database_v2.get_db_connection() as conn:
            current = dict(conn.execute(
                "SELECT * FROM focus_tasks WHERE sync_uid=?", (change["task"]["sync_uid"],)
            ).fetchone())
        concurrent = self.iphone_change(
            uid=change["task"]["sync_uid"], version=current["sync_version"],
            title="Estudar React", category="study", priority="high",
        )
        self.exchange([concurrent])
        with database_v2.get_db_connection() as conn:
            final = dict(conn.execute(
                "SELECT * FROM focus_tasks WHERE sync_uid=?", (change["task"]["sync_uid"],)
            ).fetchone())
        if self.iphone_id > self.mac["device_id"]:
            self.assertEqual((final["category"], final["priority"]), ("study", "high"))
        else:
            self.assertEqual((final["category"], final["priority"]), ("work", "medium"))

    def test_delta_cursor_never_skips_changes_beyond_batch_limit(self):
        for index in range(3):
            focus.create_focus_task(f"Tarefa {index}")
        with patch.object(local_sync, "MAX_CHANGES_PER_EXCHANGE", 2):
            with database_v2.get_db_connection() as conn:
                first, cursor = local_sync._changes_since(conn, 0)
                second, final_cursor = local_sync._changes_since(conn, cursor)
        self.assertEqual(len(first), 2)
        self.assertEqual(len(second), 1)
        self.assertGreater(final_cursor, cursor)

    def test_invalid_batch_rolls_back_entire_transaction(self):
        valid = self.iphone_change()
        invalid = self.iphone_change()
        invalid["task"]["sync_uid"] = "not-a-uuid"
        with self.assertRaises(ValueError):
            self.exchange([valid, invalid])
        self.assertEqual(focus.get_focus_tasks(), [])

    def test_unknown_device_is_not_authenticated(self):
        self.assertTrue(local_sync.authenticate_peer(self.iphone_id, self.token))
        self.assertFalse(local_sync.authenticate_peer(str(uuid.uuid4()), self.token))
        self.assertFalse(local_sync.authenticate_peer(self.iphone_id, "wrong-token"))

    def test_incompatible_protocol_is_blocked(self):
        with self.assertRaisesRegex(ValueError, "incompatível"):
            local_sync.exchange_focus(self.iphone_id, {
                "protocol_version": 99,
                "schema_version": 1,
                "server_cursor": 0,
                "acknowledged_client_seq": 0,
                "changes": [],
            })

    def test_presence_drives_real_connection_and_consumes_manual_request(self):
        first = local_sync.update_presence(self.iphone_id, {
            "protocol_version": 1,
            "app_version": "1",
            "capabilities": local_sync.IPHONE_CAPABILITIES,
        })
        self.assertFalse(first["sync_requested"])
        status = local_sync.sync_status()
        peer = next(item for item in status["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertTrue(peer["connected"])
        queued = local_sync.request_sync(self.iphone_id)
        self.assertTrue(queued["requested"])
        duplicate = local_sync.request_sync(self.iphone_id)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["request_id"], queued["request_id"])
        second = local_sync.update_presence(self.iphone_id, {
            "protocol_version": 1,
            "app_version": "1",
            "capabilities": local_sync.IPHONE_CAPABILITIES,
        })
        self.assertTrue(second["sync_requested"])
        self.assertEqual(second["request_id"], queued["request_id"])
        third = local_sync.update_presence(self.iphone_id, {
            "protocol_version": 1,
            "app_version": "1",
            "capabilities": local_sync.IPHONE_CAPABILITIES,
        })
        self.assertFalse(third["sync_requested"])

    def test_manual_request_rejects_stale_peer_instead_of_lying(self):
        with self.assertRaisesRegex(ConnectionError, "Abra o Buds"):
            local_sync.request_sync(self.iphone_id)

    def test_successful_commit_updates_counts_and_bounded_history(self):
        change = self.iphone_change()
        response = self.exchange([change])
        self.assertEqual(response["received"], 1)
        before_ack = local_sync.sync_status()
        before_peer = next(item for item in before_ack["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertIsNone(before_peer["last_sync_at"])
        self.assertEqual(before_ack["history"], [])
        local_sync.acknowledge_exchange(self.iphone_id, {
            "protocol_version": 1,
            "schema_version": 1,
            "exchange_id": response["exchange_id"],
            "server_cursor": response["server_cursor"],
        })
        status = local_sync.sync_status()
        peer = next(item for item in status["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertEqual(peer["last_received_count"], 1)
        self.assertEqual(peer["total_received_count"], 1)
        self.assertIsNotNone(peer["last_sync_at"])
        self.assertEqual(status["history"][0]["status"], "synced")
        self.assertEqual(status["history"][0]["received_count"], 1)

    def test_ack_is_idempotent_and_rejects_wrong_cursor(self):
        response = self.exchange([])
        payload = {
            "protocol_version": 1,
            "schema_version": 1,
            "exchange_id": response["exchange_id"],
            "server_cursor": response["server_cursor"],
        }
        first = local_sync.acknowledge_exchange(self.iphone_id, payload)
        second = local_sync.acknowledge_exchange(self.iphone_id, payload)
        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        status = local_sync.sync_status()
        self.assertEqual(len(status["history"]), 1)

        another = self.exchange([])
        with self.assertRaisesRegex(ValueError, "Cursor"):
            local_sync.acknowledge_exchange(self.iphone_id, {
                "protocol_version": 1,
                "schema_version": 1,
                "exchange_id": another["exchange_id"],
                "server_cursor": another["server_cursor"] + 1,
            })

    def test_manifest_builds_plan_without_applying_changes(self):
        focus.create_focus_task("Planejar semana")
        plan = local_sync.build_manifest(self.iphone_id, {
            "protocol_version": 1,
            "schema_version": 1,
            "server_cursor": 0,
            "pending": {"focus_tasks": 2},
        })
        self.assertEqual(plan["plan"]["receive"]["focus_tasks"], 2)
        self.assertEqual(plan["plan"]["send"]["focus_tasks"], 1)
        self.assertEqual(plan["schema_version"], 1)

    def test_capabilities_only_advertise_implemented_sync_features(self):
        self.assertIn("focus_tasks", local_sync.MAC_CAPABILITIES)
        self.assertNotIn("chat", local_sync.MAC_CAPABILITIES)
        self.assertNotIn("memory", local_sync.IPHONE_CAPABILITIES)

    def test_focus_schema_version_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "Schema"):
            local_sync.exchange_focus(self.iphone_id, {
                "protocol_version": 1,
                "server_cursor": 0,
                "acknowledged_client_seq": 0,
                "changes": [],
            })

    def test_pairing_code_is_single_use(self):
        with patch.object(local_sync, "start_advertisement", return_value=True):
            pairing = local_sync.start_pairing()
        peer = {"device_id": str(uuid.uuid4()), "device_name": "Outro iPhone", "device_type": "iphone"}
        local_sync.pair_peer(peer, pairing["code"])
        with self.assertRaises(PermissionError):
            local_sync.pair_peer(peer, pairing["code"])

    def test_pairing_locks_after_five_invalid_attempts(self):
        with patch.object(local_sync, "start_advertisement", return_value=True):
            pairing = local_sync.start_pairing()
        peer = {"device_id": str(uuid.uuid4()), "device_name": "iPhone", "device_type": "iphone"}
        for _ in range(5):
            with self.assertRaises(PermissionError):
                local_sync.pair_peer(peer, "000000" if pairing["code"] != "000000" else "999999")
        with self.assertRaises(PermissionError):
            local_sync.pair_peer(peer, pairing["code"])


if __name__ == "__main__":
    unittest.main()
