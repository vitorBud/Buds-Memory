"""
cognitive/detector.py — Detector Cognitivo do Buds Memory com Filtro de Relevância.

Analisa pares (usuário, IA) de cada conversa e:
  1. Calcula score de relevância (0–100)
  2. Descarta silenciosamente mensagens sem valor cognitivo (score < 25)
  3. Para conteúdo relevante, extrai fatos estruturados antes de salvar
  4. Decide o tipo de memória (short/medium/long) com base no score

O chamador decide onde executar o pipeline; o app usa um pool compartilhado
para evitar a criação de threads aninhadas a cada resposta.
"""

from __future__ import annotations

import re
from typing import Optional

from cognitive import knowledge_graph, memory, timeline, projects, user_profile
from database_v2 import get_db_connection, now_iso


# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTES DE CONTROLE (ajuste aqui)
# ═══════════════════════════════════════════════════════════════════════════════

RELEVANCE_THRESHOLD   = 25   # score mínimo para salvar qualquer coisa
MEDIUM_TERM_THRESHOLD = 50   # score para promover a médio prazo + KG
LONG_TERM_THRESHOLD   = 75   # score para promover a longo prazo + timeline


# ═══════════════════════════════════════════════════════════════════════════════
# PADRÕES DE RUÍDO — descartados imediatamente
# ═══════════════════════════════════════════════════════════════════════════════

# Mensagens que são literalmente ruído
_NOISE_EXACT: frozenset[str] = frozenset({
    "oi", "ola", "olá", "eae", "e ai", "e aí", "oi tudo bem", "tudo bem",
    "ok", "okay", "blz", "beleza", "certo", "sim", "nao", "não", "s", "n",
    "bom dia", "boa tarde", "boa noite", "boa madrugada",
    "obrigado", "obrigada", "vlw", "valeu", "tmj",
    "show", "top", "massa", "boa", "boa demais", "deu bom",
    "teste", "test", "testing", "ping", "hello", "hi", "hey",
    "1", "2", "3", ".", "..", "...", "???", "!!!",
})

# Padrões regex de ruído
_NOISE_PATTERNS: list[re.Pattern] = [
    re.compile(r"^k+$"),                          # kkk, kkkk…
    re.compile(r"^(ha)+h?$"),                     # haha, hahaha…
    re.compile(r"^(rs)+$"),                       # rsrs, rsrsrs…
    re.compile(r"^lol+$"),                        # lol, lolll…
    re.compile(r"^[\W\d\s]+$"),                   # só pontuação/números/espaços
    re.compile(r"^[\U0001F300-\U0001FAFF\s]+$"),  # só emojis
    re.compile(r"^(ok|ok+|okay|blz|sim|nao|não)\s*[!?.]*$", re.IGNORECASE),
]


# ═══════════════════════════════════════════════════════════════════════════════
# SINAIS DE CONHECIMENTO
# ═══════════════════════════════════════════════════════════════════════════════

# Sinais de aprendizado (peso +10 cada match)
_LEARNING_PATTERNS = [
    r"\baprend(?:i|eu|emos)\b",
    r"\bentend(?:i|eu|emos)\b",
    r"\bdescobri\b",
    r"\bcompreend(?:i|eu|emos)\b",
    r"\bconclui\b",
    r"\bfinaliz(?:ei|ou|amos)\b",
    r"\bcri(?:ei|ou|amos)\b",
    r"\bimplementei\b",
    r"\bconsegui\b",
    r"\bfuncionou\b",
    r"\bresolveu\b",
    r"\bsolucionei\b",
]

# Sinais de tarefa concluída (peso +10)
_TASK_PATTERNS = [
    r"\bfiz\b",
    r"\bfizemos\b",
    r"\bconfigur(?:ei|ou|amos)\b",
    r"\binstalei\b",
    r"\bdeployei\b",
    r"\bpubliquei\b",
    r"\brefator(?:ei|ou|amos)\b",
    r"\btestei\b",
]

# Sinais de conhecimento de alto valor (peso +15 cada match)
_KNOWLEDGE_SIGNALS = [
    r"\bprojeto\b",
    r"\bobjetivo\b",
    r"\bprefiro\b",
    r"\butilizo\b",
    r"\busando\b",
    r"\bestou trabalhando\b",
    r"\bdecidi\b",
    r"\bvou usar\b",
    r"\bvou criar\b",
    r"\bvou implementar\b",
    r"\bminha stack\b",
    r"\bmeu projeto\b",
    r"\bestudo\b",
    r"\baprendendo\b",
    r"\bpreciso de\b",
]

# Sinais de pergunta real (peso +5)
_STUDY_PATTERNS = [
    r"\bcomo\b.{0,60}\bfunciona\b",
    r"\bexpliq(?:ue|ua)\b",
    r"\bme ensina\b",
    r"\bpreciso aprender\b",
    r"\bquero entender\b",
    r"\bo que é\b",
]


# ═══════════════════════════════════════════════════════════════════════════════
# TEMPLATES PARA EXTRAÇÃO DE FATOS
# ═══════════════════════════════════════════════════════════════════════════════

# Padrões que identificam fatos estruturáveis no texto do usuário.
_FACT_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"\b(implementei|criei|desenvolvi|fiz)\b.{0,80}", re.I),
    re.compile(r"\b(estou aprendendo|estou estudando|aprendi)\b.{0,80}", re.I),
    re.compile(r"\b(utilizo|uso|trabalho com|prefiro)\b.{0,80}", re.I),
    re.compile(r"\b(meu projeto|no projeto|trabalhando em)\b.{0,80}", re.I),
    re.compile(r"\b(decidi|vou usar|vou criar)\b.{0,80}", re.I),
)


# ═══════════════════════════════════════════════════════════════════════════════
# PONTO DE ENTRADA PÚBLICO
# ═══════════════════════════════════════════════════════════════════════════════

def process_chat(
    session_id: str,
    user_text: str,
    ai_text: str,
) -> None:
    """Executa o pipeline cognitivo no executor escolhido pelo chamador."""
    _process_chat(session_id, user_text, ai_text)


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE INTERNO
# ═══════════════════════════════════════════════════════════════════════════════

def _process_chat(session_id: str, user_text: str, ai_text: str) -> None:
    """Pipeline cognitivo completo: filtra → extrai → salva."""
    try:
        # Fatos pessoais curtos ("meu nome é...", "sou dev") precisam sobreviver
        # ao filtro de ruído, pois viram perfil e Core Memory.
        try:
            user_profile.update_from_text(user_text, session_id=session_id)
        except Exception as profile_err:
            print(f"[UserProfile] Erro em background: {profile_err}")

        # ── FASE 1: Gate de relevância ─────────────────────────────────────
        score = _score_exchange(user_text, ai_text)

        if score < RELEVANCE_THRESHOLD:
            # Mensagem sem valor cognitivo — descarta silenciosamente
            return

        # ── FASE 2: Extração de conhecimento ──────────────────────────────
        combined = f"{user_text}\n{ai_text}"
        entities = []

        # Detecta entidades no KG apenas para conteúdo de médio valor+
        if score >= MEDIUM_TERM_THRESHOLD:
            entities = knowledge_graph.detect_and_register(combined, session_id)

        # ── FASE 3: Fato estruturado ───────────────────────────────────────
        fact = _extract_knowledge_fact(user_text, ai_text, entities)

        # ── FASE 4: Persistência por nível ────────────────────────────────
        importance = _score_to_importance(score)

        # Memória de curto prazo (sempre que passou o gate)
        memory.save_short_term(
            content=fact,
            session_id=session_id,
            importance=importance,
            tags=entities[:5],
        )

        # Memória de médio prazo (score >= 50)
        if score >= MEDIUM_TERM_THRESHOLD and _has_learning_signal(user_text):
            _register_learning(session_id, user_text, ai_text, entities, importance)

        # Timeline + longo prazo (score >= 75)
        if score >= LONG_TERM_THRESHOLD:
            memory.save_long_term(
                content=fact,
                session_id=session_id,
                importance=importance,
                tags=entities[:5],
            )

        # Tarefa concluída na timeline (score >= 50)
        if score >= MEDIUM_TERM_THRESHOLD and _has_task_signal(user_text):
            _register_task(session_id, user_text)

        # Vincula sessão ao projeto detectado
        if score >= MEDIUM_TERM_THRESHOLD:
            projects.auto_detect_and_link(session_id, combined)

    except Exception as e:
        print(f"[Detector] Erro em background: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING
# ═══════════════════════════════════════════════════════════════════════════════

def _score_exchange(user_text: str, ai_text: str) -> int:
    """
    Calcula score de relevância cognitiva (0–100).

    Retorna 0 imediatamente para ruído.
    Quanto maior o score, mais rico o conteúdo.
    """
    user_clean = (user_text or "").strip()
    ai_clean   = (ai_text or "").strip()

    # Ruído imediato → score 0
    if _is_noise(user_clean):
        return 0

    score = 0
    user_lower = user_clean.lower()
    ai_lower   = ai_clean.lower()

    # Comprimento do user (texto substancial)
    if len(user_clean) > 30:
        score += 5
    if len(user_clean) > 80:
        score += 5

    # Resposta rica da IA (indica pergunta válida)
    if len(ai_clean) > 100:
        score += 5
    if len(ai_clean) > 300:
        score += 8

    # Tecnologias detectadas (+5 cada, cap 25)
    tech_count = sum(
        1 for tech in knowledge_graph.KNOWN_TECHNOLOGIES
        if re.search(r"\b" + re.escape(tech) + r"\b", user_lower + " " + ai_lower)
    )
    score += min(tech_count * 5, 25)

    # Sinais de aprendizado (+10 por match)
    if _has_learning_signal(user_clean) or _has_learning_signal(ai_clean):
        score += 10

    # Sinais de tarefa (+10)
    if _has_task_signal(user_clean):
        score += 10

    # Sinais de estudo/pergunta real (+5)
    if _has_study_signal(user_clean):
        score += 5

    # Sinais de conhecimento de alto valor (+15 cada, cap 30)
    knowledge_hits = sum(
        1 for p in _KNOWLEDGE_SIGNALS
        if re.search(p, user_lower)
    )
    score += min(knowledge_hits * 15, 30)

    # Pergunta real com "?"
    if "?" in user_clean and len(user_clean) > 20:
        score += 5

    return min(score, 100)


def _is_noise(text: str) -> bool:
    """Retorna True se o texto não possui valor cognitivo."""
    clean = text.strip().lower()

    # Muito curto
    if len(clean) < 8:
        return True

    # Exatamente uma palavra/expressão de ruído
    if clean in _NOISE_EXACT:
        return True

    # Match em padrões de ruído
    for pattern in _NOISE_PATTERNS:
        if pattern.match(clean):
            return True

    # Ratio de palavras reais muito baixo (texto sem conteúdo)
    words = [w for w in re.findall(r"[a-záéíóúâêîôûãõ]{3,}", clean)]
    total_chars = len(re.sub(r"\s", "", clean))
    if total_chars > 0 and len(words) == 0:
        return True  # só emojis/pontuação/números

    return False


def _score_to_importance(score: int) -> float:
    """Converte score (0–100) para importância normalizada (0.0–1.0)."""
    return round(min(score / 100.0, 1.0), 3)


# ═══════════════════════════════════════════════════════════════════════════════
# EXTRAÇÃO DE FATOS
# ═══════════════════════════════════════════════════════════════════════════════

def _extract_knowledge_fact(
    user_text: str,
    ai_text: str,
    entities: list[str],
) -> str:
    """
    Extrai um fato estruturado e legível da troca.

    Em vez de salvar "Usuário: ...\nIA: ..." bruto,
    produz frases como "Usuário implementou X no projeto Y".
    """
    user_clean = (user_text or "").strip()

    # Tenta extrair pelos padrões conhecidos
    for pattern in _FACT_PATTERNS:
        match = pattern.search(user_clean)
        if match:
            raw = match.group(0).strip()
            # Capitaliza e limita
            fact = f"Usuário {raw[:150].rstrip('.,;')}."
            if entities:
                entity_str = ", ".join(entities[:3])
                if entity_str.lower() not in fact.lower():
                    fact += f" (relacionado a: {entity_str})"
            return fact

    # Fallback: comprime o texto do usuário
    if len(user_clean) > 20:
        truncated = user_clean[:160].rstrip(".,;")
        if not truncated.endswith("."):
            truncated += "."
        return f"Usuário disse: {truncated}"

    # Último recurso: usa a resposta da IA como contexto
    ai_clean = (ai_text or "").strip()
    if ai_clean:
        return f"Contexto: {ai_clean[:180].rstrip('.,;')}."

    return user_clean


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS DE DETECÇÃO
# ═══════════════════════════════════════════════════════════════════════════════

def _has_learning_signal(text: str) -> bool:
    lower = (text or "").lower()
    return any(re.search(p, lower) for p in _LEARNING_PATTERNS)


def _has_task_signal(text: str) -> bool:
    lower = (text or "").lower()
    return any(re.search(p, lower) for p in _TASK_PATTERNS)


def _has_study_signal(text: str) -> bool:
    lower = (text or "").lower()
    return any(re.search(p, lower) for p in _STUDY_PATTERNS)


def _register_learning(
    session_id: str,
    user_text: str,
    ai_text: str,
    entities: list[str],
    importance: float,
) -> None:
    """Registra aprendizado na timeline e como memória de médio prazo."""
    tech_label = entities[0].title() if entities else _extract_subject(user_text)
    title = f"Aprendizado: {tech_label}" if tech_label else "Novo aprendizado"

    timeline.add_event(
        title=title,
        event_type="learning",
        description=_truncate(user_text, 200),
        session_id=session_id,
        importance=importance,
        tags=entities[:5],
    )

    fact = _extract_knowledge_fact(user_text, ai_text, entities)
    memory.save_medium_term(
        content=fact,
        session_id=session_id,
        importance=importance,
        tags=entities[:5],
    )


def _register_task(session_id: str, user_text: str) -> None:
    """Registra tarefa concluída na timeline."""
    subject = _extract_subject(user_text)
    title = f"Tarefa: {subject}" if subject else "Tarefa concluída"
    timeline.add_event(
        title=title,
        event_type="task",
        description=_truncate(user_text, 200),
        session_id=session_id,
        importance=0.6,
    )


def _extract_subject(text: str, max_words: int = 6) -> str:
    """Extrai o assunto principal (primeiras palavras relevantes)."""
    text = re.sub(r"[^\w\s]", " ", (text or "").strip())
    words = [w for w in text.split() if len(w) > 3][:max_words]
    return " ".join(words)


def _truncate(text: str, length: int) -> str:
    text = (text or "").strip()
    if len(text) <= length:
        return text
    return text[:length - 3].rstrip() + "..."


# ═══════════════════════════════════════════════════════════════════════════════
# API PÚBLICA (usada por cognitive_api.py)
# ═══════════════════════════════════════════════════════════════════════════════

def detect_technologies(text: str) -> list[str]:
    """Detecta tecnologias mencionadas no texto."""
    found = []
    lower = text.lower()
    for tech in knowledge_graph.KNOWN_TECHNOLOGIES:
        pattern = r"\b" + re.escape(tech) + r"\b"
        if re.search(pattern, lower) and tech not in found:
            found.append(tech)
    return found


def detect_learning_signals(text: str) -> dict:
    """Retorna dict com todos os sinais detectados e o score."""
    techs = detect_technologies(text)
    score = _score_exchange(text, "")
    return {
        "score": score,
        "is_noise": _is_noise(text.strip()),
        "will_save": score >= RELEVANCE_THRESHOLD,
        "memory_tier": (
            "none" if score < RELEVANCE_THRESHOLD
            else "short" if score < MEDIUM_TERM_THRESHOLD
            else "medium" if score < LONG_TERM_THRESHOLD
            else "long"
        ),
        "has_learning": _has_learning_signal(text),
        "has_task": _has_task_signal(text),
        "has_study": _has_study_signal(text),
        "technologies": techs,
        "importance": _score_to_importance(score),
    }
