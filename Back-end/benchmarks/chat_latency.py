"""
Benchmark simples de latência do chat streaming.

Uso:
  cd Back-end
  python benchmarks/chat_latency.py "eai beleza?"
  python benchmarks/chat_latency.py --diagnostics "explique resumidamente o que é RAG"
"""

from __future__ import annotations

import argparse
import json
import time
from typing import Optional
from urllib import request as urlrequest


def post_stream(base_url: str, text: str, diagnostics: bool, model: Optional[str] = None) -> dict:
    started = time.perf_counter()
    first_event_ms = None
    first_token_ms = None
    done_trace = None
    response_text = ""
    query = "?diagnostics=1" if diagnostics else ""
    body = json.dumps({"text": text, "tts": False, "model": model}).encode("utf-8")
    req = urlrequest.Request(
        f"{base_url.rstrip('/')}/api/chat/stream{query}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urlrequest.urlopen(req, timeout=180) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            now_ms = round((time.perf_counter() - started) * 1000, 2)
            if first_event_ms is None:
                first_event_ms = now_ms
            payload = json.loads(line[5:].strip())
            if payload.get("type") in {"token", "replace_response"} and first_token_ms is None:
                first_token_ms = now_ms
            if payload.get("type") == "token":
                response_text += payload.get("content") or ""
            elif payload.get("type") == "replace_response":
                response_text = payload.get("content") or response_text
            if payload.get("type") == "done":
                done_trace = payload.get("trace")
                break

    return {
        "mode": "aether_stream",
        "first_event_ms": first_event_ms,
        "first_token_ms": first_token_ms,
        "total_ms": round((time.perf_counter() - started) * 1000, 2),
        "response_preview": response_text.strip()[:500],
        "trace": done_trace,
    }


def post_ollama_direct(ollama_url: str, model: str, text: str) -> dict:
    started = time.perf_counter()
    first_token_ms = None
    response_text = ""
    final_metrics = {}
    body = json.dumps({
        "model": model,
        "prompt": text,
        "stream": True,
        "keep_alive": "5m",
        "options": {"num_ctx": 2048, "num_predict": 120},
    }).encode("utf-8")
    req = urlrequest.Request(
        f"{ollama_url.rstrip('/')}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urlrequest.urlopen(req, timeout=180) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            payload = json.loads(line)
            if payload.get("response") and first_token_ms is None:
                first_token_ms = round((time.perf_counter() - started) * 1000, 2)
            response_text += payload.get("response") or ""
            if payload.get("done"):
                final_metrics = payload
                break

    return {
        "mode": "ollama_direct",
        "model": model,
        "first_token_ms": first_token_ms,
        "total_ms": round((time.perf_counter() - started) * 1000, 2),
        "response_preview": response_text.strip()[:500],
        "ollama_metrics": {
            key: final_metrics.get(key)
            for key in (
                "total_duration",
                "load_duration",
                "prompt_eval_count",
                "prompt_eval_duration",
                "eval_count",
                "eval_duration",
            )
            if key in final_metrics
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("text", help="Pergunta enviada ao chat")
    parser.add_argument("--url", default="http://127.0.0.1:5050", help="URL base do backend")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434", help="URL base do Ollama")
    parser.add_argument("--model", default=None, help="Modelo usado no Aether ou no Ollama direto")
    parser.add_argument("--direct-ollama", action="store_true", help="Compara chamando o Ollama sem pipeline Aether")
    parser.add_argument("--diagnostics", action="store_true", help="Inclui trace detalhado no evento done")
    args = parser.parse_args()

    if args.direct_ollama:
        result = post_ollama_direct(args.ollama_url, args.model or "qwen2.5-coder:3b", args.text)
    else:
        result = post_stream(args.url, args.text, args.diagnostics, args.model)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
