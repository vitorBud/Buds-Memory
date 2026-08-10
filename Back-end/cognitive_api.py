"""
cognitive_api.py — Blueprint Flask da Camada Cognitiva do Buds Memory.

Todos os endpoints prefixados com /api/cognitive
Registra o Blueprint em app.py com: app.register_blueprint(cognitive_bp)
"""

from __future__ import annotations

# Importa o pacote cognitivo primeiro para garantir que o sys.path está
# configurado (via cognitive/__init__.py) antes de qualquer outro import.
import cognitive  # noqa: F401 — efeito colateral: injeta Back-end/ no sys.path

from flask import Blueprint, jsonify, request

from cognitive import (
    memory,
    knowledge_graph,
    rag,
    projects,
    timeline,
    insights,
    summarizer,
    search,
    detector,
    codebase_indexer,
    user_profile,
    conversation,
    focus,
    location,
)
import database_v2 as dbv2
from database_v2 import get_db_connection

cognitive_bp = Blueprint("cognitive", __name__, url_prefix="/api/cognitive")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ok(data, status: int = 200):
    return jsonify(data), status


def _err(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _int_param(key: str, default: int = 10) -> int:
    try:
        return int(request.args.get(key, default))
    except (ValueError, TypeError):
        return default


# ── Health / Stats ─────────────────────────────────────────────────────────--

@cognitive_bp.get("/health")
def health():
    """Retorna status de saúde do sistema cognitivo."""
    return _ok({
        "status": "online",
        "memory": memory.get_stats(),
        "graph": knowledge_graph.get_stats(),
        "rag": rag.get_stats(),
        "codebase": codebase_indexer.get_stats(),
        "projects": projects.get_stats(),
        "timeline": timeline.get_stats(),
        "insights": insights.get_stats(),
        "profile": user_profile.get_stats(),
    })


# ════════════════════════════════════════════════════════════════════════════
# MEMÓRIA
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/memory")
def get_memories():
    """Lista memórias com filtros opcionais."""
    types = request.args.getlist("type") or None
    session_id = request.args.get("session_id")
    tags = request.args.getlist("tag") or None
    include_expired = request.args.get("include_expired") == "true"
    limit = _int_param("limit", 50)

    data = memory.get_memories(
        memory_types=types,
        session_id=session_id,
        tags=tags,
        include_expired=include_expired,
        limit=limit,
    )
    return _ok(data)


@cognitive_bp.post("/memory")
def save_memory():
    """Salva uma memória manualmente."""
    body = request.get_json(silent=True) or {}
    content = (body.get("content") or "").strip()
    if not content:
        return _err("Campo 'content' é obrigatório.")

    mem_type = body.get("type", "medium")
    session_id = body.get("session_id")
    importance = float(body.get("importance", 0.6))
    tags = body.get("tags") or []

    result = memory.save_memory(
        content,
        mem_type,
        session_id,
        importance,
        tags,
        is_core=bool(body.get("is_core", False)),
        locked=bool(body.get("locked", False)),
        user_confirmed=bool(body.get("user_confirmed", False)),
        origin_type=body.get("origin_type", "manual"),
        origin_id=body.get("origin_id"),
        source_table=body.get("source_table"),
        source_id=body.get("source_id"),
    )
    return _ok(result, 201)


@cognitive_bp.patch("/memory/<int:memory_id>")
def update_memory(memory_id: int):
    """Edita uma memória existente."""
    body = request.get_json(silent=True) or {}
    try:
        result = memory.update_memory(memory_id, **body)
    except ValueError as exc:
        return _err(str(exc), 400)
    if not result:
        return _err("Memória não encontrada.", 404)
    return _ok(result)


@cognitive_bp.delete("/memory/<int:memory_id>")
def delete_memory(memory_id: int):
    """Remove uma memória, protegendo Core Memory salvo force=true."""
    force = request.args.get("force") == "true"
    try:
        ok = memory.delete_memory(memory_id, force=force)
    except ValueError as exc:
        return _err(str(exc), 409)
    if not ok:
        return _err("Memória não encontrada.", 404)
    return _ok({"success": True})


@cognitive_bp.patch("/memory/<int:memory_id>/core")
def set_core_memory(memory_id: int):
    """Fixa/desfixa uma memória como Core Memory."""
    body = request.get_json(silent=True) or {}
    enabled = bool(body.get("enabled", True))
    user_confirmed = bool(body.get("user_confirmed", True))
    result = memory.set_core(memory_id, enabled=enabled, user_confirmed=user_confirmed)
    if not result:
        return _err("Memória não encontrada.", 404)
    return _ok(result)


@cognitive_bp.get("/memory/recall")
def recall_memory():
    """Recupera memórias relevantes para uma consulta."""
    query = request.args.get("q", "").strip()
    if not query:
        return _err("Parâmetro 'q' é obrigatório.")

    types = request.args.getlist("type") or None
    limit = _int_param("limit", 8)
    data = memory.recall(
        query,
        memory_types=types,
        limit=limit,
        session_id=request.args.get("session_id"),
    )
    return _ok(data)


@cognitive_bp.delete("/memory/prune")
def prune_memories():
    """Remove memórias expiradas."""
    removed = memory.prune_expired()
    return _ok({"removed": removed})


@cognitive_bp.post("/memory/archive")
def archive_memories():
    """Move memórias antigas e pouco acessadas para Archive Memory."""
    body = request.get_json(silent=True) or {}
    archived = memory.archive_stale_memories(
        days_without_access=int(body.get("days_without_access", 90)),
        max_importance=float(body.get("max_importance", 0.55)),
    )
    return _ok({"archived": archived})


@cognitive_bp.post("/memory/consolidate/<session_id>")
def consolidate_session_memory(session_id: str):
    """Consolida memórias de curto → médio → longo prazo para uma sessão."""
    result = memory.consolidate_session(session_id)
    return _ok(result)


# ════════════════════════════════════════════════════════════════════════════
# PERFIL DO USUÁRIO
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/profile")
def get_user_profile():
    """Retorna perfil estruturado do usuário."""
    return _ok({
        "profile": user_profile.get_profile(),
        "context": user_profile.get_profile_context(),
    })


@cognitive_bp.post("/profile/extract")
def extract_user_profile():
    """Extrai fatos de perfil de um texto enviado manualmente."""
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return _err("Campo 'text' é obrigatório.")
    facts = user_profile.update_from_text(
        text,
        session_id=body.get("session_id"),
        source=body.get("source", "manual"),
    )
    return _ok({"facts": facts, "count": len(facts)}, 201)


# ════════════════════════════════════════════════════════════════════════════
# GRAFO DE CONHECIMENTO
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/graph")
def get_graph():
    """Retorna o grafo completo para o Obsidian/BrainMap."""
    limit = _int_param("limit", 200)
    return _ok(knowledge_graph.get_full_graph(limit=limit))


@cognitive_bp.get("/graph/entity/<path:name>")
def get_entity(name: str):
    """Retorna uma entidade específica com seus vizinhos."""
    depth = _int_param("depth", 1)
    data = knowledge_graph.get_neighbors(name, depth=depth)
    if not data:
        return _err(f"Entidade '{name}' não encontrada.", 404)
    return _ok(data)


@cognitive_bp.get("/graph/top")
def get_top_entities():
    """Entidades mais conectadas."""
    limit = _int_param("limit", 20)
    return _ok(knowledge_graph.get_most_connected(limit=limit))


@cognitive_bp.get("/graph/communities")
def get_graph_communities():
    """Retorna comunidades conceituais do Knowledge Graph."""
    query = request.args.get("q", "").strip()
    limit = _int_param("limit", 20)
    if query:
        return _ok(knowledge_graph.search_communities(query, limit=limit))
    return _ok(knowledge_graph.get_communities(limit=limit))


@cognitive_bp.post("/graph/entity")
def create_entity():
    """Cria ou atualiza uma entidade no grafo."""
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return _err("Campo 'name' é obrigatório.")

    entity = knowledge_graph.upsert_entity(
        name=name,
        entity_type=body.get("entity_type", "concept"),
        description=body.get("description"),
        importance=float(body.get("importance", 0.5)),
        metadata=body.get("metadata"),
    )
    return _ok(entity, 201)


@cognitive_bp.post("/graph/relation")
def create_relation():
    """Cria relação entre duas entidades."""
    body = request.get_json(silent=True) or {}
    source = (body.get("source") or "").strip()
    target = (body.get("target") or "").strip()
    if not source or not target:
        return _err("Campos 'source' e 'target' são obrigatórios.")

    result = knowledge_graph.add_relation(
        source_name=source,
        target_name=target,
        relation_type=body.get("relation_type", "related_to"),
        strength=float(body.get("strength", 0.5)),
    )
    if not result:
        return _err("Uma ou ambas as entidades não foram encontradas.", 404)
    return _ok(result, 201)


@cognitive_bp.post("/graph/detect")
def detect_graph():
    """Detecta entidades em um texto e registra no grafo."""
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return _err("Campo 'text' é obrigatório.")

    found = knowledge_graph.detect_and_register(text)
    return _ok({"detected": found, "count": len(found)})


# ════════════════════════════════════════════════════════════════════════════
# PROJETOS
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/projects")
def list_projects():
    """Lista todos os projetos."""
    status = request.args.get("status")
    return _ok(projects.get_all_projects(status=status))


@cognitive_bp.post("/projects")
def create_project():
    """Cria um novo projeto."""
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return _err("Campo 'name' é obrigatório.")

    proj = projects.create_project(
        name=name,
        description=body.get("description"),
        technologies=body.get("technologies") or [],
        objectives=body.get("objectives") or [],
        tags=body.get("tags") or [],
    )
    return _ok(proj, 201)


@cognitive_bp.get("/projects/<int:project_id>")
def get_project(project_id: int):
    """Retorna projeto completo com sessões e documentos."""
    proj = projects.get_project(project_id)
    if not proj:
        return _err("Projeto não encontrado.", 404)
    return _ok(proj)


@cognitive_bp.patch("/projects/<int:project_id>")
def update_project(project_id: int):
    """Atualiza campos do projeto."""
    body = request.get_json(silent=True) or {}
    proj = projects.update_project(project_id, **body)
    if not proj:
        return _err("Projeto não encontrado.", 404)
    return _ok(proj)


@cognitive_bp.delete("/projects/<int:project_id>")
def delete_project(project_id: int):
    """Remove um projeto."""
    ok = projects.delete_project(project_id)
    if not ok:
        return _err("Projeto não encontrado.", 404)
    return _ok({"success": True})


@cognitive_bp.post("/projects/<int:project_id>/link/<session_id>")
def link_session_to_project(project_id: int, session_id: str):
    """Vincula uma sessão a um projeto."""
    ok = projects.link_session(project_id, session_id)
    return _ok({"success": ok})


@cognitive_bp.delete("/projects/<int:project_id>/link/<session_id>")
def unlink_session_from_project(project_id: int, session_id: str):
    """Desvincula sessão do projeto."""
    ok = projects.unlink_session(project_id, session_id)
    return _ok({"success": ok})


@cognitive_bp.post("/projects/<int:project_id>/documents")
def add_project_document(project_id: int):
    """Adiciona documento ao projeto."""
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return _err("Campo 'title' é obrigatório.")

    doc = projects.add_document(
        project_id=project_id,
        title=title,
        doc_type=body.get("doc_type", "document"),
        knowledge_source_id=body.get("knowledge_source_id"),
    )
    return _ok(doc, 201)


@cognitive_bp.get("/projects/<int:project_id>/summary")
def project_summary(project_id: int):
    """Resumo completo do projeto."""
    result = summarizer.summarize_project(project_id)
    if result.get("error"):
        return _err(result["error"], 404)
    return _ok(result)


# ════════════════════════════════════════════════════════════════════════════
# TIMELINE
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/timeline")
def get_timeline():
    """Lista eventos da timeline com filtros."""
    start = request.args.get("start")
    end = request.args.get("end")
    types = request.args.getlist("type") or None
    limit = _int_param("limit", 100)
    data = timeline.get_timeline(start_date=start, end_date=end, event_types=types, limit=limit)
    return _ok(data)


@cognitive_bp.post("/timeline")
def add_timeline_event():
    """Adiciona evento manualmente."""
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return _err("Campo 'title' é obrigatório.")

    event = timeline.add_event(
        title=title,
        event_type=body.get("event_type", "milestone"),
        description=body.get("description"),
        event_date=body.get("event_date"),
        entity_id=body.get("entity_id"),
        entity_type=body.get("entity_type"),
        session_id=body.get("session_id"),
        importance=float(body.get("importance", 0.6)),
        tags=body.get("tags") or [],
    )
    return _ok(event, 201)


@cognitive_bp.get("/timeline/recent")
def recent_activity():
    """Atividade recente."""
    days = _int_param("days", 7)
    return _ok(timeline.get_recent_activity(days=days))


@cognitive_bp.get("/timeline/answer")
def answer_timeline():
    """Responde perguntas temporais em linguagem natural."""
    question = request.args.get("q", "").strip()
    if not question:
        return _err("Parâmetro 'q' é obrigatório.")
    result = timeline.answer_temporal_query(question)
    return _ok(result)


@cognitive_bp.get("/timeline/today")
def timeline_today():
    return _ok(timeline.get_today())


@cognitive_bp.get("/timeline/week")
def timeline_week():
    return _ok(timeline.get_this_week())


@cognitive_bp.get("/timeline/month")
def timeline_month():
    return _ok(timeline.get_this_month())


# ════════════════════════════════════════════════════════════════════════════
# INSIGHTS
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/insights")
def get_insights():
    """Lista insights pendentes."""
    include_read = request.args.get("include_read") == "true"
    limit = _int_param("limit", 10)
    return _ok(insights.get_all_insights(include_read=include_read, limit=limit))


@cognitive_bp.post("/insights/generate")
def generate_insights():
    """Gera todos os insights agora."""
    generated = insights.generate_all_insights()
    return _ok({"generated": len(generated), "insights": generated})


@cognitive_bp.patch("/insights/<int:insight_id>/read")
def mark_insight_read(insight_id: int):
    """Marca insight como lido."""
    ok = insights.mark_read(insight_id)
    if not ok:
        return _err("Insight não encontrado.", 404)
    return _ok({"success": True})


# ════════════════════════════════════════════════════════════════════════════
# RESUMOS
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/summary/session/<session_id>")
def summary_session(session_id: str):
    """Resumo de uma sessão."""
    use_llm = request.args.get("llm") == "true"
    result = summarizer.summarize_session(session_id, use_llm=use_llm)
    if result.get("error"):
        return _err(result["error"], 404)
    return _ok(result)


@cognitive_bp.get("/summary/session/<session_id>/persistent")
def persistent_summary(session_id: str):
    """Retorna o resumo persistente salvo de uma conversa."""
    result = summarizer.get_conversation_summary(session_id)
    if not result:
        return _ok({"session_id": session_id, "summary": "", "message_count": 0})
    return _ok(result)


@cognitive_bp.post("/summary/session/<session_id>/persistent")
def update_persistent_summary(session_id: str):
    """Força atualização do resumo persistente de uma conversa."""
    use_llm = request.args.get("llm") == "true"
    result = summarizer.maybe_update_conversation_summary(session_id, use_llm=use_llm)
    if not result:
        return _err("Resumo ainda não disponível para esta conversa.", 404)
    return _ok(result)


@cognitive_bp.get("/summary/daily")
def summary_daily():
    """Resumo do dia."""
    date = request.args.get("date")
    return _ok(summarizer.summarize_daily(date=date))


@cognitive_bp.get("/summary/weekly")
def summary_weekly():
    """Resumo da semana."""
    week = request.args.get("week")
    return _ok(summarizer.summarize_weekly(week_start=week))


@cognitive_bp.get("/summary/monthly")
def summary_monthly():
    """Resumo mensal."""
    month = request.args.get("month")
    return _ok(summarizer.summarize_monthly(year_month=month))


# ════════════════════════════════════════════════════════════════════════════
# BUSCA GLOBAL
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/search")
def global_search():
    """Busca unificada em memórias, projetos, timeline, conhecimento e grafo."""
    query = request.args.get("q", "").strip()
    if not query:
        return _err("Parâmetro 'q' é obrigatório.")

    session_id = request.args.get("session_id")
    limit = _int_param("limit", 30)
    results = search.global_search(query, limit=limit, session_id=session_id)
    return _ok(results)


# ════════════════════════════════════════════════════════════════════════════
# RAG
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.post("/rag/index/<int:knowledge_id>")
def rag_index(knowledge_id: int):
    """Indexa (ou re-indexa) um knowledge_source específico."""
    body = request.get_json(silent=True) or {}
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT content FROM knowledge_sources WHERE id=?", (knowledge_id,)
        ).fetchone()

    if not row:
        return _err("knowledge_source não encontrado.", 404)

    chunks = rag.index_document(knowledge_id, row["content"], force=bool(body.get("force", False)))
    return _ok({"knowledge_id": knowledge_id, "chunks_indexed": chunks})


@cognitive_bp.post("/rag/reindex-all")
def rag_reindex_all():
    """Re-indexa toda a base de conhecimento."""
    body = request.get_json(silent=True) or {}
    result = rag.index_all_knowledge(
        session_id=body.get("session_id"),
        force=bool(body.get("force", False)),
    )
    return _ok(result)


@cognitive_bp.get("/rag/search")
def rag_search():
    """Busca semântica direta nos chunks indexados."""
    query = request.args.get("q", "").strip()
    if not query:
        return _err("Parâmetro 'q' é obrigatório.")

    session_id = request.args.get("session_id")
    top_k = _int_param("top_k", 8)
    mode = request.args.get("mode", "hybrid")  # semantic | bm25 | hybrid

    if mode == "bm25":
        results = rag.bm25_search(query, top_k=top_k, session_id=session_id)
    elif mode == "semantic":
        results = rag.semantic_search(query, top_k=top_k, session_id=session_id)
    else:
        results = rag.hybrid_search(query, top_k=top_k, session_id=session_id)

    return _ok({"results": results, "mode": mode, "query": query})


@cognitive_bp.get("/rag/context")
def rag_context():
    """Contexto RAG formatado para injetar no LLM."""
    query = request.args.get("q", "").strip()
    if not query:
        return _err("Parâmetro 'q' é obrigatório.")

    session_id = request.args.get("session_id")
    top_k = _int_param("top_k", 6)
    context = rag.build_rag_context(query, session_id=session_id, top_k=top_k)
    return _ok({"context": context, "query": query})


# ════════════════════════════════════════════════════════════════════════════
# CODEBASE INDEXER
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.post("/codebase/index")
def index_codebase():
    """Indexa uma pasta de projeto local para busca estrutural de código."""
    body = request.get_json(silent=True) or {}
    project_root = (body.get("project_root") or "").strip()
    if not project_root:
        return _err("Campo 'project_root' é obrigatório.")
    try:
        result = codebase_indexer.index_codebase(
            project_root,
            max_files=int(body.get("max_files", 900)),
        )
    except Exception as exc:
        return _err(str(exc), 400)
    return _ok(result, 201)


@cognitive_bp.get("/codebase/search")
def search_codebase():
    """Busca funções, classes, rotas, imports e arquivos indexados."""
    query = request.args.get("q", "").strip()
    if not query:
        return _err("Parâmetro 'q' é obrigatório.")
    project_root = request.args.get("project_root")
    limit = _int_param("limit", 12)
    return _ok({
        "query": query,
        "results": codebase_indexer.search_codebase(query, project_root=project_root, limit=limit),
    })


# ════════════════════════════════════════════════════════════════════════════
# DETECTOR
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.post("/detect")
def detect_signals():
    """Detecta sinais cognitivos em um texto (API pública)."""
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return _err("Campo 'text' é obrigatório.")
    return _ok(detector.detect_learning_signals(text))


@cognitive_bp.post("/conversation/analyze")
def analyze_conversation_query():
    """Diagnostica intenção, query rewrite e contexto cognitivo sem chamar Ollama."""
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return _err("Campo 'text' é obrigatório.")
    session_id = body.get("session_id")
    history = []
    summary = None
    if session_id:
        try:
            import database
            history = database.get_recent_session_messages(session_id, limit=20)
            summary = summarizer.get_conversation_summary(session_id)
        except Exception:
            history = []
            summary = None
    result = conversation.build_conversation_context(
        user_text=text,
        session_id=session_id,
        history=history,
        conversation_summary=summary,
    )
    return _ok({
        "intent": result["intent"],
        "query": result["query"],
        "context_preview": result["context"][:3000],
        "results": result["results"][:8],
    })

# ════════════════════════════════════════════════════════════════════════════
# FOCUS (Produtividade) V2
# ════════════════════════════════════════════════════════════════════════════

@cognitive_bp.get("/focus")
def get_focus_tasks():
    try:
        tasks = focus.get_focus_tasks()
        return _ok(tasks)
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.post("/focus")
def create_focus_task():
    body = request.get_json(silent=True) or {}
    title = body.get("title", "").strip()
    if not title:
        return _err("O título da tarefa é obrigatório.", 400)
        
    try:
        task = focus.create_focus_task(
            title=title,
            category=body.get("category", "other"),
            priority=body.get("priority", "medium"),
            is_focus=body.get("is_focus", False),
            due_date=body.get("due_date"),
            item_type="REMINDER" if body.get("item_type") == "REMINDER" else "TASK",
            source=body.get("source", "manual"),
            confidence=body.get("confidence", 1.0),
            place_context=body.get("place_context", "anywhere"),
            trigger_on_arrival=body.get("trigger_on_arrival", False),
        )
        return _ok(task, 201)
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.patch("/focus/<int:task_id>")
def update_focus_task(task_id: int):
    body = request.get_json(silent=True) or {}
    try:
        task = focus.update_focus_task(task_id, body)
        return _ok(task)
    except ValueError as e:
        return _err(str(e), 404)
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.delete("/focus/<int:task_id>")
def delete_focus_task(task_id: int):
    try:
        success = focus.delete_focus_task(task_id)
        if not success:
            return _err("Task not found", 404)
        return _ok({"success": True})
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.post("/focus/analyze")
def analyze_focus_input():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "").strip()
    if not text:
        return _err("Escreva uma atualização antes de analisar.", 400)
        
    try:
        res = focus.analyze_focus_input(text)
        if res.get("error"):
            return _err("O Buds não conseguiu analisar esta atualização agora.", 503)
        return _ok(res)
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.post("/focus/apply")
def apply_focus_items():
    body = request.get_json(silent=True) or {}
    items = body.get("items", [])
    if not isinstance(items, list):
        return _err("A lista de alterações do Focus é inválida.", 400)
    
    results = []
    try:
        for item in items:
            if not isinstance(item, dict):
                continue
            action = item.get("action")
            if action == "create_task":
                t = focus.create_focus_task(
                    title=item.get("content", ""),
                    category=item.get("category", "other"),
                    priority=item.get("priority", "medium"),
                    due_date=item.get("due_date"),
                    item_type="REMINDER" if item.get("type") == "REMINDER" else "TASK",
                    source="focus_input",
                    confidence=item.get("confidence", 0.8),
                    place_context=item.get("place_context", "anywhere"),
                    trigger_on_arrival=item.get("trigger_on_arrival", False),
                )
                results.append({"type": "task", "id": t["id"]})
            elif action == "complete_task" and item.get("related_task_id"):
                t = focus.update_focus_task(item["related_task_id"], {"completed": True})
                results.append({"type": "task_update", "id": t["id"]})
            elif action == "save_idea":
                i = focus.create_focus_idea(content=item.get("content", ""))
                results.append({"type": "idea", "id": i["id"]})
            elif action == "save_decision":
                d = focus.create_focus_decision(content=item.get("content", ""))
                results.append({"type": "decision", "id": d["id"]})
            elif action == "save_memory":
                from cognitive import memory
                m = memory.save_memory(
                    item.get("content", ""),
                    memory_type="long",
                    importance=0.8,
                    user_confirmed=True,
                    origin_type="focus_input",
                    tags=["focus", "confirmed"],
                )
                results.append({"type": "memory", "id": m["id"]})
                
        return _ok({"applied": True, "results": results})
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.post("/focus/think")
def focus_think():
    body = request.get_json(silent=True) or {}
    query = body.get("query", "").strip()
    if not query:
        return _err("A pergunta do Focus é obrigatória.", 400)
        
    try:
        suggestion = focus.buds_think(query)
        return _ok({"suggestion": suggestion})
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.get("/focus/ideas")
def get_focus_ideas():
    return _ok(focus.get_focus_ideas())

@cognitive_bp.get("/focus/decisions")
def get_focus_decisions():
    return _ok(focus.get_focus_decisions())

@cognitive_bp.get("/focus/timeline")
def get_focus_timeline():
    return _ok(focus.get_focus_timeline())

@cognitive_bp.get("/focus/inbox")
def get_focus_inbox():
    return _ok(focus.get_focus_inbox())

@cognitive_bp.patch("/focus/inbox/<int:item_id>")
def update_focus_inbox(item_id: int):
    body = request.get_json(silent=True) or {}
    status = body.get("status")
    success = focus.resolve_focus_inbox_item(item_id, status)
    if success:
        return _ok({"success": True})
    return _err("Não foi possível atualizar este item da Buds Inbox.", 400)


# ── Buds Map / contexto de lugar ────────────────────────────────────────────

@cognitive_bp.get("/location")
def get_location_context():
    return _ok({
        "state": location.get_state(),
        "places": location.list_places(),
        "events": location.get_recent_events(limit=_int_param("limit", 30)),
        "policy": {
            "continuous_gps": False,
            "precise_only_on_demand": True,
            "coordinates_sent_to_model": False,
        },
    })


@cognitive_bp.post("/location/places")
def create_location_place():
    body = request.get_json(silent=True) or {}
    try:
        return _ok(location.save_place(
            name=body.get("name", ""),
            context=body.get("context", "other"),
            latitude=body.get("latitude"),
            longitude=body.get("longitude"),
            radius_m=body.get("radius_m", 180),
            enabled=body.get("enabled", True),
        ), 201)
    except (TypeError, ValueError) as exc:
        return _err(str(exc), 400)


@cognitive_bp.patch("/location/places/<int:place_id>")
def update_location_place(place_id: int):
    body = request.get_json(silent=True) or {}
    current = location.get_place(place_id)
    if not current:
        return _err("Lugar não encontrado.", 404)
    try:
        return _ok(location.save_place(
            place_id=place_id,
            name=body.get("name", current["name"]),
            context=body.get("context", current["context"]),
            latitude=body.get("latitude", current["latitude"]),
            longitude=body.get("longitude", current["longitude"]),
            radius_m=body.get("radius_m", current["radius_m"]),
            enabled=body.get("enabled", current["enabled"]),
        ))
    except (TypeError, ValueError) as exc:
        return _err(str(exc), 400)


@cognitive_bp.delete("/location/places/<int:place_id>")
def delete_location_place(place_id: int):
    if not location.delete_place(place_id):
        return _err("Lugar não encontrado.", 404)
    return _ok({"success": True})


@cognitive_bp.post("/location/sample")
def update_location_sample():
    body = request.get_json(silent=True) or {}
    try:
        return _ok(location.update_sample(
            body.get("latitude"),
            body.get("longitude"),
            accuracy_m=body.get("accuracy_m"),
            altitude_m=body.get("altitude_m"),
            speed_mps=body.get("speed_mps"),
            recorded_at=body.get("recorded_at"),
            source=body.get("source", "browser"),
        ))
    except (TypeError, ValueError) as exc:
        return _err(str(exc), 400)


@cognitive_bp.post("/location/context")
def set_location_context():
    body = request.get_json(silent=True) or {}
    return _ok(location.set_semantic_context(body.get("context", "unknown"), source="manual"))


@cognitive_bp.get("/location/routes")
def get_location_routes():
    return _ok(location.route_dashboard(limit=_int_param("limit", 20)))


@cognitive_bp.get("/location/routes/<int:route_id>")
def get_location_route(route_id: int):
    route = location.get_route(route_id, include_points=True)
    return _ok(route) if route else _err("Trajeto não encontrado.", 404)


@cognitive_bp.post("/location/routes/start")
def start_location_route():
    body = request.get_json(silent=True) or {}
    return _ok(location.start_route(body.get("name")), 201)


@cognitive_bp.post("/location/routes/stop")
def stop_location_route():
    route = location.finish_route()
    return _ok(route) if route else _err("Nenhum trajeto está sendo gravado.", 409)


@cognitive_bp.delete("/location/routes/<int:route_id>")
def delete_location_route(route_id: int):
    if not location.delete_route(route_id):
        return _err("Trajeto não encontrado.", 404)
    return _ok({"success": True})

# Retrocompatibilidade (opcional)
@cognitive_bp.post("/focus/braindump")
def process_brain_dump():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "").strip()
    if not text:
        return _err("Escreva uma atualização antes de processar.", 400)
    try:
        tasks = focus.process_brain_dump(text)
        return _ok({"tasks": tasks})
    except Exception as e:
        return _err(str(e), 500)

@cognitive_bp.post("/focus/organize")
def organize_my_day():
    try:
        # Repassa para o Buds Think
        suggestion = focus.buds_think("Por favor, sugira uma ordem para minhas tarefas.")
        return _ok({"suggestion": suggestion})
    except Exception as e:
        return _err(str(e), 500)
