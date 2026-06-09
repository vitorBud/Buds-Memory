"""
cognitive/detector.py — Detector Automático de Conhecimentos do Nexus IA.

Analisa pares (usuário, IA) de cada conversa e detecta automaticamente:
  - Novas tecnologias/conceitos aprendidos
  - Menções a projetos
  - Sinais de aprendizado ("aprendi", "entendi", "descobri")
  - Tarefas concluídas
  - Marcos importantes

Roda em thread de background após cada resposta — zero impacto na latência.
"""

from __future__ import annotations

import re
import threading
from typing import Optional

from cognitive import knowledge_graph, memory, timeline, projects
from database_v2 import get_db_connection, now_iso


# ── Padrões de detecção ───────────────────────────────────────────────────────

# Sinais de aprendizado
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

# Sinais de tarefa concluída
_TASK_PATTERNS = [
    r"\bfiz\b",
    r"\bfizemos\b",
    r"\bconfigur(?:ei|ou|amos)\b",
    r"\binstalei\b",
    r"\bdeployei\b",
    r"\bpubliquei\b",
    r"\brefator(?:ei|ou|amos)\b",
    r"\btestei\b",
    r"\bfuncionou\b",
]

# Sinais de pergunta/estudo
_STUDY_PATTERNS = [
    r"\bcomo\b.{0,60}\bfunciona\b",
    r"\bexpliq(?:ue|ua)\b",
    r"\bme ensina\b",
    r"\bpreciso aprender\b",
    r"\bquero entender\b",
    r"\bo que é\b",
]

# Tecnologias com aliases para normalizar
_TECH_ALIASES = {
    "nodejs": "node.js", "node js": "node.js",
    "nextjs": "next.js", "next js": "next.js",
    "vue js": "vue", "vuejs": "vue",
    "ts": "typescript", "js": "javascript",
    "py": "python",
}


# ── Ponto de entrada principal ────────────────────────────────────────────────

def process_chat_async(
    session_id: str,
    user_text: str,
    ai_text: str,
) -> None:
    """
    Dispara a análise cognitiva em background (thread separada).
    Não bloqueia a resposta do chat.
    """
    t = threading.Thread(
        target=_process_chat,
        args=(session_id, user_text, ai_text),
        daemon=True,
    )
    t.start()


def _process_chat(session_id: str, user_text: str, ai_text: str) -> None:
    """Executa toda a detecção cognitiva de forma síncrona (em background)."""
    try:
        combined = f"{user_text}\n{ai_text}"

        # 1. Detecta e registra entidades no Knowledge Graph
        entities = knowledge_graph.detect_and_register(combined, session_id)

        # 2. Detecta sinais de aprendizado
        if _has_learning_signal(user_text) or _has_learning_signal(ai_text):
            _register_learning(session_id, user_text, ai_text, entities)

        # 3. Detecta tarefas concluídas
        if _has_task_signal(user_text):
            _register_task(session_id, user_text)

        # 4. Detecta menções a projetos e vincula
        projects.auto_detect_and_link(session_id, combined)

        # 5. Salva memória de curto prazo da conversa
        importance = _estimate_importance(user_text, ai_text, entities)
        memory.save_short_term(
            content=_summarize_exchange(user_text, ai_text),
            session_id=session_id,
            importance=importance,
            tags=entities[:5],
        )

    except Exception as e:
        print(f"[Detector] Erro em background: {e}")


# ── Detecção de sinais ────────────────────────────────────────────────────────

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
) -> None:
    """Registra aprendizado na timeline e como memória de médio prazo."""
    tech_label = entities[0] if entities else _extract_subject(user_text)
    title = f"Aprendizado: {tech_label}" if tech_label else "Novo aprendizado"

    # Timeline
    timeline.add_event(
        title=title,
        event_type="learning",
        description=_truncate(user_text, 200),
        session_id=session_id,
        importance=0.7,
        tags=entities[:5],
    )

    # Memória de médio prazo
    memory.save_medium_term(
        content=f"Aprendi sobre: {', '.join(entities) if entities else user_text[:120]}",
        session_id=session_id,
        importance=0.7,
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
        importance=0.5,
    )


# ── Importância estimada ──────────────────────────────────────────────────────

def _estimate_importance(user_text: str, ai_text: str, entities: list[str]) -> float:
    """
    Score de importância (0–1) para a memória da troca.
    Fatores: presença de aprendizado, tarefas, nº de entidades, comprimento.
    """
    score = 0.3  # base

    if _has_learning_signal(user_text) or _has_learning_signal(ai_text):
        score += 0.25
    if _has_task_signal(user_text):
        score += 0.15
    if _has_study_signal(user_text):
        score += 0.1
    if entities:
        score += min(len(entities) * 0.04, 0.2)
    if len(user_text) > 200:
        score += 0.05

    return min(score, 1.0)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _summarize_exchange(user_text: str, ai_text: str, max_len: int = 300) -> str:
    """Cria resumo compacto da troca para armazenar como memória."""
    user_part = _truncate(user_text, 120)
    ai_part = _truncate(ai_text, 160)
    return f"Usuário: {user_part}\nIA: {ai_part}"


def _extract_subject(text: str, max_words: int = 6) -> str:
    """Extrai o assunto principal de uma frase (primeiras palavras relevantes)."""
    text = re.sub(r"[^\w\s]", " ", (text or "").strip())
    words = [w for w in text.split() if len(w) > 3][:max_words]
    return " ".join(words)


def _truncate(text: str, length: int) -> str:
    text = (text or "").strip()
    if len(text) <= length:
        return text
    return text[:length - 3].rstrip() + "..."


def detect_technologies(text: str) -> list[str]:
    """Detecta tecnologias mencionadas no texto (API pública)."""
    found = []
    lower = text.lower()
    for tech in knowledge_graph.KNOWN_TECHNOLOGIES:
        pattern = r"\b" + re.escape(tech) + r"\b"
        if re.search(pattern, lower):
            canonical = _TECH_ALIASES.get(tech, tech)
            if canonical not in found:
                found.append(canonical)
    return found


def detect_learning_signals(text: str) -> dict:
    """Retorna dict com sinais detectados no texto."""
    return {
        "has_learning": _has_learning_signal(text),
        "has_task": _has_task_signal(text),
        "has_study": _has_study_signal(text),
        "technologies": detect_technologies(text),
        "importance": _estimate_importance(text, "", detect_technologies(text)),
    }
