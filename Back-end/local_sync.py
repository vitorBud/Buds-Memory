"""Buds Local Sync — reconciliação local e autenticada entre instalações.

O módulo é deliberadamente estreito: nenhuma outra tabela cognitiva é lida ou
transferida. O iPhone inicia uma troca manual e o Mac responde com deltas do
change log local.
"""

from __future__ import annotations

import atexit
import hashlib
import hmac
import json
import platform
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
    "focus_tasks", "presence", "manual_sync_request", "sync_history",
]
IPHONE_CAPABILITIES = [
    "focus_tasks", "presence", "manual_sync_request",
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
    now = utc_now()
    with get_db_connection() as conn:
        conn.execute(
            """UPDATE local_sync_trusted_peers
               SET last_seen_at=?,last_presence_at=?,protocol_version=?,app_version=?,capabilities=?
               WHERE peer_device_id=? AND revoked_at IS NULL""",
            (
                now, now, protocol_version, str(payload.get("app_version") or APP_VERSION)[:30],
                json.dumps(capabilities), peer_id,
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
        conn.commit()
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "capabilities": MAC_CAPABILITIES,
        "server_device": get_local_device(),
        "sync_requested": bool(request_row),
        "request_id": request_row["request_id"] if request_row else None,
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
    server_cursor = max(0, int(payload.get("server_cursor") or 0))
    incoming_counts = payload.get("pending") or {}
    if not isinstance(incoming_counts, dict):
        raise ValueError("Manifest de pendências inválido.")
    incoming_focus = max(0, min(MAX_CHANGES_PER_EXCHANGE, int(incoming_counts.get("focus_tasks") or 0)))
    with get_db_connection() as conn:
        outgoing_focus = int(conn.execute(
            """SELECT COUNT(DISTINCT entity_uid) FROM local_sync_changes
               WHERE seq>? AND entity_type='focus_task'""",
            (server_cursor,),
        ).fetchone()[0])
        latest_seq = int(conn.execute(
            "SELECT COALESCE(MAX(seq),0) FROM local_sync_changes"
        ).fetchone()[0])
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "schema_version": 1,
        "capabilities": MAC_CAPABILITIES,
        "peer_device_id": peer_id,
        "plan": {
            "receive": {"focus_tasks": incoming_focus},
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
                    sent_count,received_count,bytes_sent,bytes_received,duration_ms,created_at)
                   VALUES (?,?,'awaiting_ack',?,?,?,?,?,?,?,?)""",
                (
                    exchange_id, peer_id, next_server_cursor, ack_client_seq,
                    len(outgoing), len(incoming), bytes_sent, bytes_received,
                    round((time.perf_counter() - started) * 1000, 2), now,
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
                exchange["sent_count"], exchange["received_count"],
                exchange["sent_count"], exchange["received_count"], exchange["duration_ms"],
                exchange["bytes_sent"], exchange["bytes_received"],
            ),
        )
        conn.execute(
            """INSERT INTO local_sync_history
               (peer_device_id,status,sent_count,received_count,bytes_sent,bytes_received,duration_ms,created_at)
               VALUES (?,'synced',?,?,?,?,?,?)""",
            (
                peer_id, exchange["sent_count"], exchange["received_count"], exchange["bytes_sent"],
                exchange["bytes_received"], exchange["duration_ms"], now,
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


def sync_status() -> dict[str, Any]:
    with get_db_connection() as conn:
        peers = [dict(row) for row in conn.execute(
            """SELECT p.peer_device_id,p.device_name,p.device_type,p.paired_at,p.last_seen_at,
                      p.revoked_at,s.last_sync_at,s.last_error,s.last_acknowledged_seq
                      ,s.last_remote_seq,p.protocol_version,p.app_version,p.capabilities,p.last_presence_at,
                      s.last_sent_count,s.last_received_count,s.total_sent_count,s.total_received_count,
                      s.last_duration_ms,s.last_bytes_sent,s.last_bytes_received,s.conflict_count,s.retry_count
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
            peer["pending_out"] = int(conn.execute(
                """SELECT COUNT(DISTINCT entity_uid) FROM local_sync_changes
                   WHERE seq>? AND entity_type='focus_task'""",
                (int(peer.get("last_remote_seq") or 0),),
            ).fetchone()[0])
            peer["pending_details"] = {"focus_tasks": peer["pending_out"]}
            peer["awaiting_ack"] = int(conn.execute(
                """SELECT COUNT(*) FROM local_sync_exchanges
                   WHERE peer_device_id=? AND status='awaiting_ack'""",
                (peer["peer_device_id"],),
            ).fetchone()[0])
            # O Mac não consulta o log privado do iPhone durante uma simples
            # leitura de status. O valor real é conhecido apenas no exchange.
            peer["pending_in"] = None
            peer["conflicts"] = int(peer.get("conflict_count") or 0)
            peer.pop("conflict_count", None)
            peer.pop("revoked_at", None)
            peer.pop("last_acknowledged_seq", None)
            peer.pop("last_remote_seq", None)
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
