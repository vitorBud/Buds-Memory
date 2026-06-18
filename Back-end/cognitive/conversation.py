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
    summarizer,
    timeline,
    user_profile,
)


INTENTS = {
    "MEMORY_QUERY",
    "DOCUMENT_QUERY",
    "CODE_QUERY",
    "PROJECT_QUERY",
    "TIMELINE_QUERY",
    "GENERAL_QUERY",
}

MAX_CONTEXT_CHARS = int(os.getenv("NEXUS_CONTEXT_MAX_CHARS", "12000"))


def build_conversation_context(
    user_text: str,
    session_id: Optional[str],
    history: Optional[list[dict]] = None,
    conversation_summary: Optional[dict] = None,
) -> dict:
    """Executa o pipeline cognitivo e retorna contexto pronto para o prompt."""
    history = history or []
    intent = detect_intent(user_text)
    rewritten_query = rewrite_query(user_text, history, session_id)

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

    retrieval_results = []
    retrieval_results.extend(retrieve_memories(rewritten_query, intent["primary"]))
    retrieval_results.extend(retrieve_documents(rewritten_query, session_id, intent["primary"]))
    retrieval_results.extend(retrieve_graph(rewritten_query, intent["primary"]))
    retrieval_results.extend(retrieve_codebase(rewritten_query, intent["primary"]))
    retrieval_results.extend(retrieve_timeline(rewritten_query, intent["primary"]))
    retrieval_results.extend(retrieve_projects(rewritten_query, intent["primary"]))

    ranked = compress_results(rank_results(retrieval_results), limit=14)
    blocks.extend(ranked)

    context = format_context(blocks, user_text, rewritten_query, intent)
    return {
        "intent": intent,
        "query": rewritten_query,
        "context": context,
        "results": ranked,
    }


def detect_intent(text: str) -> dict:
    """Detecção local, determinística e barata de intenção."""
    lower = (text or "").lower()
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
            "componente", "hook", "import", "supabase", "autenticação", "auth",
            "bug", "erro", "arquivo usa", "onde está", "onde esta",
        ],
        "PROJECT_QUERY": [
            "projeto", "objetivo", "roadmap", "feature", "tarefa", "nexus",
            "arquitetura", "implementar",
        ],
        "TIMELINE_QUERY": [
            "quando", "ontem", "hoje", "semana", "mês", "mes", "timeline",
            "histórico", "historico", "o que fiz", "aprendi",
        ],
    }

    for intent, keywords in keyword_groups.items():
        for keyword in keywords:
            if keyword in lower:
                scores[intent] += 1.0

    if "?" in text:
        scores["GENERAL_QUERY"] += 0.15
    if not any(score > 0 for key, score in scores.items() if key != "GENERAL_QUERY"):
        scores["GENERAL_QUERY"] += 1.0

    primary = max(scores.items(), key=lambda item: item[1])[0]
    if scores[primary] <= 0:
        primary = "GENERAL_QUERY"

    active = [name for name, score in sorted(scores.items(), key=lambda item: item[1], reverse=True) if score > 0]
    if primary not in active:
        active.insert(0, primary)

    return {"primary": primary, "active": active[:4], "scores": scores}


def rewrite_query(user_text: str, history: list[dict], session_id: Optional[str]) -> str:
    """Expande perguntas vagas usando histórico, documentos e projetos."""
    user_text = (user_text or "").strip()
    if not session_id:
        return user_text

    parts = [user_text]
    if _is_vague(user_text):
        recent_user = [
            str(item.get("text", "")).strip()
            for item in history[-8:]
            if item.get("sender") == "user" and str(item.get("text", "")).strip()
        ]
        if recent_user:
            parts.append("Contexto recente: " + " ".join(recent_user[-4:]))

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


def retrieve_memories(query: str, primary_intent: str) -> list[dict]:
    results = []
    core = memory.get_memories(memory_types=["long"], include_expired=False, limit=10)
    for item in core:
        if item.get("is_core"):
            results.append(_result(
                "core_memory",
                "Core Memory",
                item["content"],
                source_id=item.get("id"),
                importance=1.0,
                score=1.0,
                created_at=item.get("created_at"),
            ))

    for item in memory.recall(query, memory_types=["medium", "long"], limit=8):
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
        for item in memory.recall(query, memory_types=["archive"], limit=4):
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

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM kg_entities ORDER BY importance DESC, access_count DESC LIMIT 500"
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


def format_context(blocks: list[dict], user_text: str, rewritten_query: str, intent: dict) -> str:
    lines = []
    profile_blocks = [b for b in blocks if b["type"] == "profile"]
    other_blocks = [b for b in blocks if b["type"] != "profile"]

    for block in profile_blocks:
        lines.append(f"{block['title']}\n{block['content']}")

    lines.append("Pipeline cognitivo local do Nexus:")
    lines.append(f"Intenção detectada: {intent['primary']} ({', '.join(intent.get('active') or [])})")
    if rewritten_query.strip() != (user_text or "").strip():
        lines.append(f"Pergunta reescrita para recuperação: {rewritten_query[:900]}")
    lines.append("Use este contexto como apoio. Priorize fontes mais específicas e cite [Fonte N] quando usar documentos/código/grafo.")

    source_index = 1
    for block in other_blocks:
        content = _clip(block.get("content") or "", 1200)
        if not content:
            continue
        label = f"Fonte {source_index}" if block["type"] in {"document", "code", "knowledge_graph", "graph_community", "timeline", "project"} else block["title"]
        if label.startswith("Fonte"):
            lines.append(f"\n[{label} — {block['title']} | tipo={block['type']} | score={block.get('rank_score', 0):.2f}]")
            source_index += 1
        else:
            lines.append(f"\n[{label}]")
        lines.append(content)

    context = "\n".join(lines)
    return context[:MAX_CONTEXT_CHARS]


def maybe_refine_response(user_text: str, draft: str, context: str, llm_call) -> str:
    """
    Reflection Layer opcional.

    llm_call deve receber um prompt e devolver texto. Por padrão, o Nexus não
    chama esta etapa para evitar latência extra no Mac M1.
    """
    enabled = os.getenv("NEXUS_ENABLE_REFLECTION", "0").lower() in {"1", "true", "yes", "sim"}
    if not enabled or not draft or len(draft) < 120:
        return draft

    prompt = (
        "Você é o Reflection Layer local do Nexus IA.\n"
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


def _is_vague(text: str) -> bool:
    lower = (text or "").lower().strip()
    words = re.findall(r"[a-zA-ZÀ-ÿ0-9_+-]+", lower)
    vague_words = {
        "isso", "isto", "esse", "essa", "aquilo", "ele", "ela", "disso",
        "desse", "dessa", "aqui", "lá", "la", "também", "tambem",
    }
    return len(words) <= 4 or any(word in vague_words for word in words)


def _looks_like_code_query(query: str) -> bool:
    return bool(re.search(
        r"\b(código|codigo|função|funcao|classe|rota|endpoint|hook|componente|import|bug|erro|auth|supabase)\b",
        query.lower(),
    ))


def _tokens(text: str) -> list[str]:
    stop = {
        "para", "como", "qual", "quais", "sobre", "onde", "quando", "isso",
        "esse", "essa", "aqui", "voce", "você", "documento", "arquivo",
    }
    clean = re.sub(r"[^\w\s./_-]", " ", (text or "").lower())
    return [word for word in clean.split() if len(word) > 2 and word not in stop]


def _freshness_score(created_at) -> float:
    if not created_at:
        return 0.5
    try:
        ts = datetime.datetime.fromisoformat(str(created_at).replace("Z", "+00:00")).replace(tzinfo=None)
        age_days = (datetime.datetime.now() - ts).days
    except Exception:
        return 0.5
    if age_days <= 1:
        return 1.0
    if age_days <= 7:
        return 0.9
    if age_days <= 30:
        return 0.7
    if age_days <= 180:
        return 0.45
    return 0.25


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def _clip(text: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."
