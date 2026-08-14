"""
llm/ollama_client.py — Cliente HTTP para Ollama com cache de modelos.

Responsabilidades:
  - Chamadas HTTP ao Ollama (streaming e síncrono)
  - Cache TTL de 60s para lista de modelos disponíveis (evita chamada por render)
  - Retry automático com backoff em falhas transitórias
  - Resolução de modelo com fallback seguro

Exporta:
  OLLAMA_MODEL, OLLAMA_URL, OLLAMA_OPTIONS, OLLAMA_KEEP_ALIVE
  get_ollama_models()
  resolve_ollama_model(model)
  post_ollama(payload, stream)
  llm_ollama(user_text, history, model, web_context, knowledge_context)
  llm_ollama_raw(prompt, model, num_predict)
  llm_ollama_stream(user_text, history, model, web_context, knowledge_context)
"""

from __future__ import annotations

import json
import contextlib
import os
import platform
import sys
import time
import threading
from pathlib import Path
from typing import Optional

import requests
from urllib.parse import urlsplit, urlunsplit

# Garante que Back-end/ está no sys.path (necessário quando importado standalone)
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from performance import (  # noqa: E402
    STANDARD_PATH,
    estimate_tokens,
    options_for_pipeline,
)


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ═══════════════════════════════════════════════════════════════════════════════

def resolve_ollama_urls(configured_url: Optional[str] = None) -> tuple[str, str, str]:
    """
    Normaliza OLLAMA_URL aceitando tanto a base quanto um endpoint da API.

    Exemplos compatíveis:
      - http://localhost:11434
      - http://localhost:11434/api/generate
      - http://localhost:11434/api/tags

    Retorna (base_url, generate_url, tags_url). Prefixos de caminho usados por
    proxies reversos também são preservados.
    """
    raw_url = (configured_url or os.getenv("OLLAMA_URL") or "http://localhost:11434").strip()
    parsed = urlsplit(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(
            "OLLAMA_URL deve ser uma URL HTTP(S) absoluta, por exemplo "
            "http://localhost:11434."
        )

    path = parsed.path.rstrip("/")
    for endpoint in ("/api/generate", "/api/tags"):
        if path.endswith(endpoint):
            path = path[:-len(endpoint)].rstrip("/")
            break

    base_url = urlunsplit((parsed.scheme, parsed.netloc, path, "", "")).rstrip("/")
    return (
        base_url,
        f"{base_url}/api/generate",
        f"{base_url}/api/tags",
    )


OLLAMA_BASE_URL, OLLAMA_URL, OLLAMA_TAGS_URL = resolve_ollama_urls()
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b")
IS_WINDOWS = platform.system().lower() == "windows"

OLLAMA_OPTIONS: dict = {
    "temperature":    0.42,
    "top_p":          0.88,
    "repeat_penalty": 1.18,
    "num_ctx":        int(os.getenv("OLLAMA_NUM_CTX", "8192")),
    "num_predict":    int(os.getenv("OLLAMA_NUM_PREDICT", "-1")),
}
if IS_WINDOWS and "OLLAMA_NUM_THREAD" not in os.environ:
    cpu_count = os.cpu_count() or 4
    OLLAMA_OPTIONS["num_thread"] = max(4, min(12, cpu_count - 4 if cpu_count >= 12 else cpu_count - 1))

OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "10m" if IS_WINDOWS else "5m")

# ── Cache de modelos disponíveis (TTL 60s) ────────────────────────────────────
_MODELS_CACHE: list[str] = []
_MODELS_CACHE_TS: float = 0.0
_MODELS_CACHE_TTL = 60.0  # segundos
_MODELS_LOCK = threading.Lock()

_DEFAULT_MODELS = [
    "qwen2.5-coder:3b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
]


# ═══════════════════════════════════════════════════════════════════════════════
# MODELOS
# ═══════════════════════════════════════════════════════════════════════════════

def get_ollama_models() -> list[str]:
    """
    Retorna lista de modelos instalados no Ollama.

    Usa cache de 60s para evitar chamada HTTP a cada render do front-end.
    Fallback para lista padrão se o Ollama estiver inacessível.
    """
    global _MODELS_CACHE, _MODELS_CACHE_TS

    now = time.monotonic()
    with _MODELS_LOCK:
        if _MODELS_CACHE and (now - _MODELS_CACHE_TS) < _MODELS_CACHE_TTL:
            return list(_MODELS_CACHE)

    try:
        response = requests.get(
            OLLAMA_TAGS_URL,
            timeout=2,
        )
        if response.status_code == 200:
            models = [
                item["name"]
                for item in response.json().get("models", [])
                if "name" in item
            ]
            if models:
                with _MODELS_LOCK:
                    _MODELS_CACHE = models
                    _MODELS_CACHE_TS = now
                return models
    except Exception:
        pass

    return _DEFAULT_MODELS


def resolve_ollama_model(model: Optional[str] = None) -> str:
    """Valida o modelo solicitado contra os instalados, com fallback seguro."""
    models = get_ollama_models()
    if model in models:
        return model
    if OLLAMA_MODEL in models:
        return OLLAMA_MODEL
    if models:
        return models[0]
    return OLLAMA_MODEL


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP CLIENT
# ═══════════════════════════════════════════════════════════════════════════════

def post_ollama(payload: dict, *, stream: bool) -> requests.Response:
    """
    Chama o Ollama com até 3 tentativas para recuperar falhas transitórias.

    Backoff exponencial leve: 0.45s, 0.90s entre tentativas.
    """
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            return requests.post(
                OLLAMA_URL,
                json=payload,
                stream=stream,
                timeout=(8, 180),
            )
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.45 * (attempt + 1))
    raise RuntimeError(
        f"Ollama indisponível após 3 tentativas: {last_error}"
    ) from last_error


# ═══════════════════════════════════════════════════════════════════════════════
# FUNÇÕES DE CHAMADA
# ═══════════════════════════════════════════════════════════════════════════════

def llm_ollama(
    user_text: str,
    history=None,
    model: Optional[str] = None,
    web_context: Optional[str] = None,
    knowledge_context: Optional[str] = None,
    *,
    pipeline: str = STANDARD_PATH,
    trace=None,
) -> str:
    """Chamada síncrona ao Ollama. Retorna texto completo."""
    from llm.prompt_builder import build_prompt, infer_response_profile

    selected_model = resolve_ollama_model(model)
    with trace.span("prompt_build") if trace else _nullcontext():
        prompt = build_prompt(
            user_text,
            history,
            web_context,
            knowledge_context,
            pipeline=pipeline,
            selected_model=selected_model,
        )
    response_profile = infer_response_profile(user_text)
    options = options_for_pipeline(OLLAMA_OPTIONS, response_profile, pipeline, selected_model)
    if trace:
        trace.set("ollama_model", selected_model)
        trace.set("prompt_chars", len(prompt))
        trace.set("prompt_tokens_est", estimate_tokens(prompt))
        trace.set("ollama_num_ctx", options.get("num_ctx"))
        trace.set("ollama_num_predict", options.get("num_predict"))

    started_at = time.perf_counter()
    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=False,
    )
    if trace:
        trace.add_ms("ollama_total_ms", started_at)
    r.raise_for_status()
    data = r.json()
    _record_ollama_metrics(data, trace)
    return data.get("response", "").strip()


def llm_ollama_raw(
    prompt: str,
    model: Optional[str] = None,
    num_predict: int = 520,
    *,
    pipeline: str = STANDARD_PATH,
    trace=None,
) -> str:
    """
    Chamada direta ao Ollama para módulos internos (Reflection Layer, Summarizer).

    Aceita prompt pronto — não passa por build_prompt().
    """
    selected_model = resolve_ollama_model(model)
    response_profile = {"num_predict": num_predict}
    options = options_for_pipeline(OLLAMA_OPTIONS, response_profile, pipeline, selected_model)
    if trace:
        trace.set("raw_prompt_tokens_est", estimate_tokens(prompt))
        trace.set("raw_ollama_num_predict", options.get("num_predict"))
    started_at = time.perf_counter()
    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=False,
    )
    if trace:
        trace.add_ms("ollama_raw_total_ms", started_at)
    r.raise_for_status()
    data = r.json()
    _record_ollama_metrics(data, trace, prefix="raw_")
    return data.get("response", "").strip()


def llm_ollama_stream(
    user_text: str,
    history=None,
    model: Optional[str] = None,
    web_context: Optional[str] = None,
    knowledge_context: Optional[str] = None,
    *,
    pipeline: str = STANDARD_PATH,
    trace=None,
):
    """
    Chamada em streaming ao Ollama. Gerador que yield tokens conforme chegam.

    Usado pelo endpoint /api/chat/stream via SSE.
    """
    from llm.prompt_builder import build_prompt, infer_response_profile

    selected_model = resolve_ollama_model(model)
    with trace.span("prompt_build") if trace else _nullcontext():
        prompt = build_prompt(
            user_text,
            history,
            web_context,
            knowledge_context,
            pipeline=pipeline,
            selected_model=selected_model,
        )
    response_profile = infer_response_profile(user_text)
    options = options_for_pipeline(OLLAMA_OPTIONS, response_profile, pipeline, selected_model)
    if trace:
        trace.set("ollama_model", selected_model)
        trace.set("prompt_chars", len(prompt))
        trace.set("prompt_tokens_est", estimate_tokens(prompt))
        trace.set("ollama_num_ctx", options.get("num_ctx"))
        trace.set("ollama_num_predict", options.get("num_predict"))

    started_at = time.perf_counter()
    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": True,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=True,
    )
    if trace:
        trace.add_ms("ollama_http_ready_ms", started_at)
    r.raise_for_status()

    first_token_seen = False
    generated_tokens_est = 0
    try:
        for line in r.iter_lines():
            if line:
                try:
                    data = json.loads(line.decode("utf-8"))
                    if data.get("done"):
                        _record_ollama_metrics(data, trace)
                        continue
                    token = data.get("response", "")
                    if token:
                        generated_tokens_est += estimate_tokens(token)
                        if trace and not first_token_seen:
                            trace.mark("ollama_first_token")
                            trace.set("ollama_first_token_ms", trace.elapsed_ms())
                            first_token_seen = True
                        yield token
                except Exception as exc:
                    print(f"[OllamaClient] Falha ao decodificar chunk: {exc}")
    finally:
        # Fechar o SSE/abortar no front encerra o socket imediatamente em vez
        # de deixar uma resposta Ollama zumbi continuar ocupando recursos.
        r.close()
    if trace:
        trace.set("generated_tokens_est", generated_tokens_est)


@contextlib.contextmanager
def _nullcontext():
    yield


def _duration_to_ms(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value) / 1_000_000, 2)
    except Exception:
        return None


def _record_ollama_metrics(data: dict, trace=None, prefix: str = "") -> None:
    if not trace or not isinstance(data, dict):
        return
    for key in ("load_duration", "prompt_eval_duration", "eval_duration", "total_duration"):
        value = _duration_to_ms(data.get(key))
        if value is not None:
            trace.set(f"{prefix}ollama_{key}_ms", value)
    for key in ("prompt_eval_count", "eval_count"):
        if key in data:
            trace.set(f"{prefix}ollama_{key}", data.get(key))
    eval_count = data.get("eval_count")
    eval_duration = data.get("eval_duration")
    try:
        if eval_count and eval_duration:
            trace.set(
                f"{prefix}ollama_tokens_per_second",
                round(float(eval_count) / (float(eval_duration) / 1_000_000_000), 2),
            )
    except Exception:
        pass
