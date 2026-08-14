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
import database  # noqa: E402
import local_sync  # noqa: E402
from cognitive import focus  # noqa: E402


class LocalSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "sync.sqlite3"
        self.previous_path = database_v2.DB_PATH
        self.previous_base_path = database.DB_PATH
        database_v2.DB_PATH = self.database_path
        database.DB_PATH = self.database_path
        database.init_db()
        with database_v2.get_db_connection() as conn:
            database_v2._create_memories(conn)
            database_v2._migrate_memories_core_columns(conn)
            database_v2._migrate_memory_scope(conn)
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
                   (peer_device_id,device_name,device_type,token_hash,paired_at,capabilities)
                   VALUES (?,?,?,?,?,?)""",
                (self.iphone_id, "iPhone", "iphone", local_sync._token_hash(self.token),
                 local_sync.utc_now(), local_sync.json.dumps(local_sync.IPHONE_CAPABILITIES)),
            )
            conn.execute(
                "INSERT INTO local_sync_peer_state(peer_device_id) VALUES (?)",
                (self.iphone_id,),
            )
            conn.commit()

    def tearDown(self):
        database_v2.DB_PATH = self.previous_path
        database.DB_PATH = self.previous_base_path
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

    def exchange(self, changes=None, cursor=0, ack=0, sync_run_id=None):
        payload = {
            "protocol_version": 1,
            "schema_version": 1,
            "server_cursor": cursor,
            "acknowledged_client_seq": ack,
            "changes": changes or [],
        }
        if sync_run_id:
            payload["sync_run_id"] = sync_run_id
        return local_sync.exchange_focus(self.iphone_id, payload)

    def upload_change(self, entity_type, entity_uid, seq, record=None, operation="upsert", version=None):
        return {
            "client_seq": seq,
            "change_id": str(uuid.uuid4()),
            "entity_type": entity_type,
            "entity_uid": entity_uid,
            "entity_version": version or seq,
            "operation": operation,
            "changed_at": local_sync.utc_now(),
            "record": record or {},
        }

    def mobile_upload(self, changes, acknowledged=0, sync_run_id=None):
        payload = {
            "protocol_version": 1,
            "schema_version": 1,
            "acknowledged_client_seq": acknowledged,
            "changes": changes,
        }
        if sync_run_id:
            payload["sync_run_id"] = sync_run_id
        return local_sync.ingest_mobile_upload(self.iphone_id, payload)

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
            "capabilities": local_sync.IPHONE_CAPABILITIES,
            "server_cursor": 0,
            "pending": {"focus_tasks": 2},
        })
        self.assertEqual(plan["plan"]["receive"]["focus_tasks"], 2)
        self.assertEqual(plan["plan"]["send"]["focus_tasks"], 1)
        self.assertEqual(plan["schema_version"], 1)

    def test_manifest_upgrades_v0_peer_capabilities_without_new_pairing(self):
        with database_v2.get_db_connection() as conn:
            conn.execute(
                "UPDATE local_sync_trusted_peers SET capabilities=? WHERE peer_device_id=?",
                (local_sync.json.dumps(["focus_tasks", "presence"]), self.iphone_id),
            )
            conn.commit()
        self.assertFalse(local_sync.peer_can_upload_personal_domain(self.iphone_id))
        local_sync.build_manifest(self.iphone_id, {
            "protocol_version": 1, "schema_version": 1,
            "capabilities": local_sync.IPHONE_CAPABILITIES,
            "server_cursor": 0, "pending": {"chat_messages": 1},
        })
        self.assertTrue(local_sync.peer_can_upload_personal_domain(self.iphone_id))

    def test_capabilities_only_advertise_implemented_sync_features(self):
        self.assertIn("focus_tasks:bidirectional", local_sync.MAC_CAPABILITIES)
        self.assertIn("chat:ingest", local_sync.MAC_CAPABILITIES)
        self.assertIn("chat:upload", local_sync.IPHONE_CAPABILITIES)
        self.assertNotIn("chat:upload", local_sync.MAC_CAPABILITIES)
        self.assertNotIn("memory:ingest", local_sync.IPHONE_CAPABILITIES)

    def test_mobile_upload_imports_folder_chat_messages_and_memory_one_way(self):
        folder_id = str(uuid.uuid4())
        session_id = str(uuid.uuid4())
        message_ids = [str(uuid.uuid4()) for _ in range(3)]
        memory_id = str(uuid.uuid4())
        changes = [
            self.upload_change("chat_folder", folder_id, 1, {
                "name": "Trabalho", "icon": "briefcase", "color": "#22c55e",
                "created_at": local_sync.utc_now(), "updated_at": local_sync.utc_now(),
            }),
            self.upload_change("chat_session", session_id, 2, {
                "title": "Projeto iPhone", "folder_id": folder_id, "channel": "chat",
                "created_at": local_sync.utc_now(), "deleted_at": None,
            }),
        ]
        for index, message_id in enumerate(message_ids, start=3):
            changes.append(self.upload_change("chat_message", message_id, index, {
                "session_id": session_id,
                "sender": "user" if index % 2 else "ia",
                "text": f"Mensagem {index - 2}", "created_at": local_sync.utc_now(),
            }))
        changes.append(self.upload_change("memory", memory_id, 6, {
            "content": "Vítor está construindo o Buds Local Sync.",
            "importance": 0.8, "is_core": False, "scope": "conversation",
            "session_id": session_id, "memory_type": "long", "tags": ["buds"],
            "created_at": local_sync.utc_now(), "origin_type": "conversation",
        }))
        response = self.mobile_upload(changes)
        self.assertEqual(response["received"], 6)
        self.assertEqual(response["applied"], 6)
        with database_v2.get_db_connection() as conn:
            folder = conn.execute("SELECT * FROM chat_folders WHERE id=?", (folder_id,)).fetchone()
            session = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            messages = conn.execute("SELECT * FROM messages WHERE session_id=? ORDER BY id", (session_id,)).fetchall()
            memory = conn.execute("SELECT * FROM memories WHERE sync_uid=?", (memory_id,)).fetchone()
        self.assertEqual(folder["sync_origin_device_id"], self.iphone_id)
        self.assertEqual(session["folder_id"], folder_id)
        self.assertEqual([row["text"] for row in messages], ["Mensagem 1", "Mensagem 2", "Mensagem 3"])
        self.assertEqual(memory["session_id"], session_id)
        self.assertEqual(memory["memory_type"], "long")

    def test_mobile_upload_applies_parent_before_earlier_message(self):
        session_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())
        # Situação real do iPhone: INSERT da mensagem acontece antes do UPDATE
        # automático do título, então o último evento da sessão possui seq 3.
        message = self.upload_change("chat_message", message_id, 2, {
            "session_id": session_id, "sender": "user", "text": "Primeira mensagem",
            "created_at": local_sync.utc_now(),
        })
        session = self.upload_change("chat_session", session_id, 3, {
            "title": "Primeira mensagem", "folder_id": None, "channel": "chat",
            "created_at": local_sync.utc_now(), "deleted_at": None,
        })
        response = self.mobile_upload([message, session])
        self.assertEqual(response["applied"], 2)
        with database_v2.get_db_connection() as conn:
            stored = conn.execute(
                "SELECT session_id,text FROM messages WHERE sync_uid=?", (message_id,)
            ).fetchone()
        self.assertEqual(stored["session_id"], session_id)
        self.assertEqual(stored["text"], "Primeira mensagem")

    def test_mobile_upload_retry_is_idempotent(self):
        session_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())
        changes = [
            self.upload_change("chat_session", session_id, 1, {
                "title": "Retry", "folder_id": None, "channel": "chat",
                "created_at": local_sync.utc_now(), "deleted_at": None,
            }),
            self.upload_change("chat_message", message_id, 2, {
                "session_id": session_id, "sender": "user", "text": "Não duplicar",
                "created_at": local_sync.utc_now(),
            }),
        ]
        self.mobile_upload(changes)
        retried = self.mobile_upload(changes)
        self.assertEqual(retried["applied"], 0)
        with database_v2.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages WHERE sync_uid=?", (message_id,)).fetchone()[0], 1)

    def test_mobile_chat_delete_offline_does_not_resurrect(self):
        session_id = str(uuid.uuid4())
        create = self.upload_change("chat_session", session_id, 1, {
            "title": "Apagar depois", "folder_id": None, "channel": "chat",
            "created_at": local_sync.utc_now(), "deleted_at": None,
        }, version=1)
        self.mobile_upload([create])
        delete = self.upload_change("chat_session", session_id, 2, operation="delete", version=2)
        self.mobile_upload([delete], acknowledged=1)
        stale = self.upload_change("chat_session", session_id, 3, {
            "title": "Não ressuscitar", "folder_id": None, "channel": "chat",
            "created_at": local_sync.utc_now(), "deleted_at": None,
        }, version=1)
        self.mobile_upload([stale], acknowledged=2)
        with database_v2.get_db_connection() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        self.assertIsNotNone(row["deleted_at"])

    def test_core_memory_is_not_deleted_by_mobile_tombstone(self):
        memory_id = str(uuid.uuid4())
        create = self.upload_change("memory", memory_id, 1, {
            "content": "Meu nome preferido é Vítor.", "importance": 0.98,
            "is_core": True, "locked": True, "user_confirmed": True,
            "scope": "global", "session_id": None, "memory_type": "long",
            "created_at": local_sync.utc_now(), "tags": ["perfil"],
        }, version=1)
        self.mobile_upload([create])
        deletion = self.upload_change("memory", memory_id, 2, operation="delete", version=2)
        response = self.mobile_upload([deletion], acknowledged=1)
        self.assertEqual(response["conflicts"], 1)
        with database_v2.get_db_connection() as conn:
            row = conn.execute("SELECT * FROM memories WHERE sync_uid=?", (memory_id,)).fetchone()
        self.assertIsNotNone(row)
        self.assertTrue(row["is_core"])
        self.assertTrue(row["locked"])

    def test_orphan_message_rolls_back_entire_mobile_batch(self):
        valid_session = str(uuid.uuid4())
        valid = self.upload_change("chat_session", valid_session, 1, {
            "title": "Transação", "folder_id": None, "channel": "chat",
            "created_at": local_sync.utc_now(), "deleted_at": None,
        })
        orphan = self.upload_change("chat_message", str(uuid.uuid4()), 2, {
            "session_id": str(uuid.uuid4()), "sender": "user", "text": "Órfã",
            "created_at": local_sync.utc_now(),
        })
        with self.assertRaisesRegex(ValueError, "sem sua conversa"):
            self.mobile_upload([valid, orphan])
        with database_v2.get_db_connection() as conn:
            self.assertIsNone(conn.execute("SELECT * FROM sessions WHERE id=?", (valid_session,)).fetchone())

    def test_mobile_upload_requires_directional_capability(self):
        self.assertTrue(local_sync.peer_can_upload_personal_domain(self.iphone_id))
        with database_v2.get_db_connection() as conn:
            conn.execute(
                "UPDATE local_sync_trusted_peers SET capabilities='[]' WHERE peer_device_id=?",
                (self.iphone_id,),
            )
            conn.commit()
        self.assertFalse(local_sync.peer_can_upload_personal_domain(self.iphone_id))

    def test_mobile_upload_only_becomes_synced_after_ack_and_can_recover_ack(self):
        session_id = str(uuid.uuid4())
        sync_run_id = str(uuid.uuid4())
        response = self.mobile_upload([
            self.upload_change("chat_session", session_id, 1, {
                "title": "ACK mobile", "folder_id": None, "channel": "chat",
                "created_at": local_sync.utc_now(), "deleted_at": None,
            })
        ], sync_run_id=sync_run_id)
        before = local_sync.sync_status()
        peer = next(item for item in before["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertEqual(peer["awaiting_ack"], 1)
        self.assertEqual(before["history"], [])
        presence = local_sync.update_presence(self.iphone_id, {
            "protocol_version": 1, "app_version": "1",
            "capabilities": local_sync.IPHONE_CAPABILITIES,
            "upload_ack_seq": response["ack_client_seq"],
        })
        self.assertEqual(presence["pending_acks"][0]["exchange_id"], response["exchange_id"])
        local_sync.acknowledge_exchange(self.iphone_id, {
            "protocol_version": 1, "schema_version": 1,
            "exchange_id": response["exchange_id"], "server_cursor": 0,
        })
        after = local_sync.sync_status()
        peer = next(item for item in after["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertEqual(peer["awaiting_ack"], 0)
        self.assertEqual(peer["last_upload_ack_seq"], 1)
        self.assertIsNone(peer["last_sync_at"])
        self.assertEqual(after["history"], [])

        # O ACK de Focus é a barreira final da execução completa. Assim o Mac
        # nunca exibe sucesso enquanto chats/memórias ainda estiverem no meio
        # de uma transferência interrompida.
        focus_response = self.exchange(sync_run_id=sync_run_id)
        local_sync.acknowledge_exchange(self.iphone_id, {
            "protocol_version": 1, "schema_version": 1,
            "exchange_id": focus_response["exchange_id"],
            "server_cursor": focus_response["server_cursor"],
        })
        completed = local_sync.sync_status()
        peer = next(item for item in completed["peers"] if item["peer_device_id"] == self.iphone_id)
        self.assertIsNotNone(peer["last_sync_at"])
        self.assertEqual(completed["history"][0]["received_count"], 1)

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
