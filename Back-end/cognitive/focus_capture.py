"""Detecção barata de ações do Chat para o Buds Focus.

Não chama LLM: frases explícitas são estruturadas imediatamente e casos
duvidosos seguem para a Buds Inbox. O Focus continua funcional mesmo quando o
motor de texto estiver ocupado, ausente ou aquecido.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Optional


ACTION_TYPES = {"TASK", "REMINDER", "IDEA", "DECISION", "MEMORY"}
_WEEKDAYS = {
    "segunda": 0, "segunda-feira": 0, "terca": 1, "terca-feira": 1,
    "quarta": 2, "quarta-feira": 2, "quinta": 3, "quinta-feira": 3,
    "sexta": 4, "sexta-feira": 4, "sabado": 5, "domingo": 6,
}


def normalize_text(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "")
    folded = "".join(char for char in folded if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", folded.casefold()).strip()


def _split_phrases(text: str) -> list[str]:
    compact = re.sub(r"\s+", " ", (text or "").strip())
    if not compact:
        return []
    parts = re.split(r"(?<=[.!?;])\s+|\s+(?:e tamb[eé]m|al[eé]m disso)\s+", compact, flags=re.I)
    return [part.strip(" \t\n-•") for part in parts if part.strip(" \t\n-•")]


def _parse_time(normalized: str) -> tuple[int, int] | None:
    match = re.search(r"\b(?:as|a|por volta das?)\s*(\d{1,2})(?:(?::|h)(\d{2}))?\s*(?:h|horas?)?\b", normalized)
    if not match:
        match = re.search(r"\b(\d{1,2})h(\d{2})?\b", normalized)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    return (hour, minute) if hour <= 23 and minute <= 59 else None


def parse_natural_due(text: str, now: Optional[datetime] = None) -> Optional[str]:
    """Converte expressões pt-BR comuns em ISO local, sem serviço externo."""
    now = now or datetime.now()
    normalized = normalize_text(text)
    target_date = None
    if re.search(r"\bdepois de amanha\b", normalized):
        target_date = (now + timedelta(days=2)).date()
    elif re.search(r"\bamanha\b", normalized):
        target_date = (now + timedelta(days=1)).date()
    elif re.search(r"\bhoje\b", normalized):
        target_date = now.date()
    else:
        date_match = re.search(r"\b(?:dia\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", normalized)
        if date_match:
            day, month = int(date_match.group(1)), int(date_match.group(2))
            year = int(date_match.group(3) or now.year)
            if year < 100:
                year += 2000
            try:
                target_date = datetime(year, month, day).date()
            except ValueError:
                return None
        else:
            for label, weekday in _WEEKDAYS.items():
                if re.search(rf"\b{re.escape(label)}\b", normalized):
                    days = (weekday - now.weekday()) % 7
                    target_date = (now + timedelta(days=days or 7)).date()
                    break

    parsed_time = _parse_time(normalized)
    if target_date is None and parsed_time is None:
        return None
    if target_date is None:
        target_date = now.date()
        candidate = datetime.combine(target_date, datetime.min.time()).replace(
            hour=parsed_time[0], minute=parsed_time[1]
        )
        if candidate <= now:
            target_date += timedelta(days=1)
    hour, minute = parsed_time or (9, 0)
    return datetime.combine(target_date, datetime.min.time()).replace(
        hour=hour, minute=minute
    ).isoformat(timespec="minutes")


def _clean_content(phrase: str, item_type: str) -> str:
    cleaned = phrase.strip().strip('"“”')
    prefixes = {
        "REMINDER": [
            r"^(?:por favor,?\s*)?me lembr(?:a|e)\s+",
            r"^(?:eu\s+)?n[aã]o posso esquecer(?:\s+de)?\s+",
            r"^lembrete\s*:?\s*",
        ],
        "TASK": [
            r"^(?:hoje|amanh[aã]|depois de amanh[aã])[,\s]+",
            r"^(?:eu\s+)?(?:tenho que|preciso|devo|vou precisar)\s+",
            r"^(?:quero|vou)\s+(?:terminar|fazer|resolver|entregar|revisar|estudar)\s+",
        ],
        "IDEA": [r"^(?:eu\s+)?tive uma ideia(?:\s+de)?\s*:?\s*", r"^(?:minha\s+)?ideia(?:\s+[ée])?\s*:?\s*"],
        "DECISION": [r"^(?:eu\s+)?decidi(?:\s+que)?\s+", r"^(?:minha\s+)?decis[aã]o(?:\s+[ée])?\s*:?\s*"],
        "MEMORY": [r"^(?:guarde|lembre)(?:-se)?\s+que\s+", r"^memorize(?:\s+que)?\s+"],
    }
    for pattern in prefixes.get(item_type, []):
        cleaned = re.sub(pattern, "", cleaned, count=1, flags=re.I)
    cleaned = re.sub(r"^(?:hoje|amanh[aã]|depois de amanh[aã])[,\s]+", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:hoje|amanh[aã]|depois de amanh[aã])\b", "", cleaned, flags=re.I)
    cleaned = re.sub(
        r"\b(?:segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[aá]bado|domingo)\b",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\b(?:[àa]s?|por volta das?)\s*\d{1,2}(?:(?::|h)\d{0,2})?\s*(?:h|horas?)?\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:dia\s+)?\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.;:-")
    cleaned = re.sub(r"^(?:de|para|que)\s+", "", cleaned, flags=re.I)
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned[:500]


def _priority(normalized: str) -> str:
    if re.search(r"\b(urgente|prioridade maxima|importantissimo|nao posso esquecer|ainda hoje|ate hoje)\b", normalized):
        return "high"
    if re.search(r"\b(sem pressa|quando der|algum dia|baixa prioridade)\b", normalized):
        return "low"
    return "medium"


def _category(normalized: str) -> str:
    if re.search(r"\b(trabalho|cliente|relatorio|reuniao|empresa|email|e-mail)\b", normalized):
        return "work"
    if re.search(r"\b(estudar|estudo|prova|curso|faculdade|aula|livro)\b", normalized):
        return "study"
    if re.search(r"\b(projeto|codigo|programar|frontend|backend|app|deploy|github)\b", normalized):
        return "project"
    if re.search(r"\b(casa|mercado|medico|familia|academia|pessoal)\b", normalized):
        return "personal"
    return "other"


def _place_context(normalized: str) -> tuple[str, bool]:
    trigger = bool(re.search(r"\b(quando|assim que)\s+(?:eu\s+)?(?:chegar|entrar|voltar)\b", normalized))
    if re.search(r"\b(casa|em casa|pra casa|para casa)\b", normalized):
        return "home", trigger
    if re.search(r"\b(trabalho|empresa|escritorio)\b", normalized):
        return "work", trigger
    if re.search(r"\b(academia|treino)\b", normalized):
        return "gym", trigger
    if re.search(r"\b(faculdade|escola|curso|biblioteca)\b", normalized):
        return "study", trigger
    return "anywhere", False


def _strip_arrival_clause(content: str) -> str:
    value = re.sub(
        r"\b(?:quando|assim que)\s+(?:eu\s+)?(?:chegar|entrar|voltar)\s+(?:em|no|na|ao|a|pra|para)?\s*(?:casa|trabalho|empresa|escrit[oó]rio|academia|treino|faculdade|escola|curso|biblioteca)\b[,]?",
        "",
        content,
        flags=re.I,
    )
    value = re.sub(r"\s+", " ", value).strip(" ,.;:-")
    return value[0].upper() + value[1:] if value else ""


def _is_explicit_focus_command(normalized: str) -> bool:
    action = r"(?:adicionar|adiciona|adicione|colocar|coloca|coloque|criar|cria|crie|incluir|inclui|inclua|salvar|salva|salve|jogar|joga|jogue|anotar|anota|anote)"
    destination = r"(?:no|ao|pro|para o)\s+(?:buds\s+)?focus"
    return bool(
        re.search(rf"\b{action}\b.*\b{destination}\b", normalized)
        or re.search(rf"\b{destination}\b.*\b{action}\b", normalized)
    )


def _strip_focus_command(content: str) -> str:
    value = content.strip().strip('"“”')
    value = re.sub(r"^(?:por favor[,]?\s*)?(?:voc[eê]\s+)?(?:pode|consegue|poderia)?\s*", "", value, flags=re.I)
    value = re.sub(
        r"^(?:adicionar|adiciona|adicione|colocar|coloca|coloque|criar|cria|crie|incluir|inclui|inclua|salvar|salva|salve|jogar|joga|jogue|anotar|anota|anote)\s+",
        "",
        value,
        flags=re.I,
    )
    value = re.sub(r"^(?:no|ao|pro|para o)\s+(?:buds\s+)?focus\s*[:,\-]?\s*", "", value, flags=re.I)
    value = re.sub(r"\s+(?:no|ao|pro|para o)\s+(?:buds\s+)?focus\b", "", value, flags=re.I)
    value = re.sub(r"\s+como\s+(?:tarefa|lembrete)\b", "", value, flags=re.I)
    value = re.sub(r"[?]+$", "", value)
    value = re.sub(r"\s+", " ", value).strip(" ,.;:-")
    return value[0].upper() + value[1:] if value else ""


def candidate_key(item_type: str, content: str, due_date: Optional[str], place_context: str = "anywhere") -> str:
    day = (due_date or "")[:10]
    semantic = re.sub(r"[^a-z0-9 ]", " ", normalize_text(content))
    semantic = re.sub(r"\b(o|a|os|as|um|uma|de|do|da|para|que)\b", " ", semantic)
    semantic = re.sub(r"\s+", " ", semantic).strip()
    return hashlib.sha256(f"{item_type}:{semantic}:{day}:{place_context}".encode("utf-8")).hexdigest()


def detect_focus_candidates(text: str, now: Optional[datetime] = None) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    normalized_message = normalize_text(text)
    looks_like_example = bool(re.search(r"\b(por exemplo|frases? como|se eu disser|exemplo:)\b", normalized_message))
    for phrase in _split_phrases(text)[:12]:
        normalized = normalize_text(phrase)
        if len(normalized) < 6 or re.search(r"\b(nao preciso|nao tenho que|ja nao preciso)\b", normalized):
            continue

        explicit_focus_command = _is_explicit_focus_command(normalized)
        item_type = None
        confidence = 0.0
        if explicit_focus_command:
            item_type = "REMINDER" if "lembrete" in normalized else "TASK"
            confidence = 0.995
        elif re.search(r"\b(me lembra|me lembre|lembrete|nao posso esquecer)\b", normalized):
            item_type, confidence = "REMINDER", 0.99
        elif re.search(r"\b(tenho que|preciso|devo|vou precisar)\b", normalized):
            item_type, confidence = "TASK", 0.96
        elif re.search(r"^(hoje|amanha|depois de amanha)\b.*\b(vou|quero)\s+(fazer|terminar|resolver|entregar|revisar|estudar)\b", normalized):
            item_type, confidence = "TASK", 0.91
        elif re.search(r"\b(tive uma ideia|minha ideia|ideia:)\b", normalized):
            item_type, confidence = "IDEA", 0.88
        elif re.search(r"\b(decidi que|minha decisao|tomei a decisao)\b", normalized):
            item_type, confidence = "DECISION", 0.94
        elif re.search(r"\b(guarde que|lembre que|memorize que)\b", normalized):
            item_type, confidence = "MEMORY", 0.94
        if item_type not in ACTION_TYPES:
            continue

        place_context, trigger_on_arrival = _place_context(normalized)
        # Remova primeiro "quando eu chegar em..." para que o prefixo
        # "me lembre de" passe a ficar no início e também seja limpo.
        content_source = _strip_arrival_clause(phrase) if trigger_on_arrival else phrase
        if explicit_focus_command:
            content_source = _strip_focus_command(content_source)
        content = _clean_content(content_source, item_type)
        if len(content) < 3:
            continue
        due_date = parse_natural_due(phrase, now=now) if item_type in {"TASK", "REMINDER"} else None
        is_question = "?" in phrase
        auto_apply = (
            item_type in {"TASK", "REMINDER"}
            and confidence >= 0.9
            and (explicit_focus_command or not is_question)
            and not looks_like_example
        )
        if (is_question and not explicit_focus_command) or looks_like_example:
            confidence = min(confidence, 0.74)

        candidate = {
            "type": item_type,
            "content": content,
            "action": "create_task" if item_type in {"TASK", "REMINDER"} else "none",
            "category": _category(normalized),
            "priority": _priority(normalized),
            "confidence": confidence,
            "due_date": due_date,
            "auto_apply": auto_apply,
            "explicit": confidence >= 0.9,
            "place_context": place_context,
            "trigger_on_arrival": trigger_on_arrival,
        }
        candidate["dedup_key"] = candidate_key(item_type, content, due_date, place_context)
        candidates.append(candidate)

    unique: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        unique.setdefault(candidate["dedup_key"], candidate)
    return list(unique.values())
