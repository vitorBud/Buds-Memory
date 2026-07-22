"""
performance.py — Instrumentação e roteamento de performance do Aether Memory.

Este módulo é deliberadamente pequeno e sem dependências externas. Ele mede o
tempo de cada etapa crítica do chat e define um orçamento de contexto por tipo
de pergunta para evitar que conversas simples acionem o pipeline cognitivo todo.
"""

from __future__ import annotations

import contextlib
import os
import re
import time
import uuid
from typing import Iterator, Optional


FAST_PATH = "FAST_PATH"
STANDARD_PATH = "STANDARD_PATH"
DEEP_PATH = "DEEP_PATH"


PIPELINE_BUDGETS = {
    FAST_PATH: {
        "history_messages": int(os.getenv("AETHER_FAST_HISTORY", "4")),
        "context_chars": int(os.getenv("AETHER_FAST_CONTEXT_CHARS", "0")),
        "num_ctx": int(os.getenv("AETHER_FAST_NUM_CTX", "2048")),
        "num_predict": int(os.getenv("AETHER_FAST_NUM_PREDICT", "120")),
        "retrieval": False,
        "reflection": False,
    },
    STANDARD_PATH: {
        "history_messages": int(os.getenv("AETHER_STANDARD_HISTORY", "8")),
        "context_chars": int(os.getenv("AETHER_STANDARD_CONTEXT_CHARS", "5200")),
        "num_ctx": int(os.getenv("AETHER_STANDARD_NUM_CTX", "4096")),
        "num_predict": int(os.getenv("AETHER_STANDARD_NUM_PREDICT", "420")),
        "retrieval": True,
        "reflection": False,
    },
    DEEP_PATH: {
        "history_messages": int(os.getenv("AETHER_DEEP_HISTORY", "12")),
        "context_chars": int(os.getenv("AETHER_DEEP_CONTEXT_CHARS", "9000")),
        "num_ctx": int(os.getenv("AETHER_DEEP_NUM_CTX", "8192")),
        "num_predict": int(os.getenv("AETHER_DEEP_NUM_PREDICT", "1100")),
        "retrieval": True,
        "reflection": os.getenv("NEXUS_ENABLE_REFLECTION", "0").lower() in {"1", "true", "yes", "sim"},
    },
}


FAST_MODEL = os.getenv("AETHER_FAST_MODEL", "qwen2.5-coder:3b")
USE_FAST_MODEL = os.getenv("AETHER_USE_FAST_MODEL", "0").lower() in {"1", "true", "yes", "sim"}


class PerfTrace:
    """Coleta métricas estruturadas de uma requisição sem depender de logging externo."""

    def __init__(
        self,
        *,
        route: str,
        pipeline: str = STANDARD_PATH,
        model: Optional[str] = None,
        diagnostics: bool = False,
    ) -> None:
        self.request_id = uuid.uuid4().hex[:10]
        self.route = route
        self.pipeline = pipeline
        self.model = model or ""
        self.diagnostics = diagnostics
        self.started = time.perf_counter()
        self.metrics: dict[str, object] = {}
        self.events: list[dict[str, object]] = []

    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self.started) * 1000, 2)

    def set(self, key: str, value: object) -> None:
        self.metrics[key] = value

    def add_ms(self, key: str, started_at: float) -> float:
        value = round((time.perf_counter() - started_at) * 1000, 2)
        self.metrics[key] = value
        return value

    def mark(self, name: str, **extra: object) -> None:
        event = {"name": name, "at_ms": self.elapsed_ms()}
        event.update(extra)
        self.events.append(event)

    @contextlib.contextmanager
    def span(self, name: str) -> Iterator[None]:
        started_at = time.perf_counter()
        try:
            yield
        finally:
            self.add_ms(f"{name}_ms", started_at)

    def as_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "route": self.route,
            "pipeline": self.pipeline,
            "model": self.model,
            "total_ms": self.elapsed_ms(),
            "metrics": self.metrics,
            "events": self.events[-24:],
        }

    def log(self) -> None:
        if self.diagnostics or os.getenv("AETHER_PERF_LOG", "0").lower() in {"1", "true", "yes", "sim"}:
            print(f"[PerfTrace] {self.as_dict()}")


def diagnostics_requested(args=None, headers=None) -> bool:
    """Ativa retorno de trace quando a chamada pede diagnostics=1."""
    args = args or {}
    headers = headers or {}
    value = (
        args.get("diagnostics")
        or args.get("debug")
        or headers.get("X-Aether-Diagnostics")
        or headers.get("X-Nexus-Diagnostics")
        or ""
    )
    return str(value).lower() in {"1", "true", "yes", "sim"}


def estimate_tokens(text: Optional[str]) -> int:
    """Estimativa barata o bastante para rodar em toda requisição."""
    clean = text or ""
    if not clean:
        return 0
    words = len(re.findall(r"\S+", clean))
    chars = len(clean)
    return max(1, int(max(words * 1.35, chars / 4.2)))


def budget_for_pipeline(pipeline: str) -> dict:
    return dict(PIPELINE_BUDGETS.get(pipeline, PIPELINE_BUDGETS[STANDARD_PATH]))


def clip_context(text: Optional[str], max_chars: int) -> str:
    """Limita contexto preservando o começo, onde ficam perfil/core memories."""
    if not text or max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    clipped = text[:max_chars].rstrip()
    last_block = clipped.rfind("\n[")
    if last_block > max_chars * 0.62:
        clipped = clipped[:last_block].rstrip()
    if "<doc_external>" in clipped and "</doc_external>" not in clipped[clipped.rfind("<doc_external>"):]:
        clipped = clipped[:clipped.rfind("<doc_external>")].rstrip()
    return clipped


def classify_pipeline(
    user_text: str,
    *,
    web_search: bool = False,
    has_audio: bool = False,
) -> str:
    """Classifica a pergunta para escolher custo de contexto e modelo."""
    text = re.sub(r"\s+", " ", (user_text or "").strip())
    lower = text.lower()
    words = re.findall(r"\w+", lower)
    word_count = len(words)

    if web_search:
        return STANDARD_PATH

    deep_patterns = [
        r"```",
        r"\b(auditoria|arquitetura completa|analise profundamente|análise profunda|refatore|implemente|corrija todo|projeto inteiro)\b",
        r"\b(pass[oó] a passo|tutorial|detalhado|detalhe|documente|compare|relat[oó]rio)\b",
        r"\b(codebase|pasta inteira|todo o c[oó]digo|todos os arquivos)\b",
    ]
    if any(re.search(pattern, lower) for pattern in deep_patterns):
        return DEEP_PATH

    memory_patterns = [
        r"\b(meu|minha|meus|minhas|sobre mim|quem sou|qual .*meu|lembra|lembrar|mem[oó]ria|perfil)\b",
        r"\b(qual .* eu|que .* eu|eu uso|eu tenho|meu computador|minha m[aá]quina)\b",
        r"\b(pdf|arquivo|documento|material|obsidian|fonte|aprendeu|importei)\b",
        r"\b(isso|isto|aquilo|aquele|aquela|anterior|recente)\b",
    ]
    if any(re.search(pattern, lower) for pattern in memory_patterns):
        return STANDARD_PATH

    finance_or_code = [
        r"\b(fatura|cart[aã]o|sal[aá]rio|parcela|pix|or[cç]amento|investimento|limite)\b",
        r"\b(c[oó]digo|fun[cç][aã]o|classe|bug|erro|traceback|endpoint|react|python|javascript|typescript)\b",
    ]
    if any(re.search(pattern, lower) for pattern in finance_or_code):
        return STANDARD_PATH

    social_patterns = [
        r"^(e\s*a[ií]|eai|ea[ií]|oi|ol[aá]|opa|fala|salve|bom dia|boa tarde|boa noite)\b",
        r"^(valeu|obrigad[oa]|tmj|fechou|ok|certo|boa)[!.?]*$",
        r"\b(tudo bem|beleza|blz|suave|tranquilo)\??$",
    ]
    if word_count <= 10 and any(re.search(pattern, lower) for pattern in social_patterns):
        return FAST_PATH

    if word_count <= 18 and not has_audio:
        return FAST_PATH

    return STANDARD_PATH


def select_model_for_pipeline(requested_model: str, pipeline: str, available_models: list[str]) -> str:
    """
    Seleciona o modelo final para o pipeline.

    Regra principal: respeitar o modelo escolhido pelo usuário na interface.
    O fallback FAST_MODEL só existe para chamadas antigas/standalone sem modelo
    explícito, mantendo abertura rápida sem falsificar a troca 3B/7B/14B.
    """
    if requested_model:
        return requested_model
    if pipeline == FAST_PATH and USE_FAST_MODEL and FAST_MODEL in available_models:
        return FAST_MODEL
    return requested_model


def options_for_pipeline(base_options: dict, response_profile: dict, pipeline: str) -> dict:
    """Aplica orçamento de contexto/geração sem ignorar o perfil da resposta."""
    budget = budget_for_pipeline(pipeline)
    options = dict(base_options)
    requested_predict = int(response_profile.get("num_predict") or options.get("num_predict") or 380)
    max_predict = int(budget["num_predict"])
    options["num_predict"] = min(requested_predict, max_predict)
    options["num_ctx"] = min(int(options.get("num_ctx") or budget["num_ctx"]), int(budget["num_ctx"]))
    return options
