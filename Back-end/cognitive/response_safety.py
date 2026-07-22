"""
cognitive/response_safety.py — limpeza final antes de exibir respostas.

Remove artefatos internos sem impedir Markdown legítimo. A camada é usada tanto
no endpoint normal quanto no streaming, evitando vazamento de prompt, tags de
raciocínio, JSON técnico e blocos de código quando o usuário não pediu código.
"""

from __future__ import annotations

import json
import re


INTERNAL_TAGS = (
    "thinking", "analysis", "tool", "tools", "context", "system", "developer",
    "prompt", "scratchpad", "plan", "internal", "doc_external",
)

CODE_QUERY_RE = re.compile(
    r"\b(c[oó]digo|code|fun[cç][aã]o|classe|script|python|javascript|typescript|"
    r"react|sql|html|css|terminal|erro|bug|stack|traceback|api|endpoint)\b",
    re.I,
)


def allows_code(user_text: str) -> bool:
    return bool(CODE_QUERY_RE.search(user_text or ""))


def sanitize_response(
    text: str,
    user_text: str = "",
    *,
    allow_code: bool | None = None,
    streaming: bool = False,
) -> str:
    """Retorna apenas conteúdo seguro para o usuário final."""
    if not text:
        return ""

    allow_code = allows_code(user_text) if allow_code is None else allow_code
    clean = str(text).replace("\r\n", "\n").replace("\r", "\n")
    clean = _extract_final_answer(clean)
    clean = _remove_internal_tags(clean, drop_unclosed=streaming)
    clean = _remove_internal_sections(clean)
    clean = _handle_json_payload(clean, allow_code=allow_code, streaming=streaming)
    clean = _handle_code_fences(clean, allow_code=allow_code, streaming=streaming)
    clean = _remove_log_and_trace_lines(clean)
    clean = _strip_internal_lines(clean)
    clean = _normalize_markdown(clean, allow_code=allow_code)
    return clean.strip()


def _extract_final_answer(text: str) -> str:
    markers = [
        "Resposta final melhorada:",
        "Resposta final:",
        "Final answer:",
        "<final>",
    ]
    lower = text.lower()
    selected = text
    for marker in markers:
        idx = lower.rfind(marker.lower())
        if idx != -1:
            selected = text[idx + len(marker):]
            lower = selected.lower()
    return selected.replace("</final>", "")


def _remove_internal_tags(text: str, *, drop_unclosed: bool) -> str:
    clean = text
    for tag in INTERNAL_TAGS:
        clean = re.sub(
            rf"<\s*{tag}\b[^>]*>.*?<\s*/\s*{tag}\s*>",
            "",
            clean,
            flags=re.I | re.S,
        )
        if drop_unclosed:
            open_match = re.search(rf"<\s*{tag}\b[^>]*>.*$", clean, flags=re.I | re.S)
            if open_match:
                clean = clean[:open_match.start()]
        clean = re.sub(rf"<\s*/?\s*{tag}\b[^>]*>", "", clean, flags=re.I)
    return clean


def _remove_internal_sections(text: str) -> str:
    section_headers = (
        "pipeline cognitivo local",
        "plano interno de resposta",
        "contrato de resposta",
        "pergunta reescrita para recuperação",
        "interpretação corrigida internamente",
        "contexto recuperado",
        "prompt do sistema",
        "system prompt",
    )
    lines = []
    skipping = False
    for line in text.splitlines():
        stripped = line.strip()
        lowered = stripped.lower()
        if any(header in lowered for header in section_headers):
            skipping = True
            continue
        if skipping and (not stripped or re.match(r"^#{1,4}\s+|\*\*[^*]+?\*\*", stripped)):
            skipping = False
        if not skipping:
            lines.append(line)
    return "\n".join(lines)


def _handle_json_payload(text: str, *, allow_code: bool, streaming: bool) -> str:
    stripped = text.strip()
    if allow_code or not stripped:
        return text
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
        except Exception:
            return "" if streaming else _drop_jsonish_lines(text)
        extracted = _extract_text_from_json(parsed)
        return extracted if extracted else ""
    return _drop_jsonish_lines(text)


def _extract_text_from_json(value) -> str:
    if isinstance(value, dict):
        for key in ("response", "answer", "final", "final_answer", "content", "message", "text"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
        return ""
    if isinstance(value, list):
        parts = [_extract_text_from_json(item) for item in value]
        return "\n".join(part for part in parts if part)
    return ""


def _drop_jsonish_lines(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r'^[{\[]\s*$', stripped) or re.match(r'^[}\]],?\s*$', stripped):
            continue
        if re.match(r'^"?(analysis|thought|plan|tool|context|prompt|system|metadata|internal)"?\s*:', stripped, re.I):
            continue
        if re.match(r'^"[^"]+"\s*:\s*', stripped) and ("{" in text[:120] or "}" in text[-120:]):
            continue
        lines.append(line)
    return "\n".join(lines)


def _handle_code_fences(text: str, *, allow_code: bool, streaming: bool) -> str:
    if allow_code:
        if not streaming and text.count("```") % 2 == 1:
            return text.rstrip() + "\n```"
        return text

    def replace(match: re.Match) -> str:
        lang = (match.group(1) or "").strip().lower()
        body = (match.group(2) or "").strip()
        if lang in {"json", "python", "py", "javascript", "js", "typescript", "ts", "tsx", "jsx", "bash", "sh"}:
            return ""
        if _looks_like_code(body) or _looks_like_internal_json(body):
            return ""
        return body

    clean = re.sub(r"```([A-Za-z0-9_-]*)\n(.*?)```", replace, text, flags=re.S)
    if streaming and clean.count("```") % 2 == 1:
        clean = clean[:clean.rfind("```")]
    else:
        clean = clean.replace("```", "")
    return clean


def _looks_like_code(text: str) -> bool:
    return bool(re.search(r"\b(def|class|function|const|let|var|import|from|return|console\.log|SELECT|INSERT)\b|=>|;\s*$", text, re.I | re.M))


def _looks_like_internal_json(text: str) -> bool:
    stripped = text.strip()
    return (stripped.startswith("{") and stripped.endswith("}")) or bool(re.search(r'"(?:analysis|plan|thought|tool|prompt|context)"\s*:', stripped, re.I))


def _remove_log_and_trace_lines(text: str) -> str:
    blocked = re.compile(
        r"^\s*(Traceback \(most recent call last\)|File \"[^\"]+\", line \d+|"
        r"\[[A-Z][^\]]+\]\s|DEBUG:|INFO:|WARNING:|ERROR:|"
        r"raise\s+\w+|at\s+\w+.*:\d+:\d+)",
        re.I,
    )
    return "\n".join(line for line in text.splitlines() if not blocked.search(line))


def _strip_internal_lines(text: str) -> str:
    blocked = re.compile(
        r"\b(system prompt|developer message|internal|scratchpad|tool call|"
        r"metadata|doc_external|pipeline cognitivo|plano interno|json interno)\b",
        re.I,
    )
    return "\n".join(line for line in text.splitlines() if not blocked.search(line))


def _normalize_markdown(text: str, *, allow_code: bool) -> str:
    clean = re.sub(r"\n{3,}", "\n\n", text)
    clean = re.sub(r"[ \t]+\n", "\n", clean)
    if not allow_code:
        clean = re.sub(r"`{3,}", "", clean)
        clean = _strip_non_code_markdown(clean)
    return clean


def _strip_non_code_markdown(text: str) -> str:
    """Remove marcações que aparecem cruas no chat em respostas não técnicas."""
    clean = text
    clean = re.sub(r"\\\[(.*?)\\\]", r"\1", clean, flags=re.S)
    clean = re.sub(r"\\\((.*?)\\\)", r"\1", clean, flags=re.S)
    clean = clean.replace("\\times", "x")
    clean = clean.replace("\\text", "text")
    clean = re.sub(r"^\s{0,3}#{1,6}\s*", "", clean, flags=re.M)
    clean = re.sub(r"\*\*([^*]+)\*\*", r"\1", clean)
    clean = re.sub(r"__([^_]+)__", r"\1", clean)
    clean = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", clean)
    clean = re.sub(r"^\s*[-*]\s+", "- ", clean, flags=re.M)
    clean = clean.replace("\\", "")
    return clean
