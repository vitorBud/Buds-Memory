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
from urllib.parse import urlsplit, urlunsplit

import requests
from flask import Request
from llm.ollama_client import OLLAMA_BASE_URL, OLLAMA_TAGS_URL
from storage import get_data_dir


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "sim", "on"}


_CONFIGURED_HOST = (os.getenv("NEXUS_HOST") or "").strip()
_EXPLICIT_REMOTE_MODE = env_bool("NEXUS_REMOTE_MODE", False)
# Escutar fora do loopback sem autenticação é uma configuração insegura.
# Portanto, qualquer host amplo/LAN ativa automaticamente o modo remoto.
REMOTE_MODE = _EXPLICIT_REMOTE_MODE or (
    bool(_CONFIGURED_HOST)
    and _CONFIGURED_HOST.lower() not in {"127.0.0.1", "localhost", "::1"}
)
HOST = _CONFIGURED_HOST or ("0.0.0.0" if REMOTE_MODE else "127.0.0.1")
PORT = int(os.getenv("NEXUS_PORT", "5050"))
FRONTEND_PORT = int(os.getenv("NEXUS_FRONTEND_PORT", "5174"))
AUTH_TOKEN = os.getenv("NEXUS_AUTH_TOKEN", "").strip()
SESSION_TTL_SECONDS = int(float(os.getenv("NEXUS_SESSION_TTL_HOURS", "24")) * 3600)
# Compatibilidade: consumidores antigos esperam que remote_access.OLLAMA_URL
# represente a base, enquanto o cliente LLM usa o endpoint /api/generate.
OLLAMA_URL = OLLAMA_BASE_URL
TOKEN_FILE = get_data_dir() / ".nexus_remote_token"
PUBLIC_URL = os.getenv("NEXUS_PUBLIC_URL", "").strip().rstrip("/")
PUBLIC_FRONTEND_URL = os.getenv("NEXUS_PUBLIC_FRONTEND_URL", "").strip().rstrip("/")
EXTRA_ALLOWED_ORIGINS = tuple(
    origin.strip()
    for origin in os.getenv("NEXUS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
)


def get_or_create_mobile_token() -> str:
    if AUTH_TOKEN:
        return AUTH_TOKEN
    try:
        if TOKEN_FILE.exists():
            token = TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        token = secrets.token_hex(24)
        TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
        try:
            TOKEN_FILE.chmod(0o600)
        except OSError:
            pass
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


def _canonical_origin(value: str) -> Optional[str]:
    """Converte uma URL em origem comparável, sem caminho, query ou fragmento."""
    value = (value or "").strip()
    if not value:
        return None
    if value.lower() == "null":
        return "null"

    parsed = urlsplit(value)
    if parsed.scheme.lower() == "file":
        return "file://"
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), "", "", ""))


def trusted_origins() -> set[str]:
    """
    Origens autorizadas para chamar a API pelo navegador.

    Inclui o build servido pelo Flask, Vite local, o endereço LAN anunciado
    pelo app e URLs públicas explicitamente configuradas. O renderer Electron
    com origem opaca é tratado separadamente por ``is_trusted_origin``.
    """
    local_ip = get_local_ip()
    candidates = {
        f"http://localhost:{PORT}",
        f"http://127.0.0.1:{PORT}",
        f"http://[::1]:{PORT}",
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
        f"http://[::1]:{FRONTEND_PORT}",
        # Compatibilidade com o script desktop:dev legado e o Vite padrão.
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
        f"http://{local_ip}:{PORT}",
        f"http://{local_ip}:{FRONTEND_PORT}",
        PUBLIC_URL,
        PUBLIC_FRONTEND_URL,
        *EXTRA_ALLOWED_ORIGINS,
    }
    return {
        canonical
        for candidate in candidates
        if (canonical := _canonical_origin(candidate))
    }


def is_trusted_origin(
    origin: Optional[str],
    *,
    request_host: Optional[str] = None,
    request_scheme: str = "http",
    user_agent: str = "",
) -> bool:
    """
    Valida Origin sem depender do modo remoto.

    Requisições sem Origin continuam válidas para clientes não-browser, curl e
    verificações internas. Se a origem for a mesma do Host recebido, ela também
    é aceita para o build servido diretamente pelo Flask.
    """
    if not origin:
        return True
    canonical = _canonical_origin(origin)
    if not canonical:
        return False
    # file:// produz Origin "null" no Electron. Não aceitamos origens opacas
    # de navegadores comuns, porque páginas sandboxadas também usam "null".
    # User-Agent é suficiente aqui como barreira CORS: scripts web não podem
    # sobrescrever esse cabeçalho proibido. Em modo remoto o token continua
    # obrigatório, independentemente da origem.
    if canonical in {"null", "file://"}:
        return "Electron/" in user_agent
    if canonical in trusted_origins():
        return True
    if request_host:
        same_origin = _canonical_origin(f"{request_scheme}://{request_host}")
        if canonical == same_origin:
            # Em modo local, aceitar qualquer Host refletido permitiria DNS
            # rebinding contra o loopback. No remoto, o token é obrigatório e
            # hosts de VPN/túnel podem variar; por isso same-origin é aceito.
            return REMOTE_MODE
    return False


def get_remote_config() -> dict:
    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:{PORT}"
    frontend_dev_url = f"http://{local_ip}:{FRONTEND_PORT}"
    public_url = PUBLIC_URL
    public_frontend_url = PUBLIC_FRONTEND_URL or (
        PUBLIC_URL if PUBLIC_URL else ""
    )
    return {
        "remote_mode": REMOTE_MODE,
        "host": HOST,
        "port": PORT,
        "local_ip": local_ip,
        "local_url": local_url,
        "frontend_dev_url": frontend_dev_url,
        "public_url": public_url,
        "public_frontend_url": public_frontend_url,
        "recommended_url": public_frontend_url or frontend_dev_url,
        "recommended_api_url": public_url or local_url,
        "auth_required": REMOTE_MODE,
        "auth_configured": bool(AUTH_TOKEN),
        "session_ttl_seconds": SESSION_TTL_SECONDS,
        "compatible_with": ["tailscale", "cloudflare_tunnel", "ngrok", "vpn", "local_network", "pwa"],
    }


def is_ollama_online(timeout: float = 1.2) -> bool:
    try:
        response = requests.get(OLLAMA_TAGS_URL, timeout=timeout)
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


def decode_session_token(token: str) -> Optional[dict]:
    token = (token or "").strip()
    if "." not in token:
        return None

    payload_b64, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(payload_b64)):
        return None
    try:
        payload = json.loads(_unb64(payload_b64).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def create_session_token(
    label: str = "mobile",
    auth_mode: str = "remote",
    user_id: Optional[str] = None,
    email: Optional[str] = None,
) -> dict:
    now = int(time.time())
    payload = {
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
        "label": label[:80],
        "auth_mode": auth_mode,
    }
    if user_id:
        payload["user_id"] = user_id
    if email:
        payload["email"] = email[:160]
    payload_b64 = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    token = f"{payload_b64}.{_sign(payload_b64)}"
    return {
        "access_token": token,
        "expires_at": payload["exp"],
        "token_type": "Bearer",
        "auth_mode": auth_mode,
        "user_id": user_id,
        "email": email,
    }


def validate_bearer_token(token: str) -> bool:
    token = (token or "").strip()
    if not REMOTE_MODE:
        return True
    if not AUTH_TOKEN:
        return False
    if hmac.compare_digest(token, AUTH_TOKEN):
        return True
    return decode_session_token(token) is not None


def request_token(req: Request) -> Optional[str]:
    auth = req.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return req.headers.get("X-Nexus-Token") or req.args.get("token")


def request_session(req: Request) -> dict:
    token = request_token(req) or ""
    if REMOTE_MODE and AUTH_TOKEN and hmac.compare_digest(token, AUTH_TOKEN):
        return {"auth_mode": "remote", "label": "technical-token"}
    payload = decode_session_token(token)
    return payload or {"auth_mode": "local" if not REMOTE_MODE else "anonymous"}
