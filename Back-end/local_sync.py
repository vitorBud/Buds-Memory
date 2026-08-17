"""Buds Local Sync — reconciliação local e autenticada entre instalações.

O Focus usa deltas bidirecionais. Chats, pastas, mensagens e memórias pessoais
possuem uma entrada separada e unilateral do iPhone para o Mac; esses domínios
nunca são exportados de volta ao celular. O usuário inicia a troca manualmente.
"""

from __future__ import annotations

import atexit
import hashlib
import hmac
import json
import platform
import re
import secrets
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from flask import Blueprint, jsonify, request

from database_v2 import get_db_connection
import remote_access


local_sync_bp = Blueprint("local_sync", __name__, url_prefix="/api/local-sync/v0")

ENTITY_TYPE = "focus_task"
PROTOCOL_VERSION = 1
PROTOCOL_NAME = "buds-local-sync"
APP_VERSION = "1"
MAC_CAPABILITIES = [
    "focus_tasks:bidirectional", "chat:ingest", "folders:ingest", "memory:ingest",
    "presence", "manual_sync_request", "sync_history",
]
IPHONE_CAPABILITIES = [
    "focus_tasks:bidirectional", "chat:upload", "folders:upload", "memory:upload",
    "presence", "manual_sync_request",
]
PRESENCE_TTL_SECONDS = 15
PAIRING_TTL_SECONDS = 5 * 60
ADVERTISEMENT_TTL_SECONDS = 2 * 60
MAX_CHANGES_PER_EXCHANGE = 500
MAX_SYNC_PAYLOAD_BYTES = 2 * 1024 * 1024
VALID_CATEGORIES = {"work", "study", "personal", "project", "other"}
VALID_PRIORITIES = {"low", "medium", "high"}
VALID_ITEM_TYPES = {"TASK", "REMINDER"}
VALID_PLACE_CONTEXTS = {"anywhere", "home", "work", "gym", "study", "other"}
UPLOAD_ENTITY_TYPES = {"chat_folder", "chat_session", "chat_message", "memory"}
VALID_CHAT_CHANNELS = {"chat", "voice"}
VALID_MEMORY_SCOPES = {"global", "conversation"}
VALID_MEMORY_TYPES = {"short", "medium", "long", "archive"}

_pairing_lock = threading.Lock()
_pairing_session: Optional[dict[str, Any]] = None
_advertiser_lock = threading.Lock()
_advertiser_process: Optional[subprocess.Popen] = None
_advertiser_timer: Optional[threading.Timer] = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except (TypeError, ValueError):
        return None


def _is_present(value: Optional[str]) -> bool:
    parsed = _parse_time(value)
    return bool(parsed and (datetime.now(timezone.utc) - parsed).total_seconds() <= PRESENCE_TTL_SECONDS)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _json(payload: Any, status: int = 200):
    return jsonify(payload), status


def _local_request_only() -> bool:
    return remote_access.is_loopback_address(request.remote_addr)


def get_local_device(conn=None) -> dict[str, Any]:
    owns_connection = conn is None
    if owns_connection:
        conn = get_db_connection()
    try:
        row = conn.execute(
            """SELECT device_id,device_name,device_type,created_at,updated_at
               FROM local_sync_device WHERE singleton=1"""
        ).fetchone()
        if not row:
            raise RuntimeError("Identidade Local Sync não inicializada.")
        return dict(row)
    finally:
        if owns_connection:
            conn.close()


def _stop_advertisement() -> None:
    global _advertiser_process, _advertiser_timer
    with _advertiser_lock:
        if _advertiser_timer:
            _advertiser_timer.cancel()
            _advertiser_timer = None
        process = _advertiser_process
        _advertiser_process = None
        if process and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass


def start_advertisement(duration: int = ADVERTISEMENT_TTL_SECONDS) -> bool:
    """Anuncia o Mac via Bonjour somente durante uma janela manual curta."""
    global _advertiser_process, _advertiser_timer
    _stop_advertisement()
    if platform.system().lower() != "darwin":
        return False
    device = get_local_device()
    local_url = f"http://{remote_access.get_local_ip()}:{remote_access.PORT}"
    name = f"Buds Memory — {device['device_name']}"[:63]
    command = [
        "/usr/bin/dns-sd", "-R", name, "_budssync._tcp", "local.",
        str(remote_access.PORT),
        f"id={device['device_id']}",
        f"type={device['device_type']}",
        f"url={local_url}",
        f"protocol={PROTOCOL_NAME}",
        f"version={PROTOCOL_VERSION}",
    ]
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False
    with _advertiser_lock:
        _advertiser_process = process
        timer = threading.Timer(max(15, min(duration, 600)), _stop_advertisement)
        timer.daemon = True
        timer.start()
        _advertiser_timer = timer
    return True


atexit.register(_stop_advertisement)


def start_pairing() -> dict[str, Any]:
    global _pairing_session
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = time.monotonic()
    with _pairing_lock:
        _pairing_session = {
            "code_hash": _token_hash(code),
            "expires_monotonic": now + PAIRING_TTL_SECONDS,
            "used": False,
            "failed_attempts": 0,
        }
    advertised = start_advertisement()
    return {
        "code": code,
        "expires_in_seconds": PAIRING_TTL_SECONDS,
        "advertised": advertised,
        "device": get_local_device(),
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
    }


def _consume_pairing_code(code: str) -> bool:
    global _pairing_session
    with _pairing_lock:
        session = _pairing_session
        if not session or session["used"] or time.monotonic() > session["expires_monotonic"]:
            return False
        if not hmac.compare_digest(session["code_hash"], _token_hash(code.strip())):
            session["failed_attempts"] += 1
            if session["failed_attempts"] >= 5:
                session["used"] = True
            return False
        session["used"] = True
        return True


def pair_peer(peer: dict[str, Any], code: str) -> dict[str, Any]:
    peer_id = str(peer.get("device_id") or "").strip()
    peer_name = str(peer.get("device_name") or "iPhone").strip()[:100]
    peer_type = str(peer.get("device_type") or "iphone").strip()[:30]
    protocol_version = int(peer.get("protocol_version") or PROTOCOL_VERSION)
    if protocol_version != PROTOCOL_VERSION:
        raise ValueError(
            f"Versão incompatível do Local Sync. Mac: v{PROTOCOL_VERSION}; dispositivo: v{protocol_version}."
        )
    capabilities = peer.get("capabilities") or IPHONE_CAPABILITIES
    if not isinstance(capabilities, list):
        raise ValueError("Capabilities inválidas no pareamento.")
    capabilities = sorted({str(item)[:40] for item in capabilities if str(item).strip()})[:40]
    try:
        uuid.UUID(peer_id)
    except (ValueError, TypeError):
        raise ValueError("Identidade do dispositivo inválida.")
    if not _consume_pairing_code(code):
        raise PermissionError("Código de pareamento inválido ou expirado.")

    token = secrets.token_urlsafe(32)
    now = utc_now()
    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO local_sync_trusted_peers
               (peer_device_id,device_name,device_type,token_hash,paired_at,last_seen_at,revoked_at,
                protocol_version,app_version,capabilities,last_presence_at)
               VALUES (?,?,?,?,?,?,NULL,?,?,?,?)
               ON CONFLICT(peer_device_id) DO UPDATE SET
                 device_name=excluded.device_name,
                 device_type=excluded.device_type,
                 token_hash=excluded.token_hash,
                 paired_at=excluded.paired_at,
                 last_seen_at=excluded.last_seen_at,
                 protocol_version=excluded.protocol_version,
                 app_version=excluded.app_version,
                 capabilities=excluded.capabilities,
                 last_presence_at=excluded.last_presence_at,
                 revoked_at=NULL""",
            (
                peer_id, peer_name, peer_type, _token_hash(token), now, now,
                protocol_version, str(peer.get("app_version") or APP_VERSION)[:30],
                json.dumps(capabilities), now,
            ),
        )
        conn.execute(
            """INSERT INTO local_sync_peer_state(peer_device_id)
               VALUES (?) ON CONFLICT(peer_device_id) DO NOTHING""",
            (peer_id,),
        )
        conn.commit()
    return {
        "token": token,
        "peer_device_id": peer_id,
        "server_device": get_local_device(),
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
        "app_version": APP_VERSION,
    }


def authenticate_peer(peer_id: str, token: str) -> bool:
    if not peer_id or not token:
        return False
    with get_db_connection() as conn:
        row = conn.execute(
            """SELECT token_hash FROM local_sync_trusted_peers
               WHERE peer_device_id=? AND revoked_at IS NULL""",
            (peer_id,),
        ).fetchone()
    return bool(row and hmac.compare_digest(str(row["token_hash"]), _token_hash(token)))


def peer_can_upload_personal_domain(peer_id: str) -> bool:
    with get_db_connection() as conn:
        row = conn.execute(
            """SELECT device_type,capabilities FROM local_sync_trusted_peers
               WHERE peer_device_id=? AND revoked_at IS NULL""",
            (peer_id,),
        ).fetchone()
    if not row or str(row["device_type"]).lower() not in {"iphone", "ipad", "ios"}:
        return False
    try:
        capabilities = set(json.loads(row["capabilities"] or "[]"))
    except (TypeError, json.JSONDecodeError):
        return False
    return {"chat:upload", "memory:upload"}.issubset(capabilities)


def _authenticated_request_peer() -> Optional[str]:
    peer_id = request.headers.get("X-Buds-Sync-Device", "").strip()
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    return peer_id if authenticate_peer(peer_id, token) else None


def update_presence(peer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    protocol_version = int(payload.get("protocol_version") or 0)
    if protocol_version != PROTOCOL_VERSION:
        raise ValueError(
            f"Versão incompatível do Local Sync. Mac: v{PROTOCOL_VERSION}; iPhone: v{protocol_version}."
        )
    capabilities = payload.get("capabilities") or []
    if not isinstance(capabilities, list):
        raise ValueError("Capabilities inválidas.")
    capabilities = sorted({str(item)[:40] for item in capabilities if str(item).strip()})[:40]
    raw_pending = payload.get("pending") or {}
    if not isinstance(raw_pending, dict):
        raise ValueError("Pendências inválidas na presença.")
    allowed_pending = {"focus_tasks", "chat_folders", "chat_sessions", "chat_messages", "memories"}
    pending = {
        key: max(0, min(100_000, int(value or 0)))
        for key, value in raw_pending.items() if key in allowed_pending
    }
    upload_ack_seq = max(0, int(payload.get("upload_ack_seq") or 0))
    now = utc_now()
    with get_db_connection() as conn:
        conn.execute(
            """UPDATE local_sync_trusted_peers
               SET last_seen_at=?,last_presence_at=?,protocol_version=?,app_version=?,capabilities=?,remote_pending=?
               WHERE peer_device_id=? AND revoked_at IS NULL""",
            (
                now, now, protocol_version, str(payload.get("app_version") or APP_VERSION)[:30],
                json.dumps(capabilities), json.dumps(pending), peer_id,
            ),
        )
        request_row = conn.execute(
            """SELECT request_id FROM local_sync_requests
               WHERE peer_device_id=? AND consumed_at IS NULL
               ORDER BY requested_at ASC LIMIT 1""",
            (peer_id,),
        ).fetchone()
        if request_row:
            conn.execute(
                "UPDATE local_sync_requests SET consumed_at=? WHERE request_id=?",
                (now, request_row["request_id"]),
            )
        pending_acks = [dict(row) for row in conn.execute(
            """SELECT exchange_id,server_cursor FROM local_sync_exchanges
               WHERE peer_device_id=? AND status='awaiting_ack' AND exchange_kind='mobile_upload'
                 AND ack_client_seq<=? ORDER BY created_at ASC LIMIT 20""",
            (peer_id, upload_ack_seq),
        ).fetchall()]
        conn.commit()
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
        "server_device": get_local_device(),
        "sync_requested": bool(request_row),
        "request_id": request_row["request_id"] if request_row else None,
        "pending_acks": pending_acks,
    }


def request_sync(peer_id: str) -> dict[str, Any]:
    try:
        uuid.UUID(peer_id)
    except (ValueError, TypeError):
        raise ValueError("Dispositivo inválido.")
    now = utc_now()
    with get_db_connection() as conn:
        peer = conn.execute(
            """SELECT last_presence_at FROM local_sync_trusted_peers
               WHERE peer_device_id=? AND revoked_at IS NULL""",
            (peer_id,),
        ).fetchone()
        if not peer:
            raise ValueError("iPhone não pareado.")
        if not _is_present(peer["last_presence_at"]):
            raise ConnectionError("Abra o Buds no iPhone para sincronizar.")
        existing = conn.execute(
            """SELECT request_id,requested_at FROM local_sync_requests
               WHERE peer_device_id=? AND consumed_at IS NULL
               ORDER BY requested_at DESC LIMIT 1""",
            (peer_id,),
        ).fetchone()
        if existing:
            return {
                "requested": True, "duplicate": True,
                "request_id": existing["request_id"], "requested_at": existing["requested_at"],
            }
        request_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO local_sync_requests(request_id,peer_device_id,requested_at) VALUES (?,?,?)",
            (request_id, peer_id, now),
        )
        conn.commit()
    return {"requested": True, "duplicate": False, "request_id": request_id, "requested_at": now}


def build_manifest(peer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Negocia um plano pequeno antes de transferir qualquer entidade.

    O manifest não aplica dados e não avança cursor. Ele existe para que os
    dois lados saibam exatamente o tamanho do lote e possam recusar versões
    incompatíveis antes de abrir uma transação de escrita.
    """
    protocol_version = int(payload.get("protocol_version") or 0)
    schema_version = int(payload.get("schema_version") or 0)
    if protocol_version != PROTOCOL_VERSION:
        raise ValueError(
            f"Versão incompatível do Local Sync. Mac: v{PROTOCOL_VERSION}; iPhone: v{protocol_version}."
        )
    if schema_version != 1:
        raise ValueError(f"Schema de sync incompatível: {schema_version}.")
    capabilities = payload.get("capabilities") or []
    if not isinstance(capabilities, list):
        raise ValueError("Capabilities inválidas no manifest.")
    capabilities = sorted({str(item)[:40] for item in capabilities if str(item).strip()})[:40]
    server_cursor = max(0, int(payload.get("server_cursor") or 0))
    incoming_counts = payload.get("pending") or {}
    if not isinstance(incoming_counts, dict):
        raise ValueError("Manifest de pendências inválido.")
    allowed_counts = {"focus_tasks", "chat_folders", "chat_sessions", "chat_messages", "memories"}
    planned_receive = {
        key: max(0, min(MAX_CHANGES_PER_EXCHANGE, int(value or 0)))
        for key, value in incoming_counts.items() if key in allowed_counts
    }
    with get_db_connection() as conn:
        # O manifest também renova a negociação de capabilities. Isso permite
        # que um pareamento criado na V0 passe para a V1 sem apagar o token ou
        # obrigar o usuário a parear os aparelhos novamente.
        if capabilities:
            conn.execute(
                """UPDATE local_sync_trusted_peers
                   SET protocol_version=?,capabilities=?,last_seen_at=?
                   WHERE peer_device_id=? AND revoked_at IS NULL""",
                (protocol_version, json.dumps(capabilities), utc_now(), peer_id),
            )
        outgoing_focus = int(conn.execute(
            """SELECT COUNT(DISTINCT entity_uid) FROM local_sync_changes
               WHERE seq>? AND entity_type='focus_task'""",
            (server_cursor,),
        ).fetchone()[0])
        latest_seq = int(conn.execute(
            "SELECT COALESCE(MAX(seq),0) FROM local_sync_changes"
        ).fetchone()[0])
        conn.commit()
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "schema_version": 1,
        "capabilities": MAC_CAPABILITIES,
        "peer_device_id": peer_id,
        "plan": {
            "receive": planned_receive,
            "send": {"focus_tasks": min(outgoing_focus, MAX_CHANGES_PER_EXCHANGE)},
            "more_server_changes": outgoing_focus > MAX_CHANGES_PER_EXCHANGE,
            "server_cursor": server_cursor,
            "latest_server_seq": latest_seq,
            "batch_limit": MAX_CHANGES_PER_EXCHANGE,
        },
    }


def _validate_task(raw: dict[str, Any]) -> dict[str, Any]:
    uid = str(raw.get("sync_uid") or "").strip()
    origin = str(raw.get("sync_origin_device_id") or "").strip()
    try:
        uuid.UUID(uid)
        uuid.UUID(origin)
    except (ValueError, TypeError):
        raise ValueError("Task recebida sem identidade de sync válida.")
    title = str(raw.get("title") or "").strip()
    if not title or len(title) > 500:
        raise ValueError("Título de task inválido no pacote de sync.")
    version = int(raw.get("sync_version") or 0)
    if version < 1:
        raise ValueError("Versão de task inválida no pacote de sync.")
    category = str(raw.get("category") or "other")
    priority = str(raw.get("priority") or "medium")
    item_type = str(raw.get("item_type") or "TASK")
    place_context = str(raw.get("place_context") or "anywhere")
    return {
        "sync_uid": uid,
        "title": title,
        "category": category if category in VALID_CATEGORIES else "other",
        "priority": priority if priority in VALID_PRIORITIES else "medium",
        "completed": 1 if bool(raw.get("completed")) else 0,
        "is_focus": 1 if bool(raw.get("is_focus")) else 0,
        "created_at": str(raw.get("created_at") or utc_now()),
        "updated_at": str(raw.get("updated_at") or utc_now()),
        "due_date": str(raw["due_date"]) if raw.get("due_date") else None,
        "item_type": item_type if item_type in VALID_ITEM_TYPES else "TASK",
        "source": str(raw.get("source") or "manual")[:40],
        "confidence": max(0.0, min(1.0, float(raw.get("confidence", 1.0)))),
        "place_context": place_context if place_context in VALID_PLACE_CONTEXTS else "anywhere",
        "trigger_on_arrival": 1 if bool(raw.get("trigger_on_arrival")) and place_context != "anywhere" else 0,
        "sync_version": version,
        "sync_origin_device_id": origin,
        "sync_modified_at": str(raw.get("sync_modified_at") or raw.get("updated_at") or utc_now()),
        "deleted_at": str(raw["deleted_at"]) if raw.get("deleted_at") else None,
    }


def _clock(record: dict[str, Any]) -> tuple[int, str]:
    return int(record.get("sync_version") or 0), str(record.get("sync_origin_device_id") or "")


def _task_payload(row) -> dict[str, Any]:
    record = dict(row)
    return {
        "sync_uid": record["sync_uid"],
        "title": record["title"],
        "category": record.get("category") or "other",
        "priority": record.get("priority") or "medium",
        "completed": bool(record.get("completed")),
        "is_focus": bool(record.get("is_focus")),
        "created_at": record["created_at"],
        "updated_at": record["updated_at"],
        "due_date": record.get("due_date"),
        "item_type": record.get("item_type") or "TASK",
        "source": record.get("source") or "manual",
        "confidence": float(record.get("confidence") or 0),
        "place_context": record.get("place_context") or "anywhere",
        "trigger_on_arrival": bool(record.get("trigger_on_arrival")),
        "sync_version": int(record.get("sync_version") or 0),
        "sync_origin_device_id": record.get("sync_origin_device_id"),
        "sync_modified_at": record.get("sync_modified_at"),
        "deleted_at": record.get("deleted_at"),
    }


def mark_local_focus_change(conn, task_id: int) -> None:
    """Incrementa o relógio Lamport e registra a imagem atual da task."""
    device = get_local_device(conn)
    row = conn.execute(
        "SELECT sync_uid,sync_version FROM focus_tasks WHERE id=?", (task_id,)
    ).fetchone()
    if not row:
        return
    uid = str(row["sync_uid"] or uuid.uuid4())
    version = int(row["sync_version"] or 0) + 1
    now = utc_now()
    conn.execute(
        """UPDATE focus_tasks SET sync_uid=?,sync_version=?,sync_origin_device_id=?,
                   sync_modified_at=?,updated_at=? WHERE id=?""",
        (uid, version, device["device_id"], now, now, task_id),
    )
    conn.execute(
        """INSERT INTO local_sync_changes
           (change_id,entity_type,entity_uid,entity_version,origin_device_id,changed_at)
           VALUES (?,'focus_task',?,?,?,?)""",
        (str(uuid.uuid4()), uid, version, device["device_id"], now),
    )


def _apply_remote_change(conn, change: dict[str, Any]) -> tuple[bool, bool]:
    change_id = str(change.get("change_id") or "").strip()
    try:
        uuid.UUID(change_id)
    except (ValueError, TypeError):
        raise ValueError("Pacote contém change_id inválido.")
    if conn.execute("SELECT 1 FROM local_sync_changes WHERE change_id=?", (change_id,)).fetchone():
        return False, False
    incoming = _validate_task(change.get("task") or {})
    current_row = conn.execute(
        "SELECT * FROM focus_tasks WHERE sync_uid=?", (incoming["sync_uid"],)
    ).fetchone()
    current = dict(current_row) if current_row else None
    wins = current is None or _clock(incoming) > _clock(current)

    if wins:
        fields = (
            incoming["title"], incoming["category"], incoming["priority"],
            incoming["completed"], incoming["is_focus"], incoming["created_at"],
            incoming["updated_at"], incoming["due_date"], incoming["item_type"],
            incoming["source"], incoming["confidence"], incoming["place_context"],
            incoming["trigger_on_arrival"], incoming["sync_version"],
            incoming["sync_origin_device_id"], incoming["sync_modified_at"],
            incoming["deleted_at"], incoming["sync_uid"],
        )
        if current is None:
            conn.execute(
                """INSERT INTO focus_tasks
                   (title,category,priority,completed,is_focus,created_at,updated_at,due_date,
                    item_type,source,confidence,place_context,trigger_on_arrival,
                    sync_version,sync_origin_device_id,sync_modified_at,deleted_at,sync_uid)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                fields,
            )
        else:
            conn.execute(
                """UPDATE focus_tasks SET
                   title=?,category=?,priority=?,completed=?,is_focus=?,created_at=?,updated_at=?,
                   due_date=?,item_type=?,source=?,confidence=?,place_context=?,trigger_on_arrival=?,
                   sync_version=?,sync_origin_device_id=?,sync_modified_at=?,deleted_at=?
                   WHERE sync_uid=?""",
                fields,
            )
        if incoming["is_focus"] and not incoming["deleted_at"]:
            conn.execute(
                "UPDATE focus_tasks SET is_focus=0 WHERE sync_uid<>? AND deleted_at IS NULL",
                (incoming["sync_uid"],),
            )

    conn.execute(
        """INSERT INTO local_sync_changes
           (change_id,entity_type,entity_uid,entity_version,origin_device_id,changed_at)
           VALUES (?,'focus_task',?,?,?,?)""",
        (
            change_id, incoming["sync_uid"], incoming["sync_version"],
            incoming["sync_origin_device_id"], incoming["sync_modified_at"],
        ),
    )
    return True, wins


def _changes_since(conn, cursor: int) -> tuple[list[dict[str, Any]], int]:
    cursor = max(0, int(cursor))
    rows = conn.execute(
        """SELECT c.seq,c.change_id,c.entity_uid
           FROM local_sync_changes c
           JOIN (
             SELECT entity_uid,MAX(seq) AS max_seq
             FROM local_sync_changes
             WHERE seq>? AND entity_type='focus_task'
             GROUP BY entity_uid
           ) latest ON latest.max_seq=c.seq
           ORDER BY c.seq ASC LIMIT ?""",
        (cursor, MAX_CHANGES_PER_EXCHANGE),
    ).fetchall()
    changes: list[dict[str, Any]] = []
    for row in rows:
        task = conn.execute(
            "SELECT * FROM focus_tasks WHERE sync_uid=?", (row["entity_uid"],)
        ).fetchone()
        if task:
            changes.append({
                "server_seq": int(row["seq"]),
                "change_id": str(row["change_id"]),
                "task": _task_payload(task),
            })
    # Nunca avance além do último registro realmente transferido. Isso evita
    # perder deltas quando existirem mais itens que o limite de um lote.
    next_cursor = max([cursor, *[int(row["seq"]) for row in rows]])
    return changes, next_cursor


def exchange_focus(peer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    protocol_version = int(payload.get("protocol_version") or 0)
    if protocol_version != PROTOCOL_VERSION:
        raise ValueError(
            f"Versão incompatível do Local Sync. Mac: v{PROTOCOL_VERSION}; iPhone: v{protocol_version}."
        )
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("Schema de Focus incompatível no Local Sync.")
    sync_run_id = str(payload.get("sync_run_id") or "").strip() or str(uuid.uuid4())
    try:
        uuid.UUID(sync_run_id)
    except ValueError:
        raise ValueError("Identidade da execução de sync inválida.")
    incoming = payload.get("changes") or []
    if not isinstance(incoming, list) or len(incoming) > MAX_CHANGES_PER_EXCHANGE:
        raise ValueError("Quantidade de mudanças inválida para a V0.")
    server_cursor = max(0, int(payload.get("server_cursor") or 0))
    apply_started = time.perf_counter()
    applied = 0
    won = 0
    ack_client_seq = max(0, int(payload.get("acknowledged_client_seq") or 0))
    exchange_id = str(uuid.uuid4())

    with get_db_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for raw in incoming:
                if not isinstance(raw, dict):
                    raise ValueError("Mudança de sync inválida.")
                accepted, changed = _apply_remote_change(conn, raw)
                applied += int(accepted)
                won += int(changed)
                ack_client_seq = max(ack_client_seq, int(raw.get("client_seq") or 0))
            outgoing, next_server_cursor = _changes_since(conn, server_cursor)
            now = utc_now()
            bytes_received = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            response_preview = {
                "changes": outgoing,
                "server_cursor": next_server_cursor,
                "ack_client_seq": ack_client_seq,
            }
            bytes_sent = len(json.dumps(response_preview, ensure_ascii=False).encode("utf-8"))
            conn.execute(
                """UPDATE local_sync_trusted_peers SET last_seen_at=?,last_presence_at=?
                   WHERE peer_device_id=?""",
                (now, now, peer_id),
            )
            conn.execute(
                """INSERT INTO local_sync_exchanges
                   (exchange_id,peer_device_id,status,server_cursor,ack_client_seq,
                    sent_count,received_count,bytes_sent,bytes_received,duration_ms,created_at,sync_run_id)
                   VALUES (?,?,'awaiting_ack',?,?,?,?,?,?,?,?,?)""",
                (
                    exchange_id, peer_id, next_server_cursor, ack_client_seq,
                    len(outgoing), len(incoming), bytes_sent, bytes_received,
                    round((time.perf_counter() - started) * 1000, 2), now, sync_run_id,
                ),
            )
            conn.execute(
                """DELETE FROM local_sync_exchanges WHERE peer_device_id=? AND exchange_id NOT IN (
                     SELECT exchange_id FROM local_sync_exchanges WHERE peer_device_id=?
                     ORDER BY created_at DESC LIMIT 20
                   )""",
                (peer_id, peer_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    apply_ms = round((time.perf_counter() - apply_started) * 1000, 2)
    total_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
        "exchange_id": exchange_id,
        "server_device": get_local_device(),
        "changes": outgoing,
        "server_cursor": next_server_cursor,
        "ack_client_seq": ack_client_seq,
        "received": len(incoming),
        "applied": applied,
        "changed": won,
        "metrics": {
            "manifest_ms": round(max(0.0, total_ms - apply_ms), 2),
            "apply_ms": apply_ms,
            "total_ms": total_ms,
        },
    }


def acknowledge_exchange(peer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if int(payload.get("protocol_version") or 0) != PROTOCOL_VERSION:
        raise ValueError("Versão incompatível no ACK do Local Sync.")
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("Schema incompatível no ACK do Local Sync.")
    exchange_id = str(payload.get("exchange_id") or "").strip()
    try:
        uuid.UUID(exchange_id)
    except (TypeError, ValueError):
        raise ValueError("ACK sem identidade válida.")
    now = utc_now()
    with get_db_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM local_sync_exchanges WHERE exchange_id=? AND peer_device_id=?",
            (exchange_id, peer_id),
        ).fetchone()
        if not row:
            conn.rollback()
            raise ValueError("Troca não encontrada para este dispositivo.")
        exchange = dict(row)
        if exchange["status"] == "acknowledged":
            conn.commit()
            return {"acknowledged": True, "duplicate": True, "acknowledged_at": exchange["acknowledged_at"]}
        cursor_value = payload.get("server_cursor")
        applied_cursor = int(cursor_value) if cursor_value is not None else -1
        if applied_cursor != int(exchange["server_cursor"]):
            conn.rollback()
            raise ValueError("Cursor do ACK não corresponde ao pacote aplicado.")
        conn.execute(
            "UPDATE local_sync_exchanges SET status='acknowledged',acknowledged_at=? WHERE exchange_id=?",
            (now, exchange_id),
        )
        exchange_kind = str(exchange.get("exchange_kind") or "focus")
        if exchange_kind == "mobile_upload":
            conn.execute(
                """UPDATE local_sync_peer_state
                   SET last_upload_ack_seq=MAX(last_upload_ack_seq,?),last_error=NULL
                   WHERE peer_device_id=?""",
                (exchange["ack_client_seq"], peer_id),
            )
        else:
            aggregate = None
            if exchange.get("sync_run_id"):
                aggregate = conn.execute(
                    """SELECT COALESCE(SUM(sent_count),0) AS sent_count,
                              COALESCE(SUM(received_count),0) AS received_count,
                              COALESCE(SUM(bytes_sent),0) AS bytes_sent,
                              COALESCE(SUM(bytes_received),0) AS bytes_received,
                              COALESCE(SUM(duration_ms),0) AS duration_ms
                       FROM local_sync_exchanges
                       WHERE peer_device_id=? AND sync_run_id=? AND status='acknowledged'""",
                    (peer_id, exchange["sync_run_id"]),
                ).fetchone()
            totals = dict(aggregate) if aggregate else exchange
            conn.execute(
                """INSERT INTO local_sync_peer_state
               (peer_device_id,last_remote_seq,last_acknowledged_seq,last_sync_at,last_error,
                last_sent_count,last_received_count,total_sent_count,total_received_count,
                last_duration_ms,last_bytes_sent,last_bytes_received)
               VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?)
               ON CONFLICT(peer_device_id) DO UPDATE SET
                 last_remote_seq=MAX(local_sync_peer_state.last_remote_seq,excluded.last_remote_seq),
                 last_acknowledged_seq=MAX(local_sync_peer_state.last_acknowledged_seq,excluded.last_acknowledged_seq),
                 last_sync_at=excluded.last_sync_at,last_sent_count=excluded.last_sent_count,
                 last_received_count=excluded.last_received_count,
                 total_sent_count=local_sync_peer_state.total_sent_count+excluded.last_sent_count,
                 total_received_count=local_sync_peer_state.total_received_count+excluded.last_received_count,
                 last_duration_ms=excluded.last_duration_ms,last_bytes_sent=excluded.last_bytes_sent,
                 last_bytes_received=excluded.last_bytes_received,last_error=NULL""",
                (
                    peer_id, exchange["server_cursor"], exchange["ack_client_seq"], now,
                    totals["sent_count"], totals["received_count"],
                    totals["sent_count"], totals["received_count"], totals["duration_ms"],
                    totals["bytes_sent"], totals["bytes_received"],
                ),
            )
            conn.execute(
                """INSERT INTO local_sync_history
                   (peer_device_id,status,sent_count,received_count,bytes_sent,bytes_received,duration_ms,created_at)
                   VALUES (?,'synced',?,?,?,?,?,?)""",
                (
                    peer_id, totals["sent_count"], totals["received_count"], totals["bytes_sent"],
                    totals["bytes_received"], totals["duration_ms"], now,
                ),
            )
        conn.execute(
            """DELETE FROM local_sync_history WHERE id IN (
                 SELECT id FROM local_sync_history WHERE peer_device_id=?
                 ORDER BY id DESC LIMIT -1 OFFSET 20
               )""",
            (peer_id,),
        )
        conn.execute(
            """DELETE FROM local_sync_exchanges WHERE peer_device_id=? AND status='acknowledged'
               AND exchange_id NOT IN (
                 SELECT exchange_id FROM local_sync_exchanges WHERE peer_device_id=?
                 ORDER BY created_at DESC LIMIT 20
               )""",
            (peer_id, peer_id),
        )
        conn.commit()
    return {"acknowledged": True, "duplicate": False, "acknowledged_at": now}


def _validate_upload_change(raw: dict[str, Any]) -> dict[str, Any]:
    change_id = str(raw.get("change_id") or "").strip()
    entity_uid = str(raw.get("entity_uid") or "").strip()
    try:
        uuid.UUID(change_id)
        uuid.UUID(entity_uid)
    except (TypeError, ValueError):
        raise ValueError("Mudança mobile sem identidade estável válida.")
    entity_type = str(raw.get("entity_type") or "")
    if entity_type not in UPLOAD_ENTITY_TYPES:
        raise ValueError("Tipo de entidade não autorizado no upload mobile.")
    operation = str(raw.get("operation") or "upsert")
    if operation not in {"upsert", "delete"}:
        raise ValueError("Operação inválida no upload mobile.")
    version = int(raw.get("entity_version") or 0)
    client_seq = int(raw.get("client_seq") or 0)
    if version < 1 or client_seq < 1:
        raise ValueError("Versão lógica inválida no upload mobile.")
    record = raw.get("record") or {}
    if operation == "upsert" and not isinstance(record, dict):
        raise ValueError("Registro ausente no upload mobile.")
    return {
        "change_id": change_id, "entity_uid": entity_uid,
        "entity_type": entity_type, "operation": operation,
        "entity_version": version, "client_seq": client_seq,
        "changed_at": str(raw.get("changed_at") or utc_now())[:40],
        "record": record,
    }


def _clean_upload_record(change: dict[str, Any]) -> dict[str, Any]:
    record = change["record"]
    entity_type = change["entity_type"]
    if change["operation"] == "delete":
        return {}
    if entity_type == "chat_folder":
        name = str(record.get("name") or "").strip()[:48]
        if not name:
            raise ValueError("Pasta mobile sem nome.")
        color = str(record.get("color") or "#8b5cf6").lower()
        if not re.fullmatch(r"#[0-9a-f]{6}", color):
            color = "#8b5cf6"
        return {
            "name": name, "icon": str(record.get("icon") or "folder")[:40], "color": color,
            "created_at": str(record.get("created_at") or change["changed_at"])[:40],
            "updated_at": str(record.get("updated_at") or change["changed_at"])[:40],
        }
    if entity_type == "chat_session":
        channel = str(record.get("channel") or "chat")
        folder_id = str(record.get("folder_id") or "").strip() or None
        if folder_id:
            try:
                uuid.UUID(folder_id)
            except ValueError:
                raise ValueError("Conversa mobile referencia pasta inválida.")
        return {
            "title": (str(record.get("title") or "Nova conversa").strip() or "Nova conversa")[:500],
            "folder_id": folder_id,
            "channel": channel if channel in VALID_CHAT_CHANNELS else "chat",
            "created_at": str(record.get("created_at") or change["changed_at"])[:40],
            "deleted_at": str(record["deleted_at"])[:40] if record.get("deleted_at") else None,
        }
    if entity_type == "chat_message":
        session_id = str(record.get("session_id") or "").strip()
        try:
            uuid.UUID(session_id)
        except ValueError:
            raise ValueError("Mensagem mobile sem conversa válida.")
        sender = str(record.get("sender") or "")
        if sender not in {"user", "ia"}:
            raise ValueError("Remetente inválido na mensagem mobile.")
        text = str(record.get("text") or "")
        if not text or len(text) > 200_000:
            raise ValueError("Conteúdo de mensagem inválido no upload mobile.")
        return {
            "session_id": session_id, "sender": sender, "text": text,
            "created_at": str(record.get("created_at") or change["changed_at"])[:40],
        }
    content = str(record.get("content") or "").strip()
    if not content or len(content) > 20_000:
        raise ValueError("Conteúdo de memória inválido no upload mobile.")
    session_id = str(record.get("session_id") or "").strip() or None
    if session_id:
        try:
            uuid.UUID(session_id)
        except ValueError:
            raise ValueError("Memória mobile referencia conversa inválida.")
    scope = str(record.get("scope") or ("conversation" if session_id else "global"))
    memory_type = str(record.get("memory_type") or ("long" if record.get("is_core") else "medium"))
    tags = record.get("tags") if isinstance(record.get("tags"), list) else []
    return {
        "content": content,
        "importance": max(0.0, min(1.0, float(record.get("importance") or 0.5))),
        "is_core": bool(record.get("is_core")),
        "locked": bool(record.get("locked") or record.get("is_core")),
        "user_confirmed": bool(record.get("user_confirmed") or record.get("is_core")),
        "memory_type": memory_type if memory_type in VALID_MEMORY_TYPES else "medium",
        "scope": scope if scope in VALID_MEMORY_SCOPES else "global",
        "session_id": session_id,
        "tags": [str(tag)[:80] for tag in tags[:30]],
        "expires_at": str(record["expires_at"])[:40] if record.get("expires_at") else None,
        "created_at": str(record.get("created_at") or change["changed_at"])[:40],
        "origin_type": str(record.get("origin_type") or "mobile_sync")[:40],
    }


def _owned_row(conn, table: str, key_column: str, key: str, peer_id: str):
    return conn.execute(
        f"SELECT * FROM {table} WHERE {key_column}=? AND sync_origin_device_id=?",
        (key, peer_id),
    ).fetchone()


def _apply_mobile_upload_change(conn, peer_id: str, change: dict[str, Any]) -> tuple[bool, bool]:
    if conn.execute(
        "SELECT 1 FROM local_sync_ingested_changes WHERE change_id=?", (change["change_id"],)
    ).fetchone():
        return False, False
    state = conn.execute(
        """SELECT entity_version FROM local_sync_ingested_entities
           WHERE peer_device_id=? AND entity_type=? AND entity_uid=?""",
        (peer_id, change["entity_type"], change["entity_uid"]),
    ).fetchone()
    stale = state and int(state["entity_version"]) >= change["entity_version"]
    applied = False
    conflict = False
    record = _clean_upload_record(change)
    uid = change["entity_uid"]
    kind = change["entity_type"]
    deleting = change["operation"] == "delete"

    if not stale:
        if kind == "chat_folder":
            current = conn.execute("SELECT * FROM chat_folders WHERE id=?", (uid,)).fetchone()
            if current and current["sync_origin_device_id"] != peer_id:
                conflict = True
            elif deleting:
                conn.execute("UPDATE sessions SET folder_id=NULL WHERE folder_id=?", (uid,))
                conn.execute("DELETE FROM chat_folders WHERE id=?", (uid,))
                applied = True
            else:
                desired_name = record["name"]
                collision = conn.execute(
                    "SELECT id FROM chat_folders WHERE name=? COLLATE NOCASE AND id<>?", (desired_name, uid)
                ).fetchone()
                if collision:
                    desired_name = f"{desired_name[:31]} · iPhone {uid[:4]}"
                conn.execute(
                    """INSERT INTO chat_folders
                       (id,name,icon,color,created_at,updated_at,sync_origin_device_id)
                       VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                       name=excluded.name,icon=excluded.icon,color=excluded.color,
                       updated_at=excluded.updated_at""",
                    (uid, desired_name, record["icon"], record["color"], record["created_at"], record["updated_at"], peer_id),
                )
                applied = True
        elif kind == "chat_session":
            current = conn.execute("SELECT * FROM sessions WHERE id=?", (uid,)).fetchone()
            if current and current["sync_origin_device_id"] != peer_id:
                conflict = True
            elif deleting:
                if current:
                    conn.execute(
                        "UPDATE sessions SET deleted_at=COALESCE(deleted_at,?),folder_id=NULL WHERE id=?",
                        (change["changed_at"], uid),
                    )
                applied = True
            else:
                folder_id = record["folder_id"]
                if folder_id and not _owned_row(conn, "chat_folders", "id", folder_id, peer_id):
                    folder_id = None
                conn.execute(
                    """INSERT INTO sessions
                       (id,title,created_at,deleted_at,folder_id,channel,sync_origin_device_id)
                       VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                       title=excluded.title,deleted_at=excluded.deleted_at,
                       folder_id=excluded.folder_id,channel=excluded.channel""",
                    (uid, record["title"], record["created_at"], record["deleted_at"], folder_id, record["channel"], peer_id),
                )
                applied = True
        elif kind == "chat_message":
            current = conn.execute("SELECT * FROM messages WHERE sync_uid=?", (uid,)).fetchone()
            if deleting:
                if current and current["sync_origin_device_id"] == peer_id:
                    conn.execute("DELETE FROM messages WHERE sync_uid=?", (uid,))
                applied = True
            elif current:
                conflict = current["sync_origin_device_id"] != peer_id
                applied = not conflict
            else:
                parent = _owned_row(conn, "sessions", "id", record["session_id"], peer_id)
                if not parent:
                    raise ValueError("Mensagem mobile chegou sem sua conversa de origem.")
                conn.execute(
                    """INSERT INTO messages
                       (session_id,sender,text,audio_url,created_at,sync_uid,sync_origin_device_id)
                       VALUES (?,?,?,NULL,?,?,?)""",
                    (record["session_id"], record["sender"], record["text"], record["created_at"], uid, peer_id),
                )
                applied = True
        else:
            current = conn.execute("SELECT * FROM memories WHERE sync_uid=?", (uid,)).fetchone()
            if deleting:
                if current and current["sync_origin_device_id"] == peer_id:
                    if current["is_core"] or current["locked"]:
                        conflict = True
                    else:
                        conn.execute("DELETE FROM memories WHERE sync_uid=?", (uid,))
                        applied = True
                else:
                    applied = current is None
            else:
                if current and current["sync_origin_device_id"] != peer_id:
                    conflict = True
                else:
                    if record["scope"] == "conversation":
                        parent = _owned_row(conn, "sessions", "id", record["session_id"], peer_id) if record["session_id"] else None
                        if not parent:
                            raise ValueError("Memória de conversa chegou sem o chat correspondente.")
                    preserve_core = bool(current and (current["is_core"] or current["locked"]))
                    is_core = int(record["is_core"] or preserve_core)
                    locked = int(record["locked"] or preserve_core)
                    importance = max(record["importance"], 0.95 if preserve_core else 0.0)
                    if current:
                        conn.execute(
                            """UPDATE memories SET session_id=?,scope=?,content=?,memory_type=?,importance=?,
                               expires_at=?,tags=?,is_core=?,locked=?,user_confirmed=?,origin_type=?
                               WHERE sync_uid=? AND sync_origin_device_id=?""",
                            (record["session_id"], record["scope"], record["content"], record["memory_type"], importance,
                             record["expires_at"], json.dumps(record["tags"], ensure_ascii=False), is_core, locked,
                             int(record["user_confirmed"] or preserve_core), record["origin_type"], uid, peer_id),
                        )
                    else:
                        conn.execute(
                            """INSERT INTO memories
                               (session_id,scope,content,memory_type,importance,expires_at,tags,created_at,
                                is_core,locked,user_confirmed,origin_type,sync_uid,sync_origin_device_id)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (record["session_id"], record["scope"], record["content"], record["memory_type"], importance,
                             record["expires_at"], json.dumps(record["tags"], ensure_ascii=False), record["created_at"],
                             is_core, locked, int(record["user_confirmed"]), record["origin_type"], uid, peer_id),
                        )
                    applied = True

        conn.execute(
            """INSERT INTO local_sync_ingested_entities
               (peer_device_id,entity_type,entity_uid,entity_version,deleted_at,updated_at)
               VALUES (?,?,?,?,?,?) ON CONFLICT(peer_device_id,entity_type,entity_uid) DO UPDATE SET
               entity_version=excluded.entity_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at""",
            (peer_id, kind, uid, change["entity_version"], change["changed_at"] if deleting else None, change["changed_at"]),
        )
    conn.execute(
        """INSERT INTO local_sync_ingested_changes
           (change_id,peer_device_id,entity_type,entity_uid,entity_version,operation,applied_at)
           VALUES (?,?,?,?,?,?,?)""",
        (change["change_id"], peer_id, kind, uid, change["entity_version"], change["operation"], utc_now()),
    )
    return applied, conflict


def ingest_mobile_upload(peer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    if int(payload.get("protocol_version") or 0) != PROTOCOL_VERSION:
        raise ValueError("Versão incompatível no upload mobile.")
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("Schema incompatível no upload mobile.")
    sync_run_id = str(payload.get("sync_run_id") or "").strip() or str(uuid.uuid4())
    try:
        uuid.UUID(sync_run_id)
    except ValueError:
        raise ValueError("Identidade da execução de sync inválida.")
    incoming = payload.get("changes") or []
    if not isinstance(incoming, list) or len(incoming) > MAX_CHANGES_PER_EXCHANGE:
        raise ValueError("Quantidade inválida de entidades no upload mobile.")
    changes = [_validate_upload_change(item) for item in incoming if isinstance(item, dict)]
    if len(changes) != len(incoming):
        raise ValueError("Mudança malformada no upload mobile.")
    if changes != sorted(changes, key=lambda item: item["client_seq"]):
        raise ValueError("Mudanças mobile fora de ordem.")
    applied = conflicts = 0
    ack_client_seq = max(0, int(payload.get("acknowledged_client_seq") or 0))
    counts: dict[str, int] = {}
    exchange_id = str(uuid.uuid4())
    bytes_received = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    with get_db_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            # A ordem do outbox representa quando cada alteração ocorreu, não
            # a dependência relacional. Ex.: a primeira mensagem pode ser
            # persistida antes da atualização automática do título do chat.
            # Aplicamos upserts por dependência e tombstones no fim, mantendo
            # o cursor/ACK baseado na sequência original.
            upsert_order = {
                "chat_folder": 0, "chat_session": 1,
                "chat_message": 2, "memory": 3,
            }
            delete_order = {
                "memory": 0, "chat_message": 1,
                "chat_session": 2, "chat_folder": 3,
            }
            apply_changes = sorted(
                changes,
                key=lambda item: (
                    1 if item["operation"] == "delete" else 0,
                    (delete_order if item["operation"] == "delete" else upsert_order)[item["entity_type"]],
                    item["client_seq"],
                ),
            )
            for change in apply_changes:
                changed, conflict = _apply_mobile_upload_change(conn, peer_id, change)
                applied += int(changed)
                conflicts += int(conflict)
                ack_client_seq = max(ack_client_seq, change["client_seq"])
                counts[change["entity_type"]] = counts.get(change["entity_type"], 0) + 1
            now = utc_now()
            conn.execute(
                """INSERT INTO local_sync_exchanges
                   (exchange_id,peer_device_id,status,server_cursor,ack_client_seq,sent_count,
                    received_count,bytes_sent,bytes_received,duration_ms,created_at,exchange_kind,entity_counts,sync_run_id)
                   VALUES (?,?,'awaiting_ack',0,?,0,?,0,?,?,?,'mobile_upload',?,?)""",
                (exchange_id, peer_id, ack_client_seq, len(changes), bytes_received,
                 round((time.perf_counter() - started) * 1000, 2), now, json.dumps(counts), sync_run_id),
            )
            conn.execute(
                "UPDATE local_sync_peer_state SET conflict_count=conflict_count+? WHERE peer_device_id=?",
                (conflicts, peer_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {
        "protocol": PROTOCOL_NAME, "protocol_version": PROTOCOL_VERSION, "schema_version": 1,
        "exchange_id": exchange_id, "ack_client_seq": ack_client_seq,
        "received": len(changes), "applied": applied, "conflicts": conflicts,
        "entity_counts": counts,
        "metrics": {"total_ms": round((time.perf_counter() - started) * 1000, 2)},
    }


def sync_status() -> dict[str, Any]:
    with get_db_connection() as conn:
        peers = [dict(row) for row in conn.execute(
            """SELECT p.peer_device_id,p.device_name,p.device_type,p.paired_at,p.last_seen_at,
                      p.revoked_at,s.last_sync_at,s.last_error,s.last_acknowledged_seq
                      ,s.last_remote_seq,p.protocol_version,p.app_version,p.capabilities,p.last_presence_at,
                      s.last_sent_count,s.last_received_count,s.total_sent_count,s.total_received_count,
                      s.last_duration_ms,s.last_bytes_sent,s.last_bytes_received,s.conflict_count,s.retry_count,
                      s.last_upload_ack_seq,p.remote_pending
               FROM local_sync_trusted_peers p
               LEFT JOIN local_sync_peer_state s ON s.peer_device_id=p.peer_device_id
               ORDER BY p.paired_at DESC"""
        ).fetchall()]
        for peer in peers:
            peer["trusted"] = peer["revoked_at"] is None
            peer["connected"] = bool(peer["trusted"] and _is_present(peer.get("last_presence_at")))
            peer["status"] = "connected" if peer["connected"] else ("disconnected" if peer["trusted"] else "revoked")
            try:
                peer["capabilities"] = json.loads(peer.get("capabilities") or "[]")
            except (TypeError, json.JSONDecodeError):
                peer["capabilities"] = []
            try:
                remote_pending = json.loads(peer.get("remote_pending") or "{}")
            except (TypeError, json.JSONDecodeError):
                remote_pending = {}
            peer["pending_out"] = int(conn.execute(
                """SELECT COUNT(DISTINCT entity_uid) FROM local_sync_changes
                   WHERE seq>? AND entity_type='focus_task'""",
                (int(peer.get("last_remote_seq") or 0),),
            ).fetchone()[0])
            peer["pending_in"] = sum(int(remote_pending.get(key) or 0) for key in (
                "chat_folders", "chat_sessions", "chat_messages", "memories"
            ))
            peer["pending_details"] = {
                "focus_tasks": peer["pending_out"],
                "chat_folders": int(remote_pending.get("chat_folders") or 0),
                "chat_sessions": int(remote_pending.get("chat_sessions") or 0),
                "chat_messages": int(remote_pending.get("chat_messages") or 0),
                "memories": int(remote_pending.get("memories") or 0),
            }
            peer["awaiting_ack"] = int(conn.execute(
                """SELECT COUNT(*) FROM local_sync_exchanges
                   WHERE peer_device_id=? AND status='awaiting_ack'""",
                (peer["peer_device_id"],),
            ).fetchone()[0])
            peer["conflicts"] = int(peer.get("conflict_count") or 0)
            peer.pop("conflict_count", None)
            peer.pop("revoked_at", None)
            peer.pop("last_acknowledged_seq", None)
            peer.pop("last_remote_seq", None)
            peer.pop("remote_pending", None)
        history = [dict(row) for row in conn.execute(
            "SELECT * FROM local_sync_history ORDER BY id DESC LIMIT 20"
        ).fetchall()]
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
        "device": get_local_device(),
        "peers": peers,
        "history": history,
    }


@local_sync_bp.get("/status")
def status_route():
    if not _local_request_only():
        return _json({"error": "Status disponível somente no Mac local."}, 403)
    return _json(sync_status())


@local_sync_bp.post("/pairing/start")
def pairing_start_route():
    if not _local_request_only():
        return _json({"error": "Pareamento só pode ser iniciado no Mac local."}, 403)
    return _json(start_pairing())


@local_sync_bp.post("/advertise")
def advertise_route():
    if not _local_request_only():
        return _json({"error": "Anúncio só pode ser iniciado no Mac local."}, 403)
    return _json({"advertised": start_advertisement(), "expires_in_seconds": ADVERTISEMENT_TTL_SECONDS})


@local_sync_bp.post("/pairing/complete")
def pairing_complete_route():
    body = request.get_json(silent=True) or {}
    try:
        result = pair_peer(body.get("device") or {}, str(body.get("code") or ""))
        return _json(result, 201)
    except PermissionError as exc:
        return _json({"error": str(exc)}, 403)
    except ValueError as exc:
        return _json({"error": str(exc)}, 409 if "incompatível" in str(exc) else 400)


@local_sync_bp.post("/focus/exchange")
def focus_exchange_route():
    peer_id = _authenticated_request_peer()
    if not peer_id:
        return _json({"error": "Dispositivo não pareado ou credencial inválida."}, 401)
    if request.content_length and request.content_length > MAX_SYNC_PAYLOAD_BYTES:
        return _json({"error": "Pacote de sincronização excede o limite de 2 MB."}, 413)
    try:
        return _json(exchange_focus(peer_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        return _json({"error": str(exc)}, 409 if "incompatível" in str(exc) else 400)
    except Exception as exc:
        return _json({"error": f"Falha transacional no Local Sync: {exc}"}, 500)


@local_sync_bp.post("/mobile/upload")
def mobile_upload_route():
    """Entrada unilateral: iPhone publica estado pessoal; Mac nunca exporta por esta rota."""
    peer_id = _authenticated_request_peer()
    if not peer_id:
        return _json({"error": "Dispositivo não pareado ou credencial inválida."}, 401)
    if not peer_can_upload_personal_domain(peer_id):
        return _json({"error": "Este dispositivo não anunciou permissão de upload para Chat e Memory."}, 403)
    if request.content_length and request.content_length > MAX_SYNC_PAYLOAD_BYTES:
        return _json({"error": "Pacote mobile excede o limite de 2 MB."}, 413)
    try:
        return _json(ingest_mobile_upload(peer_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        return _json({"error": str(exc)}, 409 if "incompatível" in str(exc) else 400)
    except Exception as exc:
        return _json({"error": f"Falha transacional no upload mobile: {exc}"}, 500)


@local_sync_bp.post("/manifest")
def manifest_route():
    peer_id = _authenticated_request_peer()
    if not peer_id:
        return _json({"error": "Dispositivo não pareado ou credencial inválida."}, 401)
    if request.content_length and request.content_length > MAX_SYNC_PAYLOAD_BYTES:
        return _json({"error": "Manifest excede o limite de 2 MB."}, 413)
    try:
        return _json(build_manifest(peer_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        incompatible = "incompatível" in str(exc)
        return _json({"error": str(exc)}, 409 if incompatible else 400)


@local_sync_bp.post("/ack")
def acknowledge_route():
    peer_id = _authenticated_request_peer()
    if not peer_id:
        return _json({"error": "Dispositivo não pareado ou credencial inválida."}, 401)
    try:
        return _json(acknowledge_exchange(peer_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        return _json({"error": str(exc)}, 409 if "incompatível" in str(exc) else 400)


@local_sync_bp.post("/presence")
def presence_route():
    peer_id = _authenticated_request_peer()
    if not peer_id:
        return _json({"error": "Dispositivo não pareado ou credencial inválida."}, 401)
    try:
        return _json(update_presence(peer_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        return _json({"error": str(exc)}, 409 if "incompatível" in str(exc) else 400)


@local_sync_bp.post("/peers/<peer_id>/request-sync")
def request_sync_route(peer_id: str):
    if not _local_request_only():
        return _json({"error": "A sincronização só pode ser solicitada no Mac local."}, 403)
    try:
        return _json(request_sync(peer_id), 202)
    except ConnectionError as exc:
        return _json({"error": str(exc)}, 409)
    except ValueError as exc:
        return _json({"error": str(exc)}, 400)


@local_sync_bp.delete("/peers/<peer_id>")
def revoke_peer_route(peer_id: str):
    if not _local_request_only():
        return _json({"error": "Revogação disponível somente no Mac local."}, 403)
    with get_db_connection() as conn:
        cursor = conn.execute(
            "UPDATE local_sync_trusted_peers SET revoked_at=? WHERE peer_device_id=?",
            (utc_now(), peer_id),
        )
        conn.commit()
    if not cursor.rowcount:
        return _json({"error": "Dispositivo não encontrado."}, 404)
    return _json({"success": True})
