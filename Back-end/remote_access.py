import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import time
from pathlib import Path
from typing import Optional

import requests
from flask import Request


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "sim", "on"}


REMOTE_MODE = env_bool("NEXUS_REMOTE_MODE", False)
HOST = os.getenv("NEXUS_HOST") or ("0.0.0.0" if REMOTE_MODE else "127.0.0.1")
PORT = int(os.getenv("NEXUS_PORT", "5050"))
FRONTEND_PORT = int(os.getenv("NEXUS_FRONTEND_PORT", "5174"))
AUTH_TOKEN = os.getenv("NEXUS_AUTH_TOKEN", "").strip()
SESSION_TTL_SECONDS = int(float(os.getenv("NEXUS_SESSION_TTL_HOURS", "24")) * 3600)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
TOKEN_FILE = Path(__file__).resolve().parent / ".nexus_remote_token"


def get_or_create_mobile_token() -> str:
    if AUTH_TOKEN:
        return AUTH_TOKEN
    try:
        if TOKEN_FILE.exists():
            token = TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
        token = secrets.token_hex(24)
        TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
        return token
    except Exception:
        return secrets.token_hex(24)


if REMOTE_MODE and not AUTH_TOKEN:
    AUTH_TOKEN = get_or_create_mobile_token()


def get_local_ip() -> str:
    """Detecta o IP LAN mais provável sem depender de internet externa."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"
    finally:
        sock.close()


def get_remote_config() -> dict:
    local_ip = get_local_ip()
    return {
        "remote_mode": REMOTE_MODE,
        "host": HOST,
        "port": PORT,
        "local_ip": local_ip,
        "local_url": f"http://{local_ip}:{PORT}",
        "frontend_dev_url": f"http://{local_ip}:{FRONTEND_PORT}",
        "auth_required": REMOTE_MODE,
        "auth_configured": bool(AUTH_TOKEN),
        "session_ttl_seconds": SESSION_TTL_SECONDS,
        "compatible_with": ["tailscale", "vpn", "local_network", "pwa"],
    }


def is_ollama_online(timeout: float = 1.2) -> bool:
    try:
        response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=timeout)
        return response.ok
    except Exception:
        return False


def _secret() -> bytes:
    material = AUTH_TOKEN or os.getenv("NEXUS_SECRET_KEY", "") or "nexus-local-dev"
    return hashlib.sha256(material.encode("utf-8")).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload: str) -> str:
    return _b64(hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).digest())


def create_session_token(label: str = "mobile") -> dict:
    now = int(time.time())
    payload = {
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
        "label": label[:80],
    }
    payload_b64 = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    token = f"{payload_b64}.{_sign(payload_b64)}"
    return {"access_token": token, "expires_at": payload["exp"], "token_type": "Bearer"}


def validate_bearer_token(token: str) -> bool:
    token = (token or "").strip()
    if not REMOTE_MODE:
        return True
    if not AUTH_TOKEN:
        return False
    if hmac.compare_digest(token, AUTH_TOKEN):
        return True
    if "." not in token:
        return False

    payload_b64, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(payload_b64)):
        return False
    try:
        payload = json.loads(_unb64(payload_b64).decode("utf-8"))
    except Exception:
        return False
    return int(payload.get("exp", 0)) >= int(time.time())


def request_token(req: Request) -> Optional[str]:
    auth = req.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return req.headers.get("X-Nexus-Token") or req.args.get("token")
