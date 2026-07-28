# pyrefly: ignore [missing-import]
import sys

if __name__ == "__main__" and "--piper-cli" in sys.argv:
    # Entrada mínima usada pelo pacote desktop: encerra antes de carregar Flask,
    # banco, RAG e STT a cada frase sintetizada.
    sys.argv.remove("--piper-cli")
    from piper.__main__ import main as piper_main

    piper_main()
    raise SystemExit(0)

from flask import Flask, request, jsonify, Response, send_from_directory
import contextlib
import os
import platform
import json
import time
import re
import concurrent.futures
import uuid
from pathlib import Path
from typing import Optional

# Importações de agenty.py (reaproveitando lógica já existente)
from agenty import (
    stt_local,
    llm_ollama,
    llm_ollama_raw,
    llm_ollama_stream,
    tts_piper,
    OUT_DIR,
    OLLAMA_MODEL,
    get_ollama_models,
    format_web_context,
    is_google_search_configured,
    resolve_ollama_model,
    search_google,
)
import database
import local_backup
import remote_access
from storage import get_data_dir

# ── Camada Cognitiva (Second Brain) ──────────────────────────────────────────
import database_v2
from cognitive_api import cognitive_bp
from cognitive import detector as cognitive_detector
from cognitive import conversation as cognitive_conversation
from cognitive import finance as cognitive_finance
from cognitive import knowledge_graph
from cognitive import rag as cognitive_rag
from cognitive import response_safety
from cognitive import summarizer as cognitive_summarizer
from cognitive import user_profile
from performance import (
    DEEP_PATH,
    FAST_PATH,
    PerfTrace,
    budget_for_pipeline,
    classify_pipeline,
    clip_context,
    diagnostics_requested,
    select_model_for_pipeline,
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR.parent / "front-end" / "dist"
STATIC_DIR = FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.exists() else BASE_DIR / "static"
IS_WINDOWS = platform.system().lower() == "windows"
WINDOWS_PIPER_TTS_ENABLED = os.getenv("NEXUS_WINDOWS_PIPER_TTS", "0").lower() in {"1", "true", "yes", "sim"}
TTS_FUTURE_TIMEOUT = float(os.getenv("NEXUS_TTS_FUTURE_TIMEOUT", "2.5" if IS_WINDOWS else "8.0"))

app = Flask(__name__, static_folder=None)

# Inicializa as tabelas do banco de dados SQLite (existentes)
database.init_db()

# Inicializa as tabelas cognitivas do Second Brain (migração não-destrutiva)
database_v2.migrate()

# Registra o Blueprint da Camada Cognitiva
app.register_blueprint(cognitive_bp)

# Pool compartilhado para background cognition — evita acúmulo de threads daemon
_COGNITION_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=1 if IS_WINDOWS else 2,
    thread_name_prefix="aether-cognition",
)

# Pool dedicado ao TTS — roda Piper em paralelo ao streaming de tokens
# max_workers=2 cobre sobreposição de sentenças sem saturar CPU no M1
_TTS_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=1 if IS_WINDOWS else 2,
    thread_name_prefix="aether-tts",
)


@app.before_request
def enforce_api_security():
    """Valida a origem sempre e, em modo remoto, exige autenticação."""
    if not request.path.startswith("/api/"):
        return None

    origin = request.headers.get("Origin")
    if not remote_access.is_trusted_origin(
        origin,
        request_host=request.host,
        request_scheme=request.scheme,
        user_agent=request.headers.get("User-Agent", ""),
    ):
        return jsonify({
            "error": "Origem não autorizada para acessar a API do Aether Memory.",
        }), 403

    if request.method == "OPTIONS":
        return app.make_default_options_response()
    if not remote_access.REMOTE_MODE:
        return None
    if request.path in {
        "/api/health",
        "/api/auth/login",
        "/api/auth/status",
    }:
        return None
    if not remote_access.AUTH_TOKEN:
        return jsonify({
            "error": "NEXUS_REMOTE_MODE está ativo, mas NEXUS_AUTH_TOKEN não foi configurado.",
            "auth_required": True,
            "remote_config_required": True,
        }), 503
    token = remote_access.request_token(request)
    if not token or not remote_access.validate_bearer_token(token):
        return jsonify({
            "error": "Token de acesso remoto ausente ou inválido.",
            "auth_required": True,
        }), 401
    return None


@app.after_request
def apply_cors_headers(response):
    """Expõe CORS somente para origens explicitamente confiáveis."""
    if not request.path.startswith("/api/"):
        return response
    origin = request.headers.get("Origin")
    if not origin or not remote_access.is_trusted_origin(
        origin,
        request_host=request.host,
        request_scheme=request.scheme,
        user_agent=request.headers.get("User-Agent", ""),
    ):
        return response

    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, Authorization, X-Nexus-Token"
    )
    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    )
    return response


def sse_event(payload: dict) -> str:
    """Formata um payload JSON como evento SSE compatível com Python 3.x."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def gerar_audio_url(texto: str, filename: str) -> Optional[str]:
    """Tenta gerar TTS; se falhar, mantém o chat por texto funcionando."""
    out_file = OUT_DIR / filename
    try:
        tts_piper(texto, out_file)
        return f"/api/audio/{filename}"
    except Exception as e:
        print(f"[TTS] Áudio ignorado: {e}")
        return None


_AUDIO_EXT_BY_MIME = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
}
_ALLOWED_AUDIO_EXTS = set(_AUDIO_EXT_BY_MIME.values())


def save_uploaded_audio(audio_file) -> Path:
    """Salva áudio enviado pelo browser preservando o formato real do arquivo."""
    raw_suffix = Path(audio_file.filename or "").suffix.lower()
    mimetype = (audio_file.mimetype or "").split(";")[0].lower()
    suffix = raw_suffix if raw_suffix in _ALLOWED_AUDIO_EXTS else _AUDIO_EXT_BY_MIME.get(mimetype, ".webm")
    filename = f"upload_{int(time.time())}_{uuid.uuid4().hex[:8]}{suffix}"
    filepath = OUT_DIR / filename
    audio_file.save(str(filepath))
    return filepath


# Importações do pipeline de ingestão cognitivo (eliminadas duplicatas locais)
from cognitive.ingestion import (
    clean_imported_text,
    extract_topics,
    make_knowledge_title,
    make_learning_title,
    summarize_imported_text,
    analyze_imported_document,
    extract_pdf_text,
    fetch_url_text,
)


def prepare_session_context(
    session_id: Optional[str],
    user_text: str,
    *,
    pipeline: str = "STANDARD_PATH",
    selected_model: Optional[str] = None,
    trace: Optional[PerfTrace] = None,
):
    history = []
    title_update = None
    budget = budget_for_pipeline(pipeline, selected_model)

    if not session_id:
        return history, title_update, ""

    with trace.span("db_recent_history") if trace else _nullcontext():
        history = database.get_recent_session_messages(session_id, limit=budget["history_messages"])
    if trace:
        trace.set("history_messages_loaded", len(history))
        trace.set("history_message_limit", budget["history_messages"])
    with trace.span("conversation_summary_load") if trace else _nullcontext():
        conversation_summary = cognitive_summarizer.get_conversation_summary(session_id)
    if not history:
        title = database.make_title_from_message(user_text)
        title_update = database.update_session_title(session_id, title)

    with trace.span("db_save_user_message") if trace else _nullcontext():
        database.add_message(session_id, "user", user_text)

    if pipeline == FAST_PATH:
        if trace:
            trace.set("context_skipped_reason", "fast_path")
            trace.set("knowledge_context_chars", 0)
        return history, title_update, ""

    try:
        with trace.span("conversation_context") if trace else _nullcontext():
            conversation_pipeline = cognitive_conversation.build_conversation_context(
                user_text=user_text,
                session_id=session_id,
                history=history,
                conversation_summary=conversation_summary,
            )
        knowledge_context = conversation_pipeline.get("context", "")
    except Exception as pipeline_err:
        print(f"[ConversationPipeline] Fallback para contexto antigo: {pipeline_err}")
        with trace.span("legacy_context_fallback") if trace else _nullcontext():
            retrieval_query = build_contextual_retrieval_query(user_text, history, session_id)
            knowledge_context = database.build_knowledge_context(session_id, query=retrieval_query)
            rag_context = cognitive_rag.build_rag_context(retrieval_query, session_id=session_id, top_k=4)
        if rag_context:
            knowledge_context = f"{knowledge_context}\n\n{rag_context}" if knowledge_context else rag_context
        if conversation_summary and conversation_summary.get("summary"):
            summary_context = (
                "Resumo persistente da conversa longa:\n"
                f"{conversation_summary['summary']}\n"
                f"(mensagens resumidas: {conversation_summary.get('message_count', 0)})"
            )
            knowledge_context = f"{summary_context}\n\n{knowledge_context}" if knowledge_context else summary_context

    knowledge_context = clip_context(knowledge_context, budget["context_chars"])
    if trace:
        trace.set("knowledge_context_chars", len(knowledge_context))
    return history, title_update, knowledge_context


@contextlib.contextmanager
def _nullcontext():
    yield


def _format_person_name(name: str) -> str:
    return " ".join(part.capitalize() for part in str(name or "").split())


def _get_profile_name() -> Optional[str]:
    profile = user_profile.get_profile(limit_per_key=1)
    names = profile.get("name") or []
    if not names:
        return None
    return _format_person_name(names[0].get("fact_value", ""))


def get_direct_profile_reply(user_text: str, session_id: Optional[str]) -> Optional[str]:
    """Responde fatos simples do perfil sem depender do LLM."""
    clean = re.sub(r"\s+", " ", user_text or "").strip()
    lower = clean.lower()

    asks_identity = bool(re.search(
        r"\b(quem (?:é|e) você|quem (?:é|e) voce|qual (?:é|e) (?:o )?seu nome|como você se chama|como voce se chama|quem é o aether|quem e o aether)\b",
        lower,
    ))
    if asks_identity:
        return _aether_identity_reply()

    facts = user_profile.update_from_text(clean, session_id=session_id)
    name_fact = next((fact for fact in facts if fact.get("fact_key") == "name"), None)
    if name_fact:
        name = _format_person_name(name_fact.get("fact_value", ""))
        return f"Entendi, seu nome é {name}. Vou lembrar disso."

    asks_name = bool(re.search(
        r"\b(qual (?:é|e) o meu nome|sabe meu nome|meu nome\?|como eu me chamo|quem sou eu)\b",
        lower,
    ))
    if asks_name:
        name = _get_profile_name()
        if name:
            return f"Seu nome é {name}."
        return "Ainda não tenho seu nome salvo. Se quiser, me diga: meu nome é ..."

    asks_profile = bool(re.search(r"\b(o que você sabe sobre mim|o que voce sabe sobre mim|você me conhece|voce me conhece|meu perfil)\b", lower))
    if asks_profile:
        context = user_profile.get_profile_context()
        if context:
            return f"Isso é o que tenho salvo sobre você:\n{context}"
        return "Ainda não tenho informações salvas sobre você."

    return None


def _model_personality(model: str) -> tuple[str, str]:
    model_lower = (model or "").lower()
    if "14b" in model_lower:
        return "Mais potente", "melhor para raciocínio mais pesado, auditorias e análises longas; tende a ser mais lento."
    if "7b" in model_lower:
        return "Padrão", "equilibra qualidade e velocidade para conversas, código e explicações moderadas."
    if "3b" in model_lower:
        return "Rápido", "mais leve para respostas curtas, menor consumo de RAM/CPU/GPU e menor aquecimento."
    return "Personalizado", "modelo local do Ollama selecionado no Aether Memory."


def _pipeline_description(pipeline: str) -> str:
    labels = {
        FAST_PATH: "FAST_PATH: contexto mínimo, sem RAG/grafo/reflection, pensado para conversa simples.",
        "STANDARD_PATH": "STANDARD_PATH: usa memória e contexto seletivo quando a pergunta precisa.",
        DEEP_PATH: "DEEP_PATH: usa contexto maior e camadas cognitivas mais completas para tarefas difíceis.",
    }
    return labels.get(pipeline, pipeline or "pipeline padrão")


def _aether_identity_reply(
    selected_model: str = "",
    pipeline: str = "",
    *,
    include_creator: bool = False,
    include_name: bool = False,
    include_difference: bool = False,
    include_runtime: bool = False,
) -> str:
    first_line = "Eu sou o Aether Memory, ou Aether."
    if include_creator:
        first_line += " Fui criado pelo Vitor."

    lines = [first_line]
    if include_name:
        lines.append(
            "Meu nome vem de Aether, o éter: o quinto elemento da filosofia grega, "
            "associado ao espaço, ao conhecimento e ao campo onde memórias e conexões podem existir."
        )
    if include_difference:
        lines.append(
            "Meu diferencial é ser um assistente local-first com memória SQLite, RAG, Knowledge Graph, "
            "Core Memory, Obsidian visual, importação de documentos/codebase, voz e backup portátil. "
            "Eu não sou só o modelo que responde texto; sou o sistema inteiro que organiza e usa esse conhecimento local."
        )
    if include_runtime:
        lines.append(
            "Quando o Windows mostra DeepSeek, Qwen, Llama ou outro nome do Ollama, isso é apenas o meu motor local "
            "de geração de texto nesta execução, não minha identidade."
        )
        model = selected_model or "não informado"
        lines.append(f"Agora estou usando o modelo Ollama `{model}` como motor local.")
    return "\n\n".join(lines)


def get_direct_self_reply(user_text: str, selected_model: str, pipeline: str) -> Optional[str]:
    """Responde dúvidas sobre o próprio Aether sem depender do LLM."""
    clean = re.sub(r"\s+", " ", user_text or "").strip()
    lower = clean.lower()

    asks_identity = bool(re.search(
        r"\b(quem (?:é|e) voc[eê]|quem (?:é|e) voce|quem (?:é|e) o aether|quem e o aether|qual (?:é|e) (?:o )?seu nome|como voc[eê] se chama|como voce se chama|que ia (?:é|e) voc[eê]|que ia (?:é|e) voce)\b",
        lower,
    ))
    asks_creator = bool(re.search(
        r"\b(quem .{0,30}(criou|fez|desenvolveu|programou)|criado por quem|feito por quem|seu criador|teu criador|quem (?:é|e) seu dono|quem (?:é|e) o vitor)\b",
        lower,
    ))
    asks_name_meaning = bool(re.search(
        r"\b(por que .{0,25}(nome|chama|aether)|porque .{0,25}(nome|chama|aether)|significado .{0,25}(nome|aether)|o que significa aether|explica .{0,25}nome)\b",
        lower,
    ))
    asks_difference = bool(re.search(
        r"\b(diferencial|diferente|te diferencia|o que voc[eê] faz de diferente|o que voce faz de diferente|por que usar voc[eê]|por que usar voce)\b",
        lower,
    ))
    asks_life = bool(re.search(
        r"\b(vida pr[oó]pria|consci[eê]ncia|consciente|sentimentos?|voc[eê] sente|voce sente|tem vida|est[aá] vivo|esta vivo)\b",
        lower,
    ))
    mentions_base_model_as_identity = any(
        model_name in lower
        for model_name in ("deepseek", "qwen", "llama", "mistral", "gemma", "phi", "codellama", "ollama")
    ) and bool(re.search(r"\b(voc[eê]|voce|vc|tu|é|e|sou|modelo|ia|assistente)\b", lower))

    if asks_life:
        return (
            "Não tenho vida própria nem consciência. Eu funciono como o Aether Memory: "
            "um assistente local que conversa, usa memória/contexto do projeto e responde pelo motor do Ollama quando precisa gerar texto."
        )

    if asks_identity or asks_creator or asks_name_meaning or asks_difference or mentions_base_model_as_identity:
        include_runtime = mentions_base_model_as_identity or "modelo" in lower or "ollama" in lower or "vers" in lower
        return _aether_identity_reply(
            selected_model,
            pipeline,
            include_creator=asks_creator,
            include_name=asks_name_meaning,
            include_difference=asks_difference,
            include_runtime=include_runtime,
        )

    asks_model = bool(re.search(
        r"\b(qual|que|em qual|em que).{0,28}(modelo|modo|vers[aã]o|ia).{0,40}(voc[eê]|voce|est[aá]|usa|usando|rodando)\b"
        r"|\b(voc[eê]|voce).{0,28}(modelo|modo|vers[aã]o).{0,40}(usa|est[aá]|rodando)\b"
        r"|\b(est[aá] em qual modo|qual modo voc[eê] est[aá]|qual modelo est[aá] ativo)\b"
        r"|\b(qual (?:é|e)?\s*(?:a\s+)?sua\s+(?:vers[aã]o|modelo|modo)|qual (?:é|e)?\s*(?:a\s+)?(?:vers[aã]o|modelo|modo) atual|qual modelo|qual vers[aã]o|modelo ativo)\b",
        lower,
    ))
    if asks_model:
        label, hint = _model_personality(selected_model)
        return (
            f"Sou o Aether Memory. Agora estou usando o modelo Ollama `{selected_model}` como motor local de texto. "
            f"No Aether, isso está no modo **{label}**: {hint}"
        )

    asks_obsidian = "obsidian" in lower and bool(re.search(
        r"\b(o que|oque|explica|explique|serve|faz|funciona|c[eé]rebro|mem[oó]ria|bolinha|grafo)\b",
        lower,
    ))
    if asks_obsidian:
        return (
            "A Obsidian do Aether é o meu mapa visual de memória, inspirado em um segundo cérebro. "
            "Ela não é só decoração: mostra aquilo que eu salvei e relacionei localmente.\n\n"
            "- Cada ponto pode representar uma memória, documento, entidade, tópico, projeto ou item da codebase.\n"
            "- As conexões representam relações do Knowledge Graph, como assuntos relacionados, tecnologias usadas e aprendizados vindos de PDFs/textos.\n"
            "- Quando você importa PDFs, textos ou ensina uma codebase, esses conteúdos viram fontes, chunks, tópicos e entidades que podem aparecer no grafo.\n"
            "- Ao clicar em memórias, você consegue ver origem, importância, tags e controlar o que fica fixado como Core Memory.\n\n"
            "Em resumo: o chat conversa, a memória guarda, e a Obsidian mostra o cérebro do Aether se formando."
        )

    return None


def get_direct_reply(
    user_text: str,
    session_id: Optional[str],
    history: Optional[list[dict]] = None,
    *,
    selected_model: str = "",
    pipeline: str = "STANDARD_PATH",
) -> Optional[str]:
    """Respostas determinísticas para casos onde chamar o modelo tende a inventar."""
    self_reply = get_direct_self_reply(user_text, selected_model, pipeline)
    if self_reply:
        return self_reply
    profile_reply = get_direct_profile_reply(user_text, session_id)
    if profile_reply:
        return profile_reply
    continuity_reply = cognitive_conversation.answer_recent_assistant_reference(user_text, history or [])
    if continuity_reply:
        return continuity_reply
    return cognitive_finance.build_financial_reply(user_text, history=history)


def process_post_chat_cognition(session_id: str, user_text: str, ai_text: str) -> None:
    """Processa memória, perfil e resumo sem segurar a resposta do chat."""
    def _detect():
        try:
            cognitive_detector.process_chat(
                session_id=session_id,
                user_text=user_text,
                ai_text=ai_text,
            )
        except Exception as exc:
            print(f"[Detector] Falha no background: {exc}")

    def _summarize_later():
        try:
            cognitive_summarizer.maybe_update_conversation_summary(session_id)
        except Exception as exc:
            print(f"[Summarizer] Resumo assíncrono ignorado: {exc}")

    _COGNITION_POOL.submit(_detect)
    _COGNITION_POOL.submit(_summarize_later)


VAGUE_REFERENCE_WORDS = {
    "isso", "isto", "esse", "essa", "ele", "ela", "eles", "elas", "nele", "nela",
    "disso", "desse", "dessa", "aquilo", "lá", "la", "aqui", "tambem", "também",
}


def is_vague_user_text(text: str) -> bool:
    """Detecta perguntas dependentes de contexto, comuns em conversa natural."""
    lower = (text or "").lower().strip()
    words = re.findall(r"[a-zA-ZÀ-ÿ0-9_+-]+", lower)
    if len(words) <= 4:
        return True
    if any(word in VAGUE_REFERENCE_WORDS for word in words):
        return True
    return bool(re.search(r"\b(e sobre|e o|e a|o pdf|do pdf|o arquivo|esse arquivo|o documento|aprendeu)\b", lower))


def build_contextual_retrieval_query(user_text: str, history: list[dict], session_id: Optional[str]) -> str:
    """
    Amplia perguntas vagas com histórico e títulos de conhecimento.
    A pergunta original continua intacta para o LLM; isso só melhora a busca/RAG.
    """
    user_text = (user_text or "").strip()
    if not session_id:
        return user_text

    parts = [user_text]
    if is_vague_user_text(user_text):
        recent_user_messages = [
            str(item.get("text", "")).strip()
            for item in history[-6:]
            if item.get("sender") == "user" and str(item.get("text", "")).strip()
        ]
        if recent_user_messages:
            parts.append("Contexto recente: " + " ".join(recent_user_messages[-3:]))

    try:
        sources = database.get_session_knowledge(session_id, limit=8)
    except Exception:
        sources = []

    if sources and (is_vague_user_text(user_text) or re.search(r"\b(pdf|arquivo|documento|aprendeu|material)\b", user_text.lower())):
        source_signals = []
        for source in sources[:6]:
            topics = ", ".join(source.get("topics") or [])
            source_signals.append(
                f"{source.get('title', '')} {source.get('source_name', '')} {topics} {source.get('summary', '')[:260]}"
            )
        parts.append("Materiais importados disponíveis: " + " ".join(source_signals))

    return "\n".join(part for part in parts if part.strip())[:3000]


# ====== ROTA PRINCIPAL - SERVE O FRONT-END ======

@app.route('/')
def index():
    """Serve o build React ou explica como gerá-lo no ambiente de desenvolvimento."""
    if not (FRONTEND_DIST_DIR / "index.html").is_file():
        return jsonify({
            "error": "Frontend não compilado.",
            "detail": "Execute `npm run build` em front-end ou use `npm run dev` durante o desenvolvimento.",
        }), 503
    return send_from_directory(FRONTEND_DIST_DIR, 'index.html')


@app.route('/assets/<path:filename>')
def frontend_assets(filename):
    """Serve os arquivos gerados pelo Vite em front-end/dist/assets."""
    return send_from_directory(FRONTEND_DIST_DIR / "assets", filename)


@app.route('/favicon.svg')
@app.route('/icons.svg')
@app.route('/nexus-icon.svg')
def frontend_public_asset():
    """Serve ícones públicos do Front-end pela mesma porta do Flask."""
    requested = request.path.lstrip("/")
    filename = "favicon.svg" if requested == "nexus-icon.svg" else requested
    return send_from_directory(FRONTEND_DIST_DIR, filename)


@app.route('/manifest.webmanifest')
@app.route('/sw.js')
def pwa_asset():
    """Serve arquivos PWA na raiz, como navegadores mobile esperam."""
    return send_from_directory(FRONTEND_DIST_DIR, request.path.lstrip("/"))


@app.route('/api/health', methods=['GET'])
def api_health():
    """Health check leve para LAN/VPN/Tailscale e tela de boot."""
    rag_ok = True
    graph_ok = True
    try:
        cognitive_rag.get_stats()
    except Exception:
        rag_ok = False
    try:
        knowledge_graph.get_stats()
    except Exception:
        graph_ok = False

    token = remote_access.request_token(request)
    session = remote_access.request_session(request)
    authenticated = remote_access.validate_bearer_token(token or "")
    return jsonify({
        "status": "online",
        "ollama": remote_access.is_ollama_online(),
        "rag": rag_ok,
        "knowledge_graph": graph_ok,
        "remote": remote_access.get_remote_config(),
        "authenticated": authenticated,
        "auth_mode": session.get("auth_mode"),
        "user_id": session.get("user_id"),
        "email": session.get("email"),
    }), 200


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    token = remote_access.request_token(request)
    session = remote_access.request_session(request)
    return jsonify({
        "remote_mode": remote_access.REMOTE_MODE,
        "auth_required": remote_access.REMOTE_MODE,
        "auth_configured": bool(remote_access.AUTH_TOKEN),
        "authenticated": remote_access.validate_bearer_token(token or ""),
        "auth_mode": session.get("auth_mode"),
        "user_id": session.get("user_id"),
        "email": session.get("email"),
    }), 200


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    if not remote_access.REMOTE_MODE:
        return jsonify({"success": True, "remote_mode": False}), 200
    if not remote_access.AUTH_TOKEN:
        return jsonify({
            "error": "Configure NEXUS_AUTH_TOKEN antes de habilitar acesso remoto.",
            "remote_config_required": True,
        }), 503

    data = request.get_json(silent=True) or {}
    token = str(data.get("token", "")).strip()
    if not remote_access.validate_bearer_token(token):
        return jsonify({"error": "Token inválido."}), 401

    session = remote_access.create_session_token(label=str(data.get("label", "mobile")))
    return jsonify({"success": True, **session}), 200


@app.route('/api/auth/local', methods=['POST'])
def auth_local():
    """Cria uma sessão local do Aether Memory sem exigir token técnico."""
    session = remote_access.create_session_token(
        label=str((request.get_json(silent=True) or {}).get("label", "local")),
        auth_mode="local",
    )
    return jsonify({"success": True, **session}), 200


# ====== ENDPOINTS DE HISTÓRICO (CRUD SESSÕES) ======

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Retorna todas as sessões de chat em ordem cronológica reversa."""
    try:
        sessions = database.get_all_sessions()
        return jsonify(sessions), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    """Retorna configurações públicas usadas pelo Front-end."""
    models = get_ollama_models()
    default_model = OLLAMA_MODEL if OLLAMA_MODEL in models else (models[0] if models else OLLAMA_MODEL)
    return jsonify({
        "model": default_model,
        "models": models,
        "ollama_url": remote_access.OLLAMA_URL,
        "google_search_available": is_google_search_configured(),
        "data_dir": str(get_data_dir()),
        "remote": remote_access.get_remote_config(),
    }), 200


@app.route('/api/local-backup/export', methods=['GET'])
def export_local_backup():
    """Baixa um backup JSON com toda a memória local do Aether."""
    try:
        payload = local_backup.export_backup()
        body = json.dumps(payload, ensure_ascii=False)
        filename = local_backup.make_backup_filename()
        return Response(
            body,
            mimetype="application/json; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-store",
            },
        )
    except Exception as exc:
        return jsonify({"error": f"Falha ao exportar backup local: {exc}"}), 500


@app.route('/api/local-backup/status', methods=['GET'])
def get_local_backup_status():
    """Retorna contagem dos dados locais que entram no backup portátil."""
    try:
        return jsonify(local_backup.get_status()), 200
    except Exception as exc:
        return jsonify({"error": f"Falha ao ler status do backup local: {exc}"}), 500


@app.route('/api/local-backup/import', methods=['POST'])
def import_local_backup():
    """Importa um backup JSON do Aether em modo merge, sem apagar dados locais."""
    try:
        if "file" in request.files:
            raw = request.files["file"].read()
            payload = json.loads(raw.decode("utf-8"))
        else:
            payload = request.get_json(silent=True) or {}

        result = local_backup.import_backup(payload)
        # Garante FTS/triggers/colunas novas após importar backups antigos.
        database_v2.migrate()
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Falha ao importar backup local: {exc}"}), 500


def get_requested_model() -> str:
    """Lê o modelo escolhido no front-end e limita aos modelos permitidos."""
    data = request.get_json(silent=True) if request.is_json else {}
    data = data or {}
    requested = request.form.get("model") or data.get("model")
    return resolve_ollama_model(requested)


def get_requested_web_search() -> bool:
    """Lê se a pergunta deve consultar o Google antes de chamar o modelo."""
    data = request.get_json(silent=True) if request.is_json else {}
    data = data or {}
    value = request.form.get("web_search")
    if value is None:
        value = data.get("web_search")
    return str(value).lower() in {"1", "true", "yes", "sim"}


def get_requested_tts() -> bool:
    """Lê se o front-end quer receber arquivos de áudio gerados pelo backend."""
    if IS_WINDOWS and not WINDOWS_PIPER_TTS_ENABLED:
        return False

    data = request.get_json(silent=True) if request.is_json else {}
    data = data or {}
    value = request.form.get("tts")
    if value is None:
        value = data.get("tts", False)
    return str(value).lower() in {"1", "true", "yes", "sim"}


@app.route('/api/sessions', methods=['POST'])
def create_session():
    """Cria uma nova sessão de chat com título opcional."""
    try:
        data = request.json or {}
        title = data.get("title")
        session = database.create_session(title)
        return jsonify(session), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Deleta uma sessão de chat e todas as mensagens associadas (cascade delete)."""
    try:
        database.delete_session(session_id)
        return jsonify({"success": True, "message": "Sessão deletada com sucesso!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sessions/<session_id>', methods=['PATCH'])
def update_session(session_id):
    """Atualiza metadados de uma sessão, como o título."""
    try:
        data = request.json or {}
        title = data.get("title", "")
        session = database.update_session_title(session_id, title)
        return jsonify(session), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sessions/<session_id>/messages', methods=['GET'])
def get_session_messages(session_id):
    """Retorna todas as mensagens pertencentes a uma sessão específica."""
    try:
        messages = database.get_session_messages(session_id)
        return jsonify(messages), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sessions/<session_id>/knowledge', methods=['GET'])
def get_session_knowledge(session_id):
    """Lista PDFs, páginas e textos importados para a sessão."""
    try:
        return jsonify(database.get_session_knowledge(session_id)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sessions/<session_id>/knowledge', methods=['POST'])
def import_session_knowledge(session_id):
    """Importa arquivo, texto, URL ou busca Google como conhecimento da conversa."""
    try:
        if not database.get_session(session_id):
            return jsonify({"error": "Sessão não encontrada."}), 404

        title = request.form.get("title", "").strip()
        has_custom_title = bool(title)
        fallback_title = "Conhecimento importado"
        source_type = "texto"
        source_name = "manual"
        content = ""

        if "file" in request.files:
            uploaded = request.files["file"]
            source_name = uploaded.filename or "arquivo"
            fallback_title = make_knowledge_title(source_name)
            suffix = Path(source_name).suffix.lower()
            source_type = "pdf" if suffix == ".pdf" else "arquivo"
            if suffix == ".pdf":
                content = extract_pdf_text(uploaded)
            else:
                raw = uploaded.read()
                content = clean_imported_text(raw.decode("utf-8", errors="ignore"))
        else:
            payload = request.get_json(silent=True) if request.is_json else {}
            payload = payload or request.form
            url = (payload.get("url") or "").strip()
            query = (payload.get("query") or "").strip()
            text = (payload.get("text") or "").strip()
            payload_title = (payload.get("title") or "").strip()
            if payload_title and not title:
                title = payload_title
                has_custom_title = True

            if url:
                source_type = "url"
                source_name = url
                content = fetch_url_text(url)
                fallback_title = make_knowledge_title(content, fallback=url)
            elif query:
                source_type = "pesquisa"
                source_name = query
                results = search_google(query)
                content = format_web_context(results)
                fallback_title = make_knowledge_title(query, fallback="Pesquisa importada")
            else:
                source_type = "texto"
                source_name = "texto colado"
                content = clean_imported_text(text)
                fallback_title = make_knowledge_title(content)

        if len(content) < 40:
            return jsonify({"error": "Não consegui extrair texto suficiente dessa fonte."}), 400

        content = content[:30000]
        topics = extract_topics(content)
        summary = summarize_imported_text(content)
        intelligence = analyze_imported_document(content, source_type, source_name, topics)
        if not has_custom_title:
            title = make_learning_title(topics, summary, fallback=fallback_title or make_knowledge_title(source_name))
        item = database.add_knowledge_source(
            session_id=session_id,
            title=title,
            source_type=source_type,
            source_name=source_name,
            summary=summary,
            content=content,
            topics=topics,
            executive_summary=intelligence["executive_summary"],
            technical_summary=intelligence["technical_summary"],
            suggested_questions=intelligence["suggested_questions"],
            detected_entities=intelligence["detected_entities"],
            metadata_json=intelligence["metadata"],
        )
        try:
            item["rag_chunks"] = cognitive_rag.index_document(item["id"], content, session_id=session_id)
            for entity in intelligence["detected_entities"][:8]:
                knowledge_graph.upsert_entity(entity, "concept", importance=0.55, metadata={"source": "knowledge_import"})
        except Exception as rag_error:
            print(f"[RAG] Indexação ignorada para knowledge_source {item['id']}: {rag_error}")
            item["rag_chunks"] = 0
        return jsonify(item), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ====== ENDPOINTS DE CHAT E MULTIMÍDIA ======

@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Endpoint síncrono para enviar texto ou áudio.
    Salva automaticamente a interação no banco se session_id for enviado.
    """
    session_id = request.form.get("session_id") or (request.json.get("session_id") if request.is_json else None)
    selected_model = get_requested_model()
    should_search_web = get_requested_web_search()
    should_generate_tts = get_requested_tts()
    
    user_text = ""
    # Se receber um arquivo de áudio
    if 'audio' in request.files:
        audio_file = request.files['audio']
        filepath = save_uploaded_audio(audio_file)
        user_text = stt_local(filepath)
    # Se receber texto em formato JSON
    elif request.is_json:
        user_text = request.json.get("text", "")
    # Se receber texto em formulário tradicional
    else:
        user_text = request.form.get("text", "")

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    diagnostics = diagnostics_requested(request.args, request.headers)
    pipeline = classify_pipeline(
        user_text,
        web_search=should_search_web,
        has_audio="audio" in request.files,
    )
    selected_model = select_model_for_pipeline(selected_model, pipeline, get_ollama_models())
    trace = PerfTrace(route="/api/chat", pipeline=pipeline, model=selected_model, diagnostics=diagnostics)
    trace.set("web_search", should_search_web)
    trace.set("tts_requested", should_generate_tts)

    try:
        history, title_update, knowledge_context = prepare_session_context(
            session_id,
            user_text,
            pipeline=pipeline,
            selected_model=selected_model,
            trace=trace,
        )
        with trace.span("direct_reply"):
            direct_reply = get_direct_reply(
                user_text,
                session_id,
                history,
                selected_model=selected_model,
                pipeline=pipeline,
            )

        web_results = []
        web_context = None
        if should_search_web and not direct_reply:
            with trace.span("web_search"):
                web_results = search_google(user_text)
                web_context = format_web_context(web_results)

        if direct_reply:
            reply = direct_reply
        else:
            # 1. Envia o texto para a IA (Ollama)
            reply = llm_ollama(
                user_text,
                history,
                selected_model,
                web_context,
                knowledge_context,
                pipeline=pipeline,
                trace=trace,
            )
            if not reply:
                return jsonify({"error": "Nenhuma resposta foi obtida da IA."}), 500
            if pipeline == DEEP_PATH and budget_for_pipeline(pipeline).get("reflection"):
                with trace.span("reflection"):
                    reply = cognitive_conversation.maybe_refine_response(
                        user_text=user_text,
                        draft=reply,
                        context=knowledge_context,
                        llm_call=lambda prompt: llm_ollama_raw(
                            prompt,
                            selected_model,
                            num_predict=420,
                            pipeline=pipeline,
                            trace=trace,
                        ),
                    )
        reply = response_safety.sanitize_response(reply, user_text=user_text)
        reply = cognitive_finance.repair_financial_response(user_text, reply, history)
        reply = response_safety.sanitize_response(reply, user_text=user_text)

        # 2. Gera a resposta por voz usando o Piper
        audio_url = None
        if should_generate_tts:
            with trace.span("tts_full_response"):
                audio_filename = f"reply_{int(time.time())}.wav"
                audio_url = gerar_audio_url(reply, audio_filename)

        # 3. Salva a resposta da IA no banco de dados se houver sessão ativa
        msg_data = None
        if session_id:
            with trace.span("db_save_ai_message"):
                msg_data = database.add_message(session_id, "ia", reply, audio_url)
            process_post_chat_cognition(session_id, user_text, reply)

        payload = {
            "user_text": user_text,
            "response_text": reply,
            "audio_url": audio_url,
            "message": msg_data,
            "session": title_update,
            "web_results": web_results,
            "pipeline": pipeline,
            "model": selected_model,
        }
        if diagnostics:
            payload["trace"] = trace.as_dict()
        trace.log()
        return jsonify(payload), 200

    except Exception as e:
        trace.mark("error", message=str(e))
        trace.log()
        return jsonify({"error": f"Erro interno: {str(e)}"}), 500


@app.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """
    Endpoint SSE (Server-Sent Events) para transmissão em tempo real.
    Gera tokens de texto instantâneos e áudios sentença por sentença.
    """
    session_id = request.form.get("session_id") or (request.json.get("session_id") if request.is_json else None)
    selected_model = get_requested_model()
    should_search_web = get_requested_web_search()
    should_generate_tts = get_requested_tts()
    
    user_text = ""
    if 'audio' in request.files:
        audio_file = request.files['audio']
        filepath = save_uploaded_audio(audio_file)
        user_text = stt_local(filepath)
    elif request.is_json:
        user_text = request.json.get("text", "")
    else:
        user_text = request.form.get("text", "")

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    diagnostics = diagnostics_requested(request.args, request.headers)
    pipeline = classify_pipeline(
        user_text,
        web_search=should_search_web,
        has_audio="audio" in request.files,
    )
    selected_model = select_model_for_pipeline(selected_model, pipeline, get_ollama_models())
    trace = PerfTrace(route="/api/chat/stream", pipeline=pipeline, model=selected_model, diagnostics=diagnostics)
    trace.set("web_search", should_search_web)
    trace.set("tts_requested", should_generate_tts)

    def generate():
        history = []
        knowledge_context = ""
        direct_reply = None
        visible_started = False
        yield sse_event({
            'type': 'transcription',
            'content': user_text,
            'pipeline': pipeline,
            'model': selected_model,
        })
        trace.mark("sse_transcription_sent")
        try:
            history, title_update, knowledge_context = prepare_session_context(
                session_id,
                user_text,
                pipeline=pipeline,
                selected_model=selected_model,
                trace=trace,
            )
            with trace.span("direct_reply"):
                direct_reply = get_direct_reply(
                    user_text,
                    session_id,
                    history,
                    selected_model=selected_model,
                    pipeline=pipeline,
                )

            if title_update:
                yield sse_event({'type': 'session_update', 'session': title_update})

            web_context = None
            if should_search_web and not direct_reply:
                try:
                    with trace.span("web_search"):
                        web_results = search_google(user_text)
                        web_context = format_web_context(web_results)
                    yield sse_event({'type': 'web_search', 'content': 'Busca Google concluída', 'results': web_results})
                except Exception as e:
                    yield sse_event({'type': 'web_search', 'content': f'Busca Google indisponível: {str(e)}', 'results': []})

            buffer = ""
            raw_response = ""
            visible_response = ""
            sentence_idx = 0
            defer_streaming = cognitive_finance.should_use_financial_context(user_text, history) and not direct_reply
            trace.set("defer_streaming", defer_streaming)

            # Lista de futures TTS submetidas em background durante o streaming.
            # (future, audio_url, sentence_text) — coletadas após o loop de tokens.
            tts_futures: list[tuple] = []

            def mark_visible_once() -> None:
                nonlocal visible_started
                if not visible_started:
                    visible_started = True
                    trace.mark("first_visible_token")
                    trace.set("ttft_visible_ms", trace.elapsed_ms())

            def enqueue_tts(text_delta: str) -> None:
                """Submete TTS para o pool sem bloquear o generator SSE."""
                nonlocal buffer, sentence_idx
                if not should_generate_tts or not text_delta:
                    return

                buffer += text_delta
                parts = re.split(r'(?<=[.!?\n])\s+', buffer)
                if len(parts) > 1:
                    for sentence in parts[:-1]:
                        sentence_clean = sentence.strip()
                        if sentence_clean:
                            audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                            out_file = OUT_DIR / audio_filename
                            # Submete ao pool e NÃO espera — o stream continua imediatamente
                            fut = _TTS_POOL.submit(tts_piper, sentence_clean, out_file)
                            tts_futures.append((fut, f"/api/audio/{audio_filename}", sentence_clean))
                            sentence_idx += 1
                    buffer = parts[-1]

            token_source = [direct_reply] if direct_reply else llm_ollama_stream(
                user_text,
                history,
                selected_model,
                web_context,
                knowledge_context,
                pipeline=pipeline,
                trace=trace,
            )
            for token in token_source:
                raw_response += token
                if defer_streaming:
                    continue
                safe_so_far = response_safety.sanitize_response(raw_response, user_text=user_text, streaming=True)
                if safe_so_far == visible_response:
                    continue

                if safe_so_far.startswith(visible_response):
                    delta = safe_so_far[len(visible_response):]
                    if delta:
                        mark_visible_once()
                        yield sse_event({'type': 'token', 'content': delta})
                        enqueue_tts(delta)  # não bloqueia — submete TTS ao pool
                else:
                    mark_visible_once()
                    yield sse_event({'type': 'replace_response', 'content': safe_so_far})
                    buffer = ""
                visible_response = safe_so_far

            # Enfileira o que restou no buffer de sentenças
            if should_generate_tts and buffer.strip():
                sentence_clean = buffer.strip()
                audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                out_file = OUT_DIR / audio_filename
                fut = _TTS_POOL.submit(tts_piper, sentence_clean, out_file)
                tts_futures.append((fut, f"/api/audio/{audio_filename}", sentence_clean))

            # Coleta futures TTS já concluídas durante o stream e emite eventos
            # O Piper rodou em paralelo — a maioria das futures já está pronta aqui
            for fut, audio_url, sentence_text in tts_futures:
                try:
                    fut.result(timeout=TTS_FUTURE_TIMEOUT)
                    yield sse_event({
                        'type': 'audio_sentence',
                        'text': sentence_text,
                        'url': audio_url,
                    })
                except Exception as tts_exc:
                    print(f"[TTS] Sentença ignorada ({tts_exc})")

            full_response = response_safety.sanitize_response(raw_response, user_text=user_text)
            if not full_response.strip():
                full_response = (
                    "Não consegui obter uma resposta do Ollama agora. "
                    "Confere se o Ollama está aberto e se o modelo selecionado está carregado."
                )
                trace.mark("empty_ollama_response")

            if (
                not direct_reply
                and full_response.strip()
                and pipeline == DEEP_PATH
                and budget_for_pipeline(pipeline).get("reflection")
            ):
                with trace.span("reflection"):
                    refined_response = cognitive_conversation.maybe_refine_response(
                        user_text=user_text,
                        draft=full_response,
                        context=knowledge_context,
                        llm_call=lambda prompt: llm_ollama_raw(
                            prompt,
                            selected_model,
                            num_predict=420,
                            pipeline=pipeline,
                            trace=trace,
                        ),
                    )
                refined_response = response_safety.sanitize_response(refined_response, user_text=user_text)
                if refined_response and refined_response != full_response:
                    full_response = refined_response

            full_response = cognitive_finance.repair_financial_response(user_text, full_response, history)
            full_response = response_safety.sanitize_response(full_response, user_text=user_text)

            if full_response and full_response != visible_response:
                mark_visible_once()
                yield sse_event({'type': 'replace_response', 'content': full_response})

            # Salva a resposta completa da IA ao final do fluxo
            if session_id and full_response:
                # Salva o texto completo gerado
                with trace.span("db_save_ai_message"):
                    database.add_message(session_id, "ia", full_response.strip())
                process_post_chat_cognition(session_id, user_text, full_response.strip())

        except Exception as e:
            trace.mark("error", message=str(e))
            yield sse_event({'type': 'error', 'content': str(e)})
        finally:
            trace.log()

        done_payload = {'type': 'done', 'pipeline': pipeline, 'model': selected_model}
        if diagnostics:
            done_payload['trace'] = trace.as_dict()
        yield sse_event(done_payload)

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/audio/<filename>', methods=['GET'])
def get_audio(filename):
    """Rota estática para servir os arquivos de áudio gerados."""
    return send_from_directory(OUT_DIR, filename)


if __name__ == "__main__":
    # Local por padrão; em NEXUS_REMOTE_MODE=true escuta em 0.0.0.0 para LAN/VPN/Tailscale.
    config = remote_access.get_remote_config()
    mobile_token = (
        remote_access.get_or_create_mobile_token()
        if remote_access.REMOTE_MODE
        else None
    )
    print(
        "[Remote] "
        f"mode={config['remote_mode']} host={config['host']} port={config['port']} "
        f"local_url={config['local_url']} auth_configured={config['auth_configured']}"
    )
    print("")
    if remote_access.REMOTE_MODE:
        print("Aether Memory Mobile Remote ligado")
        print(f"Mesma Wi-Fi - Front: {config['frontend_dev_url']}")
        print(f"Mesma Wi-Fi - Backend/API: {config['local_url']}")
        if config.get("public_frontend_url"):
            print(f"Wi-Fi diferente / internet - Front: {config['public_frontend_url']}")
        if config.get("public_url"):
            print(f"Wi-Fi diferente / internet - Backend/API: {config['public_url']}")
        print("")
        print("No iPhone, abra a URL do Front se estiver usando npm run dev:mobile.")
        print("Use a URL do Backend/API apenas para testar /api/health ou acessar o build servido pelo Flask.")
        print(f"Token: {mobile_token}")
    else:
        print("Aether Memory em modo local")
        print(f"Mac/local: http://127.0.0.1:{config['port']}")
        print("")
        print("Para abrir no iPhone, reinicie assim:")
        print("NEXUS_REMOTE_MODE=true python app.py")
        print("")
        print(f"Front no iPhone em desenvolvimento: {config['frontend_dev_url']}")
        print(f"Backend/API no iPhone: {config['local_url']}")
        print("Para Wi-Fi diferente, use Tailscale ou defina NEXUS_PUBLIC_URL/NEXUS_PUBLIC_FRONTEND_URL.")
    print("")
    app.run(host=remote_access.HOST, port=remote_access.PORT, debug=False, use_reloader=False)
