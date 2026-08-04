"""
performance.py — Instrumentação e roteamento de performance do Buds Memory.

Este módulo é deliberadamente pequeno e sem dependências externas. Ele mede o
tempo de cada etapa crítica do chat e define um orçamento de contexto por tipo
de pergunta para evitar que conversas simples acionem o pipeline cognitivo todo.
"""

from __future__ import annotations

import contextlib
import os
import platform
import re
import time
import uuid
from typing import Iterator, Optional

from code_intent import is_code_request

FAST_PATH = "FAST_PATH"
STANDARD_PATH = "STANDARD_PATH"
DEEP_PATH = "DEEP_PATH"
IS_WINDOWS = platform.system().lower() == "windows"
WINDOWS_HIGH_PERFORMANCE = os.getenv("NEXUS_WINDOWS_HIGH_PERFORMANCE", "1").lower() in {"1", "true", "yes", "sim"}


def _platform_default(windows_value: str, mac_value: str) -> str:
    if IS_WINDOWS and not WINDOWS_HIGH_PERFORMANCE:
        return windows_value
    return mac_value


def _brand_env(name: str, default: str) -> str:
    """Lê a configuração Buds e aceita a variável da instalação anterior."""
    legacy_name = name.replace("BUDS_", "AETHER_", 1)
    return os.getenv(name, os.getenv(legacy_name, default))


PIPELINE_BUDGETS = {
    FAST_PATH: {
        "history_messages": int(_brand_env("BUDS_FAST_HISTORY", _platform_default("3", "4"))),
        "context_chars": int(_brand_env("BUDS_FAST_CONTEXT_CHARS", "0")),
        "num_ctx": int(_brand_env("BUDS_FAST_NUM_CTX", "2048")),
        "num_predict": int(_brand_env("BUDS_FAST_NUM_PREDICT", _platform_default("90", "120"))),
        "retrieval": False,
        "reflection": False,
    },
    STANDARD_PATH: {
        "history_messages": int(_brand_env("BUDS_STANDARD_HISTORY", _platform_default("5", "8"))),
        "context_chars": int(_brand_env("BUDS_STANDARD_CONTEXT_CHARS", _platform_default("3200", "5200"))),
        "num_ctx": int(_brand_env("BUDS_STANDARD_NUM_CTX", _platform_default("3072", "4096"))),
        "num_predict": int(_brand_env("BUDS_STANDARD_NUM_PREDICT", _platform_default("280", "420"))),
        "retrieval": True,
        "reflection": False,
    },
    DEEP_PATH: {
        "history_messages": int(_brand_env("BUDS_DEEP_HISTORY", _platform_default("8", "12"))),
        "context_chars": int(_brand_env("BUDS_DEEP_CONTEXT_CHARS", _platform_default("6200", "9000"))),
        "num_ctx": int(_brand_env("BUDS_DEEP_NUM_CTX", _platform_default("6144", "8192"))),
        "num_predict": int(_brand_env("BUDS_DEEP_NUM_PREDICT", _platform_default("700", "1100"))),
        "retrieval": True,
        "reflection": os.getenv("NEXUS_ENABLE_REFLECTION", "0").lower() in {"1", "true", "yes", "sim"},
    },
}


FAST_MODEL = _brand_env("BUDS_FAST_MODEL", "qwen2.5-coder:3b")
USE_FAST_MODEL = _brand_env("BUDS_USE_FAST_MODEL", "0").lower() in {"1", "true", "yes", "sim"}


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
        if self.diagnostics or _brand_env("BUDS_PERF_LOG", "0").lower() in {"1", "true", "yes", "sim"}:
            print(f"[PerfTrace] {self.as_dict()}")


def diagnostics_requested(args=None, headers=None) -> bool:
    """Ativa retorno de trace quando a chamada pede diagnostics=1."""
    args = args or {}
    headers = headers or {}
    value = (
        args.get("diagnostics")
        or args.get("debug")
        or headers.get("X-Buds-Diagnostics")
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


def model_size_billions(model: Optional[str]) -> float:
    """Extrai o porte anunciado no nome do modelo, por exemplo 7 de ``qwen:7b``."""
    match = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*b\b", (model or "").lower())
    return float(match.group(1)) if match else 0.0


_NUMBER_WORDS = {
    "um": 1,
    "uma": 1,
    "dois": 2,
    "duas": 2,
    "três": 3,
    "tres": 3,
    "quatro": 4,
    "cinco": 5,
    "seis": 6,
    "sete": 7,
    "oito": 8,
    "nove": 9,
    "dez": 10,
    "onze": 11,
    "doze": 12,
    "quinze": 15,
    "vinte": 20,
}

_LIST_ITEM_NOUN_RE = re.compile(
    r"\b(ideias?|op[cç][oõ]es|sugest[oõ]es|exemplos?|alternativas?|passos|"
    r"t[oó]picos|nomes|projetos|motivos|formas|maneiras|dicas|itens)\b",
    re.I,
)

_LIST_REQUEST_ACTION_RE = re.compile(
    r"\b(me\s+)?(d[eê]|liste|sugira|mostre|crie|gere|mande|envie)|"
    r"\b(quero|preciso de|pode (?:me )?(?:dar|listar|sugerir|mostrar|criar|gerar))\b",
    re.I,
)


def requested_item_count(user_text: str) -> int:
    """Extrai a quantidade pedida em listas como ``me dê 5 ideias``."""
    text = re.sub(r"\s+", " ", (user_text or "").strip().lower())
    if (
        not text
        or not _LIST_ITEM_NOUN_RE.search(text)
        or not _LIST_REQUEST_ACTION_RE.search(text)
    ):
        return 0

    count_pattern = "|".join(sorted(_NUMBER_WORDS, key=len, reverse=True))
    match = re.search(
        rf"\b(\d{{1,2}}|{count_pattern})\s+"
        rf"(?:ideias?|op[cç][oõ]es|sugest[oõ]es|exemplos?|alternativas?|passos|"
        rf"t[oó]picos|nomes|projetos|motivos|formas|maneiras|dicas|itens)\b",
        text,
        flags=re.I,
    )
    if not match:
        return 0

    raw_count = match.group(1).lower()
    count = int(raw_count) if raw_count.isdigit() else _NUMBER_WORDS.get(raw_count, 0)
    return count if 1 <= count <= 30 else 0


def budget_for_pipeline(pipeline: str, model: Optional[str] = None) -> dict:
    """
    Retorna o orçamento do pipeline ajustado à capacidade do modelo.

    Modelos 7B+ recebem mais turnos recentes e uma janela maior. O 3B mantém os
    limites leves atuais, evitando aumentar custo para o modo rápido padrão.
    """
    budget = dict(PIPELINE_BUDGETS.get(pipeline, PIPELINE_BUDGETS[STANDARD_PATH]))
    if model_size_billions(model) < 7:
        return budget

    history_floor = {
        FAST_PATH: 8,
        STANDARD_PATH: 14,
        DEEP_PATH: 20,
    }
    context_floor = {
        FAST_PATH: 0,
        STANDARD_PATH: 7000,
        DEEP_PATH: 10000,
    }
    num_ctx_floor = {
        FAST_PATH: 4096,
        STANDARD_PATH: 8192,
        DEEP_PATH: 8192,
    }
    generation_floor = {
        FAST_PATH: 180,
        STANDARD_PATH: 700,
        DEEP_PATH: 1100,
    }
    normalized_pipeline = pipeline if pipeline in history_floor else STANDARD_PATH
    budget["history_messages"] = max(budget["history_messages"], history_floor[normalized_pipeline])
    budget["context_chars"] = max(budget["context_chars"], context_floor[normalized_pipeline])
    budget["num_ctx"] = max(budget["num_ctx"], num_ctx_floor[normalized_pipeline])
    budget["num_predict"] = max(budget["num_predict"], generation_floor[normalized_pipeline])
    return budget


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

    if requested_item_count(text) >= 3:
        return STANDARD_PATH

    if is_conversation_followup(text):
        return STANDARD_PATH

    memory_patterns = [
        r"\b(meu|minha|meus|minhas|sobre mim|quem sou|qual .*meu|lembra|lembrar|mem[oó]ria|perfil)\b",
        r"\b(qual .* eu|que .* eu|eu uso|eu tenho|meu computador|minha m[aá]quina)\b",
        r"\b(pdf|arquivo|documento|material|obsidian|fonte|aprendeu|importei)\b",
        r"\b(isso|isto|aquilo|aquele|aquela|anterior|recente)\b",
    ]
    if any(re.search(pattern, lower) for pattern in memory_patterns):
        return STANDARD_PATH

    if is_code_request(text):
        return STANDARD_PATH

    finance_patterns = [
        r"\b(fatura|cart[aã]o|sal[aá]rio|parcela|pix|or[cç]amento|investimento|limite)\b",
    ]
    if any(re.search(pattern, lower) for pattern in finance_patterns):
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


def is_conversation_followup(user_text: str) -> bool:
    """Detecta perguntas que só fazem sentido à luz de falas anteriores."""
    lower = re.sub(r"\s+", " ", (user_text or "").strip().lower())
    if not lower:
        return False
    patterns = [
        r"\b(antes disso|voltando ao que (?:você|voce) (?:disse|falou|respondeu)|na sua resposta)\b",
        r"\b(?:você|voce)\s+(?:me\s+)?(?:chamou|disse|falou|respondeu|escreveu)\b",
        r"\b(?:quando|por que|porque|pq)\b.{0,50}\b(?:você|voce)\b.{0,45}\b(?:disse|falou|chamou|respondeu|escreveu)\b",
        r"\b(?:por que|porque|pq)\s+(?:disse|falou|respondeu|escreveu|fez)\s+(?:isso|assim)\b",
        r"\b(?:o que|oque)\s+(?:você|voce)\s+quis dizer\b",
        r"\b(?:do que|sobre o que)\s+(?:você|voce)\s+(?:está|esta|tá|ta)\s+falando\b",
        r"\b(?:essa|esta|aquela)\s+(?:resposta|frase|palavra|expressão|expressao)\b",
    ]
    return any(re.search(pattern, lower) for pattern in patterns)


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


def options_for_pipeline(
    base_options: dict,
    response_profile: dict,
    pipeline: str,
    model: Optional[str] = None,
) -> dict:
    """Aplica orçamento de contexto/geração sem ignorar o perfil da resposta."""
    budget = budget_for_pipeline(pipeline, model)
    options = dict(base_options)
    requested_predict = int(response_profile.get("num_predict") or options.get("num_predict") or 380)
    minimum_predict = max(0, int(response_profile.get("minimum_predict") or 0))
    requested_predict = max(requested_predict, minimum_predict)
    max_predict = max(int(budget["num_predict"]), minimum_predict)
    options["num_predict"] = min(requested_predict, max_predict)
    options["num_ctx"] = min(int(options.get("num_ctx") or budget["num_ctx"]), int(budget["num_ctx"]))
    return options
