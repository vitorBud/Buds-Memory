# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import json
import time
import re
import threading
from pathlib import Path
from typing import Optional
from html import unescape
from io import BytesIO

import requests

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
import supabase_sync
import remote_access
from storage import get_data_dir

# ── Camada Cognitiva (Second Brain) ──────────────────────────────────────────
import database_v2
from cognitive_api import cognitive_bp
from cognitive import detector as cognitive_detector
from cognitive import conversation as cognitive_conversation
from cognitive import knowledge_graph
from cognitive import rag as cognitive_rag
from cognitive import summarizer as cognitive_summarizer
from cognitive import user_profile

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR.parent / "front-end" / "dist"
STATIC_DIR = FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.exists() else BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
# Habilita CORS para permitir conexões do Front-end em outras portas
CORS(app, allow_headers=["Content-Type", "Authorization", "X-Nexus-Token"])

# Inicializa as tabelas do banco de dados SQLite (existentes)
database.init_db()

# Inicializa as tabelas cognitivas do Second Brain (migração não-destrutiva)
database_v2.migrate()

# Registra o Blueprint da Camada Cognitiva
app.register_blueprint(cognitive_bp)


@app.before_request
def enforce_remote_auth():
    """Protege APIs quando o Nexus está em modo remoto/VPN."""
    if request.method == "OPTIONS" or not remote_access.REMOTE_MODE:
        return None
    if not request.path.startswith("/api/"):
        return None
    if request.path in {
        "/api/health",
        "/api/auth/login",
        "/api/auth/local",
        "/api/auth/supabase",
        "/api/auth/supabase/signup",
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


def clean_imported_text(text: str) -> str:
    """Normaliza textos importados antes de salvar como conhecimento."""
    text = unescape(text or "")
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_topics(text: str, limit: int = 10):
    """Extrai palavras-chave simples para mostrar no cérebro/Obsidian."""
    stop_words = {
        "para", "como", "uma", "com", "que", "por", "mais", "menos", "isso", "esse", "essa",
        "esta", "está", "das", "dos", "nas", "nos", "não", "nao", "seu", "sua", "sobre",
        "entre", "quando", "onde", "porque", "qual", "quais", "todo", "toda", "the", "and",
        "from", "with", "this", "that", "http", "https", "www",
    }
    normalized = (text or "").lower()
    normalized = re.sub(r"https?://\S+", " ", normalized)
    words = re.findall(r"[a-zA-ZÀ-ÿ0-9_-]{4,}", normalized)
    counts = {}
    for word in words:
        plain = word.strip("_-")
        if plain in stop_words or plain.isnumeric():
            continue
        counts[plain] = counts.get(plain, 0) + 1
    return [word for word, _count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def make_knowledge_title(text: str, fallback: str = "Conhecimento importado") -> str:
    """Cria título legível a partir do nome do arquivo ou primeira frase do conteúdo."""
    candidate = clean_imported_text(text) or fallback
    candidate = re.sub(r"\.[a-zA-Z0-9]{2,5}$", "", candidate)
    first_sentence = re.split(r"(?<=[.!?])\s+", candidate)[0].strip()
    title = first_sentence if 8 <= len(first_sentence) <= 72 else candidate[:72]
    title = title.strip(" .,:;!?-_")
    return (title[:69].rstrip() + "...") if len(title) > 72 else title or fallback


def make_learning_title(topics, summary: str, fallback: str = "Conhecimento importado") -> str:
    """Cria um título curto em português para um aprendizado importado."""
    readable = []
    aliases = {
        "python": "Python",
        "javascript": "JavaScript",
        "react": "React",
        "flask": "Flask",
        "dados": "dados",
        "database": "banco de dados",
        "backend": "backend",
        "frontend": "frontend",
        "api": "APIs",
        "programacao": "programação",
        "programação": "programação",
        "classe": "classes",
        "função": "funções",
        "funcao": "funções",
    }

    for topic in topics or []:
        clean = re.sub(r"[_-]+", " ", str(topic)).strip().lower()
        if len(clean) < 3 or clean.isnumeric():
            continue
        readable.append(aliases.get(clean, clean.capitalize()))
        if len(readable) == 3:
            break

    if readable:
        if len(readable) == 1:
            return f"Aprendizado sobre {readable[0]}"
        return f"Aprendizado: {', '.join(readable[:-1])} e {readable[-1]}"

    return make_knowledge_title(summary, fallback=fallback)


def summarize_imported_text(text: str) -> str:
    """Gera resumo curto determinístico, sem chamar LLM para não travar upload."""
    text = clean_imported_text(text)
    if len(text) <= 520:
        return text
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    summary = " ".join(sentences[:3]).strip()
    return summary[:700].rstrip() + ("..." if len(summary) > 700 else "")


def analyze_imported_document(content: str, source_type: str, source_name: str, topics: list[str]) -> dict:
    """Gera metadados úteis para segundo cérebro sem bloquear em LLM."""
    clean = clean_imported_text(content)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", clean) if part.strip()]
    executive = " ".join(sentences[:5])[:1400].strip()
    technical_bits = []
    tech_entities = cognitive_detector.detect_technologies(clean)
    detected_entities = sorted(set(tech_entities + topics[:8]))

    if tech_entities:
        technical_bits.append(f"Tecnologias detectadas: {', '.join(tech_entities[:12])}.")
    if topics:
        technical_bits.append(f"Tópicos principais: {', '.join(topics[:12])}.")
    technical_bits.append("Trechos representativos: " + " ".join(sentences[:8])[:1800])

    questions = [
        "O que este documento ensina?",
        "Quais são os principais tópicos?",
        "Quais tecnologias ou ferramentas aparecem?",
        "Como posso aplicar este conteúdo no meu projeto?",
    ]
    if source_type == "pdf":
        questions.insert(1, "Faça um resumo do PDF por partes.")
    if tech_entities:
        questions.append(f"Explique a relação entre {tech_entities[0]} e este documento.")

    return {
        "executive_summary": executive or summarize_imported_text(clean),
        "technical_summary": "\n".join(technical_bits)[:2600],
        "suggested_questions": questions[:6],
        "detected_entities": detected_entities[:20],
        "metadata": {
            "source_type": source_type,
            "source_name": source_name,
            "char_count": len(clean),
            "estimated_tokens": max(1, len(clean) // 4),
        },
    }


def extract_pdf_text_from_stream(stream) -> str:
    """Extrai texto de um stream PDF usando PyPDF2 quando disponível."""
    try:
        from PyPDF2 import PdfReader
    except ImportError as exc:
        raise RuntimeError("Leitura de PDF precisa do pacote PyPDF2. Rode: pip install PyPDF2") from exc

    reader = PdfReader(stream)
    pages = []
    for page in reader.pages[:80]:
        pages.append(page.extract_text() or "")
    return clean_imported_text("\n".join(pages))


def extract_pdf_text(file_storage) -> str:
    """Extrai texto de PDF enviado pelo navegador."""
    return extract_pdf_text_from_stream(file_storage.stream)


def fetch_url_text(url: str) -> str:
    """Baixa uma página ou PDF público e extrai texto suficiente para contexto."""
    if not re.match(r"^https?://", url or ""):
        raise ValueError("Informe uma URL começando com http:// ou https://.")
    import requests

    response = requests.get(url, timeout=15, headers={"User-Agent": "NexusAssistant/1.0"})
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    looks_like_pdf = ".pdf" in url.lower() or "application/pdf" in content_type or response.content[:5] == b"%PDF-"
    if looks_like_pdf:
        return extract_pdf_text_from_stream(BytesIO(response.content))

    return clean_imported_text(response.text)


def prepare_session_context(session_id: Optional[str], user_text: str):
    history = []
    title_update = None

    if not session_id:
        return history, title_update, ""

    history = database.get_recent_session_messages(session_id, limit=20)
    conversation_summary = cognitive_summarizer.get_conversation_summary(session_id)
    if not history:
        title = database.make_title_from_message(user_text)
        title_update = database.update_session_title(session_id, title)

    database.add_message(session_id, "user", user_text)
    try:
        pipeline = cognitive_conversation.build_conversation_context(
            user_text=user_text,
            session_id=session_id,
            history=history,
            conversation_summary=conversation_summary,
        )
        knowledge_context = pipeline.get("context", "")
    except Exception as pipeline_err:
        print(f"[ConversationPipeline] Fallback para contexto antigo: {pipeline_err}")
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

    return history, title_update, knowledge_context


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


def process_post_chat_cognition(session_id: str, user_text: str, ai_text: str) -> None:
    """Processa memória, perfil e resumo sem segurar a resposta do chat."""
    cognitive_detector.process_chat_async(
        session_id=session_id,
        user_text=user_text,
        ai_text=ai_text,
    )

    def _summarize_later():
        try:
            cognitive_summarizer.maybe_update_conversation_summary(session_id)
        except Exception as exc:
            print(f"[Summarizer] Resumo assíncrono ignorado: {exc}")

    threading.Thread(target=_summarize_later, daemon=True).start()


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
    """Serve o index.html principal do Front-end."""
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/assets/<path:filename>')
def frontend_assets(filename):
    """Serve os arquivos gerados pelo Vite em front-end/dist/assets."""
    return send_from_directory(STATIC_DIR / "assets", filename)


@app.route('/favicon.svg')
@app.route('/icons.svg')
@app.route('/nexus-icon.svg')
def frontend_public_asset():
    """Serve ícones públicos do Front-end pela mesma porta do Flask."""
    requested = request.path.lstrip("/")
    filename = "favicon.svg" if requested == "nexus-icon.svg" else requested
    return send_from_directory(STATIC_DIR, filename)


@app.route('/manifest.webmanifest')
@app.route('/sw.js')
def pwa_asset():
    """Serve arquivos PWA na raiz, como navegadores mobile esperam."""
    return send_from_directory(STATIC_DIR, request.path.lstrip("/"))


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
    """Cria uma sessão local do Nexus sem exigir token técnico."""
    session = remote_access.create_session_token(
        label=str((request.get_json(silent=True) or {}).get("label", "local")),
        auth_mode="local",
    )
    return jsonify({"success": True, **session}), 200


@app.route('/api/auth/supabase', methods=['POST'])
def auth_supabase():
    """Autentica com Supabase Auth e devolve uma sessão Nexus vinculada ao user_id."""
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not email or not password:
        return jsonify({"error": "Informe e-mail e senha."}), 400

    config = supabase_sync.get_supabase_config()
    anon_key = config.get("anon_key") or config.get("key") or ""
    if not config.get("url") or not anon_key:
        return jsonify({"error": "Supabase não configurado no backend."}), 503

    try:
        response = requests.post(
            f"{config['url']}/auth/v1/token?grant_type=password",
            headers={
                "apikey": anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
            timeout=20,
        )
        payload = response.json() if response.content else {}
    except Exception as exc:
        return jsonify({"error": f"Falha ao conectar ao Supabase Auth: {exc}"}), 502

    if response.status_code >= 400:
        message = payload.get("error_description") or payload.get("msg") or payload.get("error") or "Login Supabase recusado."
        return jsonify({"error": message}), 401

    user = payload.get("user") or {}
    user_id = user.get("id")
    user_email = user.get("email") or email
    if not user_id:
        return jsonify({"error": "Supabase não retornou o usuário autenticado."}), 502

    session = remote_access.create_session_token(
        label=user_email,
        auth_mode="supabase",
        user_id=user_id,
        email=user_email,
    )
    return jsonify({"success": True, **session}), 200


@app.route('/api/auth/supabase/signup', methods=['POST'])
def auth_supabase_signup():
    """Cria conta no Supabase Auth pelo próprio Nexus."""
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not email or not password:
        return jsonify({"error": "Informe e-mail e senha."}), 400
    if len(password) < 6:
        return jsonify({"error": "A senha precisa ter pelo menos 6 caracteres."}), 400

    config = supabase_sync.get_supabase_config()
    anon_key = config.get("anon_key") or config.get("key") or ""
    if not config.get("url") or not anon_key:
        return jsonify({"error": "Supabase não configurado no backend."}), 503

    try:
        response = requests.post(
            f"{config['url']}/auth/v1/signup",
            headers={
                "apikey": anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
            timeout=20,
        )
        payload = response.json() if response.content else {}
    except Exception as exc:
        return jsonify({"error": f"Falha ao criar conta no Supabase Auth: {exc}"}), 502

    if response.status_code >= 400:
        message = payload.get("error_description") or payload.get("msg") or payload.get("error") or "Cadastro Supabase recusado."
        return jsonify({"error": message}), 400

    user = payload.get("user") or {}
    session_payload = payload.get("session") or {}
    access_token = session_payload.get("access_token") or payload.get("access_token")
    user_id = user.get("id")
    user_email = user.get("email") or email

    # Quando confirmação por e-mail está ativa, o Supabase cria o usuário sem sessão imediata.
    if not access_token or not user_id:
        return jsonify({
            "success": True,
            "pending_confirmation": True,
            "message": "Conta criada. Confirme seu e-mail e depois entre pelo Nexus.",
            "email": user_email,
        }), 200

    session = remote_access.create_session_token(
        label=user_email,
        auth_mode="supabase",
        user_id=user_id,
        email=user_email,
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


@app.route('/api/sync/status', methods=['GET'])
def get_sync_status():
    """Retorna o estado da sincronização local-first com Supabase."""
    try:
        return jsonify(supabase_sync.get_status()), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sync/run', methods=['POST'])
def run_sync():
    """Executa a sincronização manual dos dados locais para o Supabase."""
    try:
        data = request.get_json(silent=True) or {}
        user_context = remote_access.request_session(request)
        if user_context.get("auth_mode") != "supabase":
            return jsonify({
                "success": False,
                "error": "Entre com uma conta Supabase para sincronizar com a nuvem.",
                "auth_required": True,
            }), 403
        result = supabase_sync.run_sync(
            table=data.get("table"),
            limit=data.get("limit"),
            dry_run=bool(data.get("dry_run")),
            mode=data.get("mode", "both"),
            user_context=user_context,
        )
        status = 200 if result.get("success") else 400
        return jsonify(result), status
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
        filename = f"upload_{int(time.time())}.wav"
        filepath = OUT_DIR / filename
        audio_file.save(str(filepath))
        user_text = stt_local(filepath)
    # Se receber texto em formato JSON
    elif request.is_json:
        user_text = request.json.get("text", "")
    # Se receber texto em formulário tradicional
    else:
        user_text = request.form.get("text", "")

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    try:
        history, title_update, knowledge_context = prepare_session_context(session_id, user_text)
        direct_reply = get_direct_profile_reply(user_text, session_id)

        web_results = []
        web_context = None
        if should_search_web and not direct_reply:
            web_results = search_google(user_text)
            web_context = format_web_context(web_results)

        if direct_reply:
            reply = direct_reply
        else:
            # 1. Envia o texto para a IA (Ollama)
            reply = llm_ollama(user_text, history, selected_model, web_context, knowledge_context)
            if not reply:
                return jsonify({"error": "Nenhuma resposta foi obtida da IA."}), 500
            reply = cognitive_conversation.maybe_refine_response(
                user_text=user_text,
                draft=reply,
                context=knowledge_context,
                llm_call=lambda prompt: llm_ollama_raw(prompt, selected_model, num_predict=900),
            )

        # 2. Gera a resposta por voz usando o Piper
        audio_filename = f"reply_{int(time.time())}.wav"
        audio_url = gerar_audio_url(reply, audio_filename)

        # 3. Salva a resposta da IA no banco de dados se houver sessão ativa
        msg_data = None
        if session_id:
            msg_data = database.add_message(session_id, "ia", reply, audio_url)
            process_post_chat_cognition(session_id, user_text, reply)

        return jsonify({
            "user_text": user_text,
            "response_text": reply,
            "audio_url": audio_url,
            "message": msg_data,
            "session": title_update,
            "web_results": web_results,
        }), 200

    except Exception as e:
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
        filename = f"upload_{int(time.time())}.wav"
        filepath = OUT_DIR / filename
        audio_file.save(str(filepath))
        user_text = stt_local(filepath)
    elif request.is_json:
        user_text = request.json.get("text", "")
    else:
        user_text = request.form.get("text", "")

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    history, title_update, knowledge_context = prepare_session_context(session_id, user_text)
    direct_reply = get_direct_profile_reply(user_text, session_id)

    def generate():
        # Envia a transcrição do áudio do usuário primeiro
        yield sse_event({'type': 'transcription', 'content': user_text})
        if title_update:
            yield sse_event({'type': 'session_update', 'session': title_update})

        web_context = None
        if should_search_web and not direct_reply:
            try:
                web_results = search_google(user_text)
                web_context = format_web_context(web_results)
                yield sse_event({'type': 'web_search', 'content': 'Busca Google concluída', 'results': web_results})
            except Exception as e:
                yield sse_event({'type': 'web_search', 'content': f'Busca Google indisponível: {str(e)}', 'results': []})

        buffer = ""
        full_response = ""
        sentence_idx = 0
        
        try:
            token_source = [direct_reply] if direct_reply else llm_ollama_stream(user_text, history, selected_model, web_context, knowledge_context)
            for token in token_source:
                # Envia o token de texto gerado para o Front-end imprimir na tela
                yield sse_event({'type': 'token', 'content': token})
                full_response += token
                
                if not should_generate_tts:
                    continue

                buffer += token

                # Split de sentenças por pontuação seguida de espaço
                parts = re.split(r'(?<=[.!?\n])\s+', buffer)
                if len(parts) > 1:
                    for sentence in parts[:-1]:
                        sentence_clean = sentence.strip()
                        if sentence_clean:
                            audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                            audio_url = gerar_audio_url(sentence_clean, audio_filename)
                            if audio_url:
                                # Envia o evento de áudio pronto para aquela frase
                                yield sse_event({
                                    'type': 'audio_sentence',
                                    'text': sentence_clean,
                                    'url': audio_url
                                })
                            sentence_idx += 1
                    buffer = parts[-1]
            
            # Processa o que restou no buffer
            if should_generate_tts and buffer.strip():
                sentence_clean = buffer.strip()
                audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                audio_url = gerar_audio_url(sentence_clean, audio_filename)
                if audio_url:
                    yield sse_event({
                        'type': 'audio_sentence',
                        'text': sentence_clean,
                        'url': audio_url
                    })

            # Salva a resposta completa da IA ao final do fluxo
            if session_id and full_response:
                # Salva o texto completo gerado
                database.add_message(session_id, "ia", full_response.strip())
                process_post_chat_cognition(session_id, user_text, full_response.strip())

        except Exception as e:
            yield sse_event({'type': 'error', 'content': str(e)})
            
        yield sse_event({'type': 'done'})

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/audio/<filename>', methods=['GET'])
def get_audio(filename):
    """Rota estática para servir os arquivos de áudio gerados."""
    return send_from_directory(OUT_DIR, filename)


if __name__ == "__main__":
    # Local por padrão; em NEXUS_REMOTE_MODE=true escuta em 0.0.0.0 para LAN/VPN/Tailscale.
    config = remote_access.get_remote_config()
    mobile_token = remote_access.get_or_create_mobile_token()
    print(
        "[Remote] "
        f"mode={config['remote_mode']} host={config['host']} port={config['port']} "
        f"local_url={config['local_url']} auth_configured={config['auth_configured']}"
    )
    print("")
    if remote_access.REMOTE_MODE:
        print("Nexus Mobile Remote ligado")
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
        print("Nexus em modo local")
        print(f"Mac/local: http://127.0.0.1:{config['port']}")
        print("")
        print("Para abrir no iPhone, reinicie assim:")
        print("NEXUS_REMOTE_MODE=true python app.py")
        print("")
        print(f"Front no iPhone em desenvolvimento: {config['frontend_dev_url']}")
        print(f"Backend/API no iPhone: {config['local_url']}")
        print("Para Wi-Fi diferente, use Tailscale ou defina NEXUS_PUBLIC_URL/NEXUS_PUBLIC_FRONTEND_URL.")
        print(f"Token que sera usado: {mobile_token}")
    print("")
    app.run(host=remote_access.HOST, port=remote_access.PORT, debug=False, use_reloader=False)
