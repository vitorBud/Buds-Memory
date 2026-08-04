"""
cognitive/conversation.py — Pipeline cognitivo de contexto conversacional.

Camada incremental inspirada em GraphRAG, Letta/MemGPT, LightRAG,
Continue.dev e Open WebUI:
  1. Intent detection
  2. Query rewriting
  3. Multi retrieval
  4. Cognitive ranking
  5. Context compression
  6. Context assembly for Ollama

Tudo local-first: SQLite, BM25/embeddings opcionais, sem dependências novas.
"""

from __future__ import annotations

import datetime
import os
import platform
import re
from typing import Optional

import database
from database_v2 import get_db_connection, json_loads
from cognitive import (
    codebase_indexer,
    knowledge_graph,
    memory,
    projects,
    rag,
    finance,
    summarizer,
    timeline,
    user_profile,
)
from cognitive.utils import (
    freshness_score   as _freshness_score,
    is_vague_text     as _is_vague,
    clip              as _clip,
    jaccard_similarity as _jaccard,
)


INTENTS = {
    "MEMORY_QUERY",
    "DOCUMENT_QUERY",
    "CODE_QUERY",
    "PROJECT_QUERY",
    "TIMELINE_QUERY",
    "GENERAL_QUERY",
    "SMALL_TALK",
    "PLANNING",
    "TROUBLESHOOTING",
    "FINANCIAL_BUDGET",
    "CREDIT_CARD",
    "INSTALLMENT_PLAN",
    "REIMBURSEMENT",
    "CASH_FLOW",
    "SAVINGS",
    "DEBT",
    "EXPENSE_ORGANIZATION",
}

MAX_CONTEXT_CHARS = int(os.getenv("NEXUS_CONTEXT_MAX_CHARS", "8000"))
IS_WINDOWS = platform.system().lower() == "windows"
WINDOWS_RETRIEVAL_WORKERS = max(3, min(6, (os.cpu_count() or 4) // 3))
RETRIEVAL_WORKERS = int(os.getenv(
    "NEXUS_RETRIEVAL_WORKERS",
    str(WINDOWS_RETRIEVAL_WORKERS if IS_WINDOWS else 4),
))
INTENT_TIEBREAK_PRIORITY = {
    "TROUBLESHOOTING": 0,
    "FINANCIAL_BUDGET": 1,
    "CREDIT_CARD": 2,
    "REIMBURSEMENT": 3,
    "INSTALLMENT_PLAN": 4,
    "CASH_FLOW": 5,
    "PLANNING": 6,
    "SMALL_TALK": 7,
    "CODE_QUERY": 8,
    "DOCUMENT_QUERY": 9,
    "MEMORY_QUERY": 10,
    "PROJECT_QUERY": 11,
    "TIMELINE_QUERY": 12,
    "EXPENSE_ORGANIZATION": 13,
    "SAVINGS": 14,
    "DEBT": 15,
    "GENERAL_QUERY": 16,
}


SLANG_MAP = {
    "eae": "cumprimento informal",
    "eai": "cumprimento informal",
    "e aí": "cumprimento informal",
    "blz": "beleza / tudo bem",
    "deu bom": "funcionou corretamente",
    "ta dando ruim": "esta com problema",
    "tá dando ruim": "esta com problema",
    "ta osso": "esta dificil",
    "tá osso": "esta dificil",
    "show": "muito bom",
    "top": "muito bom",
    "massa": "muito bom",
    "bora": "vamos fazer",
    "vamo": "vamos",
    "arruma isso": "corrija este problema",
    "esse trem": "essa coisa / este item mencionado",
    "esse negócio": "essa coisa / este item mencionado",
    "esse negocio": "essa coisa / este item mencionado",
    "isso aqui": "este item / trecho atual",
    "aquilo ali": "aquele item mencionado anteriormente",
}

TYPO_MAP = {
    "openhouter": "OpenRouter",
    "openrouter": "OpenRouter",
    "allama": "Ollama",
    "olama": "Ollama",
    "ollama": "Ollama",
    "pyhton": "Python",
    "javascritp": "JavaScript",
    "typscript": "TypeScript",
    "frotn": "front-end",
    "fron end": "front-end",
    "back end": "backend",
    "abck": "backend",
    "obisian": "Obsidian",
    "obsidia": "Obsidian",
    "intelogente": "inteligente",
    "mensgaem": "mensagem",
    "conevrsa": "conversa",
}


def build_conversation_context(
    user_text: str,
    session_id: Optional[str],
    history: Optional[list[dict]] = None,
    conversation_summary: Optional[dict] = None,
) -> dict:
    """Executa o pipeline cognitivo e retorna contexto pronto para o prompt."""
    history = history or []
    interpretation = interpret_user_text(user_text)
    intent = detect_intent(user_text, interpretation=interpretation)
    rewritten_query = rewrite_query(
        user_text,
        history,
        session_id,
        conversation_summary=conversation_summary,
        interpretation=interpretation,
    )
    response_plan = plan_response(user_text, intent, interpretation)

    blocks = []
    profile_context = user_profile.get_profile_context()
    if profile_context:
        blocks.append({
            "type": "profile",
            "title": "Memórias persistentes do usuário (de conversas anteriores):",
            "content": profile_context,
            "score": 1.25,
            "priority": 1.0,
        })

    for item in retrieve_core_memories():
        blocks.append(item)

    working = build_working_memory(history)
    if working:
        blocks.append({
            "type": "working_memory",
            "title": "Working Memory da conversa atual",
            "content": working,
            "score": 0.92,
            "priority": 0.88,
        })

    if conversation_summary and conversation_summary.get("summary"):
        blocks.append({
            "type": "conversation_summary",
            "title": "Resumo persistente da conversa longa",
            "content": (
                f"{conversation_summary['summary']}\n"
                f"(mensagens resumidas: {conversation_summary.get('message_count', 0)})"
            ),
            "score": 0.9,
            "priority": 0.82,
        })

    financial_context = finance.build_financial_context(user_text, history)
    if financial_context:
        blocks.append({
            "type": "financial_analysis",
            "title": "Análise financeira estruturada",
            "content": financial_context,
            "score": 1.1,
            "priority": 0.98,
        })

    retrieval_results = []
    if intent["primary"] != "SMALL_TALK":
        import concurrent.futures
        retrieval_fns = [
            (retrieve_memories, (rewritten_query, intent["primary"], session_id)),
            (retrieve_graph, (rewritten_query, intent["primary"])),
            (retrieve_documents, (rewritten_query, session_id, intent["primary"])),
            (retrieve_codebase, (rewritten_query, intent["primary"])),
            (retrieve_timeline, (rewritten_query, intent["primary"])),
            (retrieve_projects, (rewritten_query, intent["primary"])),
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=RETRIEVAL_WORKERS) as executor:
            futures = {executor.submit(fn, *args): fn.__name__ for fn, args in retrieval_fns}
            for future in concurrent.futures.as_completed(futures, timeout=5):
                try:
                    retrieval_results.extend(future.result())
                except Exception as exc:
                    print(f"[ConversationPipeline] Retrieval falhou ({futures[future]}): {exc}")

    ranked = compress_results(rank_results(retrieval_results), limit=14)
    blocks.extend(ranked)

    context = format_context(blocks, user_text, rewritten_query, intent, interpretation, response_plan)
    return {
        "intent": intent,
        "query": rewritten_query,
        "interpretation": interpretation,
        "response_plan": response_plan,
        "context": context,
        "results": ranked,
    }


def interpret_user_text(text: str) -> dict:
    """Normaliza gírias, typos comuns e sinais informais sem alterar a fala original."""
    original = (text or "").strip()
    lower = original.lower()
    slang_hits = []
    typo_hits = []
    normalized = original

    for slang, meaning in SLANG_MAP.items():
        if slang in lower:
            slang_hits.append({"term": slang, "meaning": meaning})

    for wrong, correct in TYPO_MAP.items():
        if re.search(r"\b" + re.escape(wrong) + r"\b", lower):
            typo_hits.append({"term": wrong, "correction": correct})
            normalized = re.sub(r"\b" + re.escape(wrong) + r"\b", correct, normalized, flags=re.I)

    normalized = re.sub(r"\s+", " ", normalized).strip()
    return {
        "original": original,
        "normalized": normalized,
        "slang": slang_hits,
        "typos": typo_hits,
        "is_vague": _is_vague(original),
        "references": _contextual_reference_terms(original),
    }


def detect_intent(text: str, interpretation: Optional[dict] = None) -> dict:
    """Detecção local, determinística e barata de intenção."""
    interpretation = interpretation or interpret_user_text(text)
    lower = (interpretation.get("normalized") or text or "").lower()
    scores = {intent: 0.0 for intent in INTENTS}

    keyword_groups = {
        "MEMORY_QUERY": [
            "lembra", "lembrar", "memória", "memoria", "sobre mim", "quem sou",
            "me conhece", "perfil", "preferência", "preferencia",
        ],
        "DOCUMENT_QUERY": [
            "pdf", "documento", "arquivo", "texto importado", "fonte", "resuma",
            "material", "nota", "obsidian", "markdown",
        ],
        "CODE_QUERY": [
            "código", "codigo", "função", "funcao", "classe", "rota", "endpoint",
            "componente", "hook", "import", "autenticação", "auth",
            "bug", "erro", "arquivo usa", "onde está", "onde esta",
        ],
        "PROJECT_QUERY": [
            "projeto", "objetivo", "roadmap", "feature", "tarefa", "nexus", "buds",
            "arquitetura", "implementar",
        ],
        "TIMELINE_QUERY": [
            "quando", "ontem", "hoje", "semana", "mês", "mes", "timeline",
            "histórico", "historico", "o que fiz", "aprendi",
        ],
        "SMALL_TALK": [
            "cumprimento informal", "oi", "olá", "ola", "bom dia", "boa tarde",
            "boa noite", "tudo bem", "beleza", "valeu", "obrigado", "obrigada",
        ],
        "PLANNING": [
            "planejar", "planeja", "planeje", "plano", "roadmap", "estratégia", "estrategia",
            "próximo passo", "próximos passos", "proximo passo", "proximos passos",
            "organizar", "prioridade", "cronograma", "arquitetar",
        ],
        "TROUBLESHOOTING": [
            "erro", "bug", "falha", "travou", "não funciona", "nao funciona",
            "quebrado", "problema", "corrigir", "arrumar", "dando ruim", "traceback",
            "exception", "address already in use",
        ],
        "FINANCIAL_BUDGET": [
            "orçamento", "orcamento", "salário", "salario", "renda", "organizar",
            "gastos", "despesas", "quanto sobra", "quanto sai",
        ],
        "CREDIT_CARD": [
            "cartão", "cartao", "fatura", "limite", "crédito", "credito",
        ],
        "INSTALLMENT_PLAN": [
            "parcela", "parcelas", "parcelando", "dividido", "divididos", "vezes",
        ],
        "REIMBURSEMENT": [
            "pix", "reembolso", "reembolsado", "receberei", "me enviará",
            "me enviara", "vão me mandar", "vao me mandar", "para eu pagar",
        ],
        "CASH_FLOW": [
            "fluxo de caixa", "impacto líquido", "impacto liquido", "sai do meu salário",
            "sai do meu salario", "dinheiro de passagem",
        ],
        "SAVINGS": [
            "guardar", "economizar", "reserva", "poupar",
        ],
        "DEBT": [
            "dívida", "divida", "juros", "atraso", "devendo",
        ],
        "EXPENSE_ORGANIZATION": [
            "organizar", "separar", "planejar fatura", "controle financeiro",
        ],
    }

    for intent, keywords in keyword_groups.items():
        for keyword in keywords:
            if keyword in lower:
                scores[intent] += 1.0

    for label in finance.detect_financial_intents(lower):
        scores[label] = scores.get(label, 0.0) + 2.0

    if "?" in text:
        scores["GENERAL_QUERY"] += 0.15
    if interpretation.get("is_vague"):
        scores["MEMORY_QUERY"] += 0.2
        scores["GENERAL_QUERY"] += 0.15
    if not any(score > 0 for key, score in scores.items() if key != "GENERAL_QUERY"):
        scores["GENERAL_QUERY"] += 1.0

    primary = sorted(
        scores.items(),
        key=lambda item: (-item[1], INTENT_TIEBREAK_PRIORITY.get(item[0], 99)),
    )[0][0]
    if scores[primary] <= 0:
        primary = "GENERAL_QUERY"

    active = [name for name, score in sorted(scores.items(), key=lambda item: item[1], reverse=True) if score > 0]
    if primary not in active:
        active.insert(0, primary)

    return {"primary": primary, "active": active[:4], "scores": scores}


def rewrite_query(
    user_text: str,
    history: list[dict],
    session_id: Optional[str],
    conversation_summary: Optional[dict] = None,
    interpretation: Optional[dict] = None,
) -> str:
    """Expande perguntas vagas usando histórico, documentos e projetos."""
    user_text = (user_text or "").strip()
    interpretation = interpretation or interpret_user_text(user_text)
    normalized = interpretation.get("normalized") or user_text
    if not session_id:
        return normalized

    parts = [normalized]
    if interpretation.get("slang"):
        meanings = [f"{hit['term']}={hit['meaning']}" for hit in interpretation["slang"][:4]]
        parts.append("Gírias interpretadas: " + "; ".join(meanings))
    if interpretation.get("typos"):
        corrections = [f"{hit['term']}→{hit['correction']}" for hit in interpretation["typos"][:6]]
        parts.append("Correções silenciosas: " + "; ".join(corrections))

    reference_hints = resolve_context_references(
        user_text=user_text,
        history=history,
        session_id=session_id,
        conversation_summary=conversation_summary,
        interpretation=interpretation,
    )
    if reference_hints:
        parts.append("Resolução de referência contextual: " + " ".join(reference_hints))

    if _is_vague(user_text):
        recent_messages = [
            f"{'Usuário' if item.get('sender') == 'user' else 'Assistente'}: {str(item.get('text', '')).strip()}"
            for item in history[-8:]
            if str(item.get("text", "")).strip() and str(item.get("text", "")).strip() != "__thinking__"
        ]
        if recent_messages:
            parts.append("Contexto recente para resolver referências: " + " ".join(recent_messages[-6:]))
        if conversation_summary and conversation_summary.get("summary"):
            parts.append("Resumo persistente relevante: " + str(conversation_summary["summary"])[:700])

    try:
        sources = database.get_session_knowledge(session_id, limit=8)
        if sources and (_is_vague(user_text) or re.search(r"\b(pdf|arquivo|documento|material|obsidian|nota)\b", user_text.lower())):
            signals = []
            for source in sources[:6]:
                topics = ", ".join(source.get("topics") or [])
                signals.append(
                    f"{source.get('title', '')} {source.get('source_name', '')} {topics} {(source.get('summary') or '')[:240]}"
                )
            parts.append("Materiais importados disponíveis: " + " ".join(signals))
    except Exception:
        pass

    try:
        all_projects = projects.get_all_projects(status="active")
        if all_projects and ("projeto" in user_text.lower() or _is_vague(user_text)):
            parts.append("Projetos ativos: " + ", ".join(p["name"] for p in all_projects[:6]))
    except Exception:
        pass

    return "\n".join(part for part in parts if part.strip())[:3200]


def resolve_context_references(
    user_text: str,
    history: list[dict],
    session_id: Optional[str],
    conversation_summary: Optional[dict] = None,
    interpretation: Optional[dict] = None,
) -> list[str]:
    """Resolve referências vagas usando sinais concretos recentes e documentos importados."""
    interpretation = interpretation or interpret_user_text(user_text)
    lower = (user_text or "").lower()
    refs = interpretation.get("references") or []
    has_vague_reference = bool(refs) or _is_vague(user_text)
    mentions_source = _mentions_imported_source(lower)
    hints: list[str] = []

    if not has_vague_reference and not mentions_source:
        return hints

    if refs:
        hints.append("termos vagos detectados: " + ", ".join(refs[:6]) + ".")

    recent = _recent_referent(history)
    if recent and has_vague_reference:
        sender = "usuário" if recent.get("sender") == "user" else "assistente"
        hints.append(f"referente provável na conversa: {sender}: {_clip(str(recent.get('text', '')), 520)}")

    if session_id and mentions_source:
        try:
            sources = database.get_session_knowledge(session_id, limit=5)
        except Exception:
            sources = []
        if sources:
            selected = sources[0]
            hints.append("documento/arquivo mais provável: " + _format_source_reference(selected))
            if len(sources) > 1:
                alternates = "; ".join(_format_source_reference(source, short=True) for source in sources[1:3])
                if alternates:
                    hints.append("outros materiais recentes: " + alternates)

    if conversation_summary and conversation_summary.get("summary") and has_vague_reference:
        hints.append("resumo persistente útil: " + _clip(str(conversation_summary["summary"]), 420))

    return hints[:5]


def answer_recent_assistant_reference(user_text: str, history: list[dict]) -> Optional[str]:
    """
    Responde de forma fundamentada quando o usuário pergunta por que foi chamado
    de determinado termo que aparece numa fala recente do próprio assistente.
    """
    text = re.sub(r"\s+", " ", (user_text or "").strip())
    match = re.search(
        r"\b(?:por que|porque|pq)\b.{0,60}\b(?:você|voce)\s+(?:me\s+)?"
        r"chamou(?:\s+de)?\s+[\"'“”]?([^?!.;,\"'“”]{1,60})",
        text,
        flags=re.I,
    )
    if not match:
        return None

    label = match.group(1).strip(" -:").strip()
    label = re.sub(r"\s+(?:antes|ali|aí|ai|agora)$", "", label, flags=re.I).strip()
    if not label or len(label.split()) > 6:
        return None

    normalized_label = re.sub(r"\s+", " ", label.casefold())
    referenced_turn = None
    for item in reversed(history or []):
        if item.get("sender") == "user":
            continue
        assistant_text = re.sub(r"\s+", " ", str(item.get("text", "")).casefold())
        if normalized_label in assistant_text:
            referenced_turn = str(item.get("text", "")).strip()
            break

    if not referenced_turn:
        return None

    return (
        f"Eu realmente usei “{label}” na mensagem anterior, tentando deixar o tom informal. "
        "Foi uma escolha de linguagem minha, não algo que você tenha dito. "
        "Se soou inadequado, desculpe — não vou repetir esse tratamento."
    )


def plan_response(user_text: str, intent: dict, interpretation: dict) -> dict:
    """Define diretrizes internas para a resposta antes de chamar o modelo."""
    lower = (interpretation.get("normalized") or user_text or "").lower()
    primary = intent.get("primary", "GENERAL_QUERY")
    wants_detail = bool(re.search(r"\b(detalhe|detalhado|explique|tutorial|passo a passo|completo|profundo)\b", lower))
    wants_code = primary == "CODE_QUERY" or bool(re.search(r"\b(código|codigo|exemplo|função|funcao|classe|script)\b", lower))
    financial_primary = primary in {
        "FINANCIAL_BUDGET", "CREDIT_CARD", "INSTALLMENT_PLAN", "REIMBURSEMENT",
        "CASH_FLOW", "SAVINGS", "DEBT", "EXPENSE_ORGANIZATION",
    }
    needs_steps = primary in {"PLANNING", "TROUBLESHOOTING", "CODE_QUERY"} or financial_primary or "passo" in lower
    detail_level = "curto"
    if wants_detail:
        detail_level = "detalhado"
    elif primary in {"TROUBLESHOOTING", "PLANNING", "DOCUMENT_QUERY", "CODE_QUERY"} or financial_primary:
        detail_level = "medio"

    tone = "casual"
    if primary in {"CODE_QUERY", "TROUBLESHOOTING"}:
        tone = "tecnico direto"
    elif primary == "PLANNING":
        tone = "organizado e pratico"
    elif financial_primary:
        tone = "financeiro claro e prudente"
    elif primary == "SMALL_TALK":
        tone = "natural e breve"

    objective_by_intent = {
        "MEMORY_QUERY": "responder usando perfil e memórias salvas, sem inventar",
        "DOCUMENT_QUERY": "usar documentos importados quando houver relação clara",
        "CODE_QUERY": "diagnosticar ou localizar código com precisão",
        "PROJECT_QUERY": "orientar decisões do projeto com contexto existente",
        "TIMELINE_QUERY": "responder com eventos e datas quando disponíveis",
        "SMALL_TALK": "responder como conversa natural, sem acionar aula ou fontes",
        "PLANNING": "organizar próximos passos claros",
        "TROUBLESHOOTING": "identificar causa provável e propor correção objetiva",
        "FINANCIAL_BUDGET": "organizar orçamento separando fatura bruta, gasto pessoal e reembolsos",
        "CREDIT_CARD": "explicar impacto na fatura do cartão sem misturar limite, parcela e gasto mensal",
        "INSTALLMENT_PLAN": "calcular parcelas somente com meses e valores informados",
        "REIMBURSEMENT": "separar dinheiro de passagem/reembolso de renda disponível",
        "CASH_FLOW": "mostrar impacto líquido no salário e fluxo de caixa",
        "SAVINGS": "orientar reserva e economia sem inventar metas",
        "DEBT": "organizar dívida e riscos sem inventar juros",
        "EXPENSE_ORGANIZATION": "entregar uma organização prática dos gastos",
        "GENERAL_QUERY": "responder diretamente e pedir contexto só se necessário",
    }
    return {
        "objective": objective_by_intent.get(primary, objective_by_intent["GENERAL_QUERY"]),
        "tone": tone,
        "detail_level": detail_level,
        "needs_code": wants_code,
        "needs_examples": wants_detail or "exemplo" in lower,
        "needs_steps": needs_steps,
        "avoid_sources": primary == "SMALL_TALK",
    }


def build_working_memory(history: list[dict], limit: int = 8) -> str:
    """Resumo curto do contexto imediato da conversa."""
    lines = []
    for item in history[-limit:]:
        text = str(item.get("text", "")).strip()
        if not text or text == "__thinking__":
            continue
        role = "Usuário" if item.get("sender") == "user" else "Assistente"
        lines.append(f"{role}: {text[:420]}")
    return "\n".join(lines)


def retrieve_memories(query: str, primary_intent: str, session_id: Optional[str]) -> list[dict]:
    results = []
    for item in memory.recall(query, memory_types=["medium", "long"], limit=8, session_id=session_id):
        if item.get("is_core"):
            continue
        results.append(_result(
            "memory",
            f"Memória {item.get('memory_type')}",
            item["content"],
            source_id=item.get("id"),
            importance=float(item.get("importance") or 0.5),
            score=0.72,
            created_at=item.get("created_at"),
            access_count=item.get("access_count", 0),
        ))

    if primary_intent == "MEMORY_QUERY":
        for item in memory.recall(query, memory_types=["archive"], limit=4, session_id=session_id):
            results.append(_result(
                "archive_memory",
                "Archive Memory",
                item["content"],
                source_id=item.get("id"),
                importance=float(item.get("importance") or 0.35),
                score=0.48,
                created_at=item.get("created_at"),
                access_count=item.get("access_count", 0),
            ))
    return results


def retrieve_core_memories() -> list[dict]:
    """Carrega Core Memories como bloco prioritário e separado do ranking comum."""
    results = []
    try:
        core = memory.get_memories(memory_types=["long"], include_expired=False, limit=12)
    except Exception:
        return results
    for item in core:
        if item.get("is_core"):
            results.append({
                "type": "core_memory",
                "title": "Core Memory permanente",
                "content": item["content"],
                "score": 1.15,
                "priority": 0.98,
                "source_id": item.get("id"),
                "importance": 1.0,
                "created_at": item.get("created_at"),
            })
    return results


def retrieve_documents(query: str, session_id: Optional[str], primary_intent: str) -> list[dict]:
    if primary_intent == "CODE_QUERY":
        top_k = 3
    elif primary_intent == "DOCUMENT_QUERY":
        top_k = 8
    else:
        top_k = 5

    results = []
    try:
        for item in rag.hybrid_search(query, session_id=session_id, top_k=top_k):
            source = item.get("source_label") or f"{item.get('source_table')} #{item.get('source_id')}"
            trace = item.get("chunk_trace") or ""
            content = item.get("chunk_text", "")
            if trace:
                content = f"Localização: {trace}\n{content}"
            results.append(_result(
                "document",
                source,
                content,
                source_id=item.get("source_id"),
                importance=float(item.get("importance") or 0.5),
                score=max(float(item.get("score") or 0.0), float(item.get("bm25_score") or 0.0), 0.55),
                created_at=item.get("created_at"),
                graph_connections=item.get("graph_connections", 0),
                metadata={"topics": item.get("source_topics") or [], "chunk_index": item.get("chunk_index")},
            ))
    except Exception as exc:
        print(f"[ConversationPipeline] Falha em retrieve_documents: {exc}")
    return results


def retrieve_graph(query: str, primary_intent: str) -> list[dict]:
    tokens = _tokens(query)
    if not tokens:
        return []

    # Pré-filtra no SQL usando LIKE para evitar carregar todas as entidades em memória
    like_conditions = " OR ".join(
        "LOWER(name || ' ' || COALESCE(entity_type,'') || ' ' || COALESCE(description,'')) LIKE ?"
        for _ in tokens[:6]  # limita a 6 tokens para evitar queries gigantes
    )
    like_params = [f"%{token}%" for token in tokens[:6]]

    with get_db_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM kg_entities
            WHERE {like_conditions}
            ORDER BY importance DESC, access_count DESC
            LIMIT 40
            """,
            like_params,
        ).fetchall()

    candidates = []
    for row in rows:
        haystack = f"{row['name']} {row['entity_type']} {row['description'] or ''}".lower()
        score = sum(haystack.count(token) for token in tokens)
        if score > 0:
            candidates.append((score + float(row["importance"] or 0.5), dict(row)))
    candidates.sort(key=lambda item: item[0], reverse=True)

    results = []
    for _, entity in candidates[:4 if primary_intent != "GENERAL_QUERY" else 2]:
        graph = knowledge_graph.get_neighbors(entity["name"], depth=2)
        if not graph:
            continue
        lines = [f"Conceito central: {graph['center']['name']} ({graph['center']['entity_type']})"]
        for edge in graph.get("edges", [])[:12]:
            lines.append(f"{edge['source']} --[{edge['relation_type']}]--> {edge['target']}")
        results.append(_result(
            "knowledge_graph",
            f"Knowledge Graph: {entity['name']}",
            "\n".join(lines),
            source_id=entity.get("id"),
            importance=float(entity.get("importance") or 0.5),
            score=0.72,
            graph_connections=len(graph.get("edges", [])),
        ))
    for community in knowledge_graph.search_communities(query, limit=2):
        results.append(_result(
            "graph_community",
            f"Comunidade: {community.get('title')}",
            community.get("summary") or "",
            source_id=community.get("id"),
            importance=float(community.get("importance") or 0.5),
            score=0.68,
            graph_connections=int(community.get("edge_count") or 0),
            metadata={"size": community.get("size")},
        ))
    return results


def retrieve_codebase(query: str, primary_intent: str) -> list[dict]:
    if primary_intent != "CODE_QUERY" and not _looks_like_code_query(query):
        return []
    results = []
    try:
        for item in codebase_indexer.search_codebase(query, limit=8):
            details = []
            for key, label in (("functions", "Funções"), ("classes", "Classes"), ("routes", "Rotas"), ("imports", "Imports")):
                values = item.get(key) or []
                if values:
                    details.append(f"{label}: {', '.join(values[:8])}")
            content = f"{item.get('summary') or ''}\n" + "\n".join(details)
            results.append(_result(
                "code",
                f"{item.get('relative_path')}{'::' + item.get('symbol_name') if item.get('symbol_name') else ''}",
                content.strip(),
                source_id=item.get("id"),
                score=float(item.get("score") or 0.6),
                importance=0.7,
                metadata={"language": item.get("language")},
            ))
    except Exception as exc:
        print(f"[ConversationPipeline] Falha em retrieve_codebase: {exc}")
    return results


def retrieve_timeline(query: str, primary_intent: str) -> list[dict]:
    if primary_intent != "TIMELINE_QUERY" and not re.search(r"\b(hoje|ontem|semana|mês|mes|quando|timeline|histórico|historico)\b", query.lower()):
        return []
    results = []
    try:
        events = timeline.answer_temporal_query(query).get("events", [])
        for event in events[:8]:
            results.append(_result(
                "timeline",
                f"Timeline: {event.get('title')}",
                event.get("description") or event.get("title") or "",
                source_id=event.get("id"),
                score=0.65,
                importance=float(event.get("importance") or 0.5),
                created_at=event.get("event_date"),
            ))
    except Exception as exc:
        print(f"[ConversationPipeline] Falha em retrieve_timeline: {exc}")
    return results


def retrieve_projects(query: str, primary_intent: str) -> list[dict]:
    if primary_intent != "PROJECT_QUERY" and "projeto" not in query.lower():
        return []
    tokens = _tokens(query)
    results = []
    try:
        for project in projects.get_all_projects():
            haystack = " ".join([
                project.get("name") or "",
                project.get("description") or "",
                " ".join(project.get("technologies") or []),
                " ".join(project.get("tags") or []),
            ]).lower()
            score = sum(haystack.count(token) for token in tokens)
            if score > 0 or primary_intent == "PROJECT_QUERY":
                context = projects.get_project_context(project["id"])
                results.append(_result(
                    "project",
                    f"Projeto: {project['name']}",
                    context,
                    source_id=project.get("id"),
                    score=max(0.45, min(score / 5, 1.0)),
                    importance=0.75 if project.get("status") == "active" else 0.45,
                    created_at=project.get("updated_at") or project.get("created_at"),
                ))
    except Exception as exc:
        print(f"[ConversationPipeline] Falha em retrieve_projects: {exc}")
    return results[:6]


def rank_results(results: list[dict]) -> list[dict]:
    for item in results:
        item["rank_score"] = (
            0.45 * float(item.get("score") or 0.0)
            + 0.22 * float(item.get("importance") or 0.5)
            + 0.13 * _freshness_score(item.get("created_at"))
            + 0.12 * min(float(item.get("graph_connections") or 0) / 12.0, 1.0)
            + 0.08 * min(float(item.get("access_count") or 0) / 20.0, 1.0)
        )
    return sorted(results, key=lambda item: item["rank_score"], reverse=True)


def compress_results(results: list[dict], limit: int = 14) -> list[dict]:
    kept = []
    fingerprints = []
    for item in results:
        text = item.get("content") or ""
        fp = set(_tokens(text))
        if fp and any(_jaccard(fp, existing) > 0.72 for existing in fingerprints):
            continue
        kept.append(item)
        fingerprints.append(fp)
        if len(kept) >= limit:
            break
    return kept


def format_context(
    blocks: list[dict],
    user_text: str,
    rewritten_query: str,
    intent: dict,
    interpretation: Optional[dict] = None,
    response_plan: Optional[dict] = None,
) -> str:
    lines = []
    profile_blocks = [b for b in blocks if b["type"] == "profile"]
    core_blocks = [b for b in blocks if b["type"] == "core_memory"]
    other_blocks = [b for b in blocks if b["type"] not in {"profile", "core_memory"}]
    interpretation = interpretation or interpret_user_text(user_text)
    response_plan = response_plan or plan_response(user_text, intent, interpretation)

    for block in profile_blocks:
        lines.append(f"{block['title']}\n{block['content']}")

    if core_blocks:
        lines.append("\nCore Memories permanentes e protegidas:")
        for block in core_blocks[:8]:
            lines.append(f"- {block['content']}")

    lines.append("Pipeline cognitivo local do Buds Memory:")
    lines.append(f"Intenção detectada: {intent['primary']} ({', '.join(intent.get('active') or [])})")
    if interpretation.get("normalized") and interpretation["normalized"] != (user_text or "").strip():
        lines.append(f"Interpretação corrigida internamente: {interpretation['normalized']}")
    if interpretation.get("slang"):
        lines.append("Gírias entendidas: " + "; ".join(f"{h['term']} = {h['meaning']}" for h in interpretation["slang"][:5]))
    if interpretation.get("references"):
        lines.append("Referências contextuais detectadas: " + ", ".join(interpretation["references"][:8]))
    if rewritten_query.strip() != (user_text or "").strip():
        lines.append(f"Pergunta reescrita para recuperação: {rewritten_query[:900]}")
    lines.append("Plano interno de resposta:")
    lines.append(f"- Objetivo: {response_plan['objective']}")
    lines.append(f"- Tom: {response_plan['tone']}")
    lines.append(f"- Detalhe: {response_plan['detail_level']}")
    lines.append(f"- Precisa de código: {'sim' if response_plan['needs_code'] else 'não'}")
    lines.append(f"- Precisa de passos: {'sim' if response_plan['needs_steps'] else 'não'}")
    lines.append("Use este contexto como apoio. Priorize fontes mais específicas. Só cite [Fonte N] quando usar documentos/código/grafo para responder, nunca em small talk.")

    # Tipos externos (dados de usuário, PDFs, URLs) — requerem delimitação anti-injection
    _EXTERNAL_TYPES = {"document", "code", "knowledge_graph", "graph_community", "timeline", "project"}

    source_index = 1
    for block in other_blocks:
        content = _clip(block.get("content") or "", 1200)
        if not content:
            continue
        block_type = block["type"]
        label = f"Fonte {source_index}" if block_type in _EXTERNAL_TYPES else block["title"]
        if label.startswith("Fonte"):
            header = f"\n[{label} — {block['title']} | tipo={block_type} | score={block.get('rank_score', 0):.2f}]"
            # Delimita conteúdo externo para evitar prompt injection via documentos importados
            lines.append(header)
            lines.append(f"<doc_external>\n{content}\n</doc_external>")
            source_index += 1
        else:
            lines.append(f"\n[{label}]")
            lines.append(content)

    context = "\n".join(lines)
    # Trunca pelo limite preservando a integridade do último bloco
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS]
        # garante que não fica com tag aberta
        if "<doc_external>" in context and "</doc_external>" not in context[context.rfind("<doc_external>"):]:
            context = context[:context.rfind("<doc_external>")].rstrip()
    return context


def maybe_refine_response(user_text: str, draft: str, context: str, llm_call) -> str:
    """
    Reflection Layer opcional.

    llm_call deve receber um prompt e devolver texto. Por padrão, o Buds Memory não
    chama esta etapa para evitar latência extra no Mac M1.
    """
    enabled = os.getenv("NEXUS_ENABLE_REFLECTION", "0").lower() in {"1", "true", "yes", "sim"}
    if not enabled or not draft or len(draft) < 120:
        return draft
    if len(re.findall(r"\w+", user_text or "")) <= 18 and len(draft) < 520:
        return draft

    prompt = (
        "Você é o Reflection Layer local do Buds Memory.\n"
        "Revise a resposta abaixo usando apenas a pergunta e o contexto fornecidos.\n"
        "Objetivo: corrigir contradições, remover invenções e deixar a resposta mais direta.\n"
        "Se a resposta já estiver boa, devolva a mesma resposta melhor formatada.\n\n"
        f"Pergunta do usuário:\n{user_text}\n\n"
        f"Contexto recuperado:\n{context[:5000]}\n\n"
        f"Resposta inicial:\n{draft}\n\n"
        "Resposta final melhorada:"
    )
    try:
        refined = llm_call(prompt)
        return refined.strip() if refined and refined.strip() else draft
    except Exception as exc:
        print(f"[Reflection] Ignorado: {exc}")
        return draft


def _result(
    result_type: str,
    title: str,
    content: str,
    source_id=None,
    score: float = 0.5,
    importance: float = 0.5,
    created_at: Optional[str] = None,
    graph_connections: int = 0,
    access_count: int = 0,
    metadata: Optional[dict] = None,
) -> dict:
    return {
        "type": result_type,
        "title": title,
        "content": content,
        "source_id": source_id,
        "score": score,
        "importance": importance,
        "created_at": created_at,
        "graph_connections": graph_connections,
        "access_count": access_count,
        "metadata": metadata or {},
    }



# _is_vague importada de cognitive.utils (eliminada duplicata local)


def _contextual_reference_terms(text: str) -> list[str]:
    lower = (text or "").lower()
    terms = [
        "ele", "ela", "isso", "isto", "aquilo", "essa parte", "esse projeto",
        "aquele arquivo", "essa função", "essa funcao", "aquele pdf", "esse pdf",
        "o pdf anterior", "pdf anterior", "arquivo anterior", "último pdf",
        "ultimo pdf", "último arquivo", "ultimo arquivo", "esse negócio",
        "esse negocio", "isso aqui", "aquilo ali",
    ]
    return [term for term in terms if term in lower]


def _mentions_imported_source(lower: str) -> bool:
    source_term = re.search(r"\b(pdf|arquivo|documento|material|fonte|nota|texto importado)\b", lower)
    temporal_term = re.search(r"\b(anterior|último|ultimo|recente|aquele|esse|essa|deste|desse|dessa)\b", lower)
    return bool(source_term and (temporal_term or _is_vague(lower)))


def _recent_referent(history: list[dict]) -> Optional[dict]:
    for item in reversed(history or []):
        text = str(item.get("text", "")).strip()
        if not text or text == "__thinking__":
            continue
        if len(text) < 8:
            continue
        return item
    return None


def _format_source_reference(source: dict, short: bool = False) -> str:
    topics = ", ".join((source.get("topics") or [])[:5])
    title = source.get("title") or source.get("source_name") or "Documento"
    source_name = source.get("source_name") or ""
    summary = _clip(source.get("summary") or "", 220 if not short else 100)
    if short:
        return " ".join(part for part in [title, f"({source_name})" if source_name else "", topics] if part).strip()
    parts = [f"{title}"]
    if source_name:
        parts.append(f"arquivo: {source_name}")
    if topics:
        parts.append(f"tópicos: {topics}")
    if summary:
        parts.append(f"resumo: {summary}")
    return "; ".join(parts)


def _looks_like_code_query(query: str) -> bool:
    return bool(re.search(
        r"\b(código|codigo|função|funcao|classe|rota|endpoint|hook|componente|import|bug|erro|auth)\b",
        query.lower(),
    ))


def _tokens(text: str) -> list[str]:
    stop = {
        "para", "como", "qual", "quais", "sobre", "onde", "quando", "isso",
        "esse", "essa", "aqui", "voce", "você", "documento", "arquivo",
    }
    clean = re.sub(r"[^\w\s./_-]", " ", (text or "").lower())
    return [word for word in clean.split() if len(word) > 2 and word not in stop]



# _freshness_score, _jaccard, _clip importados de cognitive.utils (eliminadas duplicatas locais)
