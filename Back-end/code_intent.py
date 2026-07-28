"""Detecção compartilhada de pedidos de programação e geração de código."""

from __future__ import annotations

import re


_EXPLICIT_CODE_RE = re.compile(
    r"```|"
    r"\b(c[oó]digo|code|programa(?:r|ção|cao)?|fun[cç][aã]o|m[eé]todo|classe|"
    r"script|algoritmo|compilar|compila[cç][aã]o|terminal|shell|api|endpoint|"
    r"bug|erro|stack|traceback|console\.log|println|hello[\s_-]*world)\b",
    re.I,
)

_PROGRAMMING_LANGUAGE_RE = re.compile(
    r"\b(python|javascript|typescript|java|kotlin|scala|groovy|"
    r"c\+\+|c#|csharp|golang|rust|ruby|php|swift|dart|lua|perl|"
    r"html|css|sql|bash|powershell|react|vue|angular|node(?:\.js)?|deno)\b",
    re.I,
)

_CODE_REQUEST_ACTION_RE = re.compile(
    r"\b(mand(?:a|ar)|envi(?:a|ar)|mostr(?:a|ar)|ger(?:a|ar)|cri(?:a|ar)|"
    r"escrev(?:a|er)|fa[cç]a|implement(?:a|ar)|exemplo|sintaxe|como (?:faço|faco)|"
    r"execut(?:a|ar)|rod(?:a|ar)|print(?:ar)?|imprim(?:ir|a))\b",
    re.I,
)


def is_code_request(user_text: str) -> bool:
    """Retorna ``True`` quando a mensagem pede código ou trabalho de programação."""
    text = re.sub(r"\s+", " ", (user_text or "").strip())
    if not text:
        return False
    if _EXPLICIT_CODE_RE.search(text):
        return True
    return bool(
        _PROGRAMMING_LANGUAGE_RE.search(text)
        and _CODE_REQUEST_ACTION_RE.search(text)
    )
