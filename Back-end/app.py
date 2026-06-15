# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import json
import time
import re
from pathlib import Path
from typing import Optional
from html import unescape
from io import BytesIO

# Importações de agenty.py (reaproveitando lógica já existente)
from agenty import (
    stt_local,
    llm_ollama,
    llm_ollama_stream,
    tts_piper,
    OUT_DIR,
    OLLAMA_MODEL,
    OLLAMA_MODELS,
    format_web_context,
    is_google_search_configured,
    resolve_ollama_model,
    search_google,
)
import database
import supabase_sync
from storage import get_data_dir

# ── Camada Cognitiva (Second Brain) ──────────────────────────────────────────
import database_v2
from cognitive_api import cognitive_bp
from cognitive import detector as cognitive_detector
from cognitive import rag as cognitive_rag

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR.parent / "front-end" / "dist"
STATIC_DIR = FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.exists() else BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
# Habilita CORS para permitir conexões do Front-end em outras portas
CORS(app)

# Inicializa as tabelas do banco de dados SQLite (existentes)
database.init_db()

# Inicializa as tabelas cognitivas do Second Brain (migração não-destrutiva)
database_v2.migrate()

# Registra o Blueprint da Camada Cognitiva
app.register_blueprint(cognitive_bp)


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

    history = database.get_recent_session_messages(session_id, limit=12)
    if not history:
        title = database.make_title_from_message(user_text)
        title_update = database.update_session_title(session_id, title)

    database.add_message(session_id, "user", user_text)
    knowledge_context = database.build_knowledge_context(session_id, query=user_text)
    rag_context = cognitive_rag.build_rag_context(user_text, session_id=session_id, top_k=6)
    if rag_context:
        knowledge_context = f"{knowledge_context}\n\n{rag_context}" if knowledge_context else rag_context
    return history, title_update, knowledge_context


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
    return jsonify({
        "model": OLLAMA_MODEL,
        "models": OLLAMA_MODELS,
        "ollama_url": "http://localhost:11434",
        "google_search_available": is_google_search_configured(),
        "data_dir": str(get_data_dir()),
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
        result = supabase_sync.run_sync(
            table=data.get("table"),
            limit=data.get("limit"),
            dry_run=bool(data.get("dry_run")),
            mode=data.get("mode", "both"),
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
        )
        try:
            item["rag_chunks"] = cognitive_rag.index_document(item["id"], content)
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
    
    user_text = ""
    # Se receber um arquivo de áudio
    if 'audio' in request.files:
        audio_file = request.files['audio']
        filename = f"upload_{int(time.time())}.wav"
        filepath = OUT_DIR / filename
        audio_file.save(str(filepath))
        
        user_text = stt_local(filepath)
        
        if session_id and user_text:
            pass
            
    # Se receber texto em formato JSON
    elif request.is_json:
        user_text = request.json.get("text", "")
        if session_id and user_text:
            pass
            
    # Se receber texto em formulário tradicional
    else:
        user_text = request.form.get("text", "")
        if session_id and user_text:
            pass

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    try:
        history, title_update, knowledge_context = prepare_session_context(session_id, user_text)

        web_results = []
        web_context = None
        if should_search_web:
            web_results = search_google(user_text)
            web_context = format_web_context(web_results)

        # 1. Envia o texto para a IA (Ollama)
        reply = llm_ollama(user_text, history, selected_model, web_context, knowledge_context)
        if not reply:
            return jsonify({"error": "Nenhuma resposta foi obtida da IA."}), 500

        # 2. Gera a resposta por voz usando o Piper
        audio_filename = f"reply_{int(time.time())}.wav"
        audio_url = gerar_audio_url(reply, audio_filename)

        # 3. Salva a resposta da IA no banco de dados se houver sessão ativa
        msg_data = None
        if session_id:
            msg_data = database.add_message(session_id, "ia", reply, audio_url)
            cognitive_detector.process_chat_async(
                session_id=session_id,
                user_text=user_text,
                ai_text=reply,
            )

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

    def generate():
        # Envia a transcrição do áudio do usuário primeiro
        yield sse_event({'type': 'transcription', 'content': user_text})
        if title_update:
            yield sse_event({'type': 'session_update', 'session': title_update})

        web_context = None
        if should_search_web:
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
            for token in llm_ollama_stream(user_text, history, selected_model, web_context, knowledge_context):
                # Envia o token de texto gerado para o Front-end imprimir na tela
                yield sse_event({'type': 'token', 'content': token})
                buffer += token
                full_response += token
                
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
            if buffer.strip():
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

                # ── Detecção cognitiva em background (não bloqueia a resposta) ──
                cognitive_detector.process_chat_async(
                    session_id=session_id,
                    user_text=user_text,
                    ai_text=full_response.strip(),
                )

        except Exception as e:
            yield sse_event({'type': 'error', 'content': str(e)})
            
        yield sse_event({'type': 'done'})

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/audio/<filename>', methods=['GET'])
def get_audio(filename):
    """Rota estática para servir os arquivos de áudio gerados."""
    return send_from_directory(OUT_DIR, filename)


if __name__ == "__main__":
    # Roda a API Flask em 5050 para evitar conflito com AirPlay/AirTunes no macOS.
    app.run(host="127.0.0.1", port=5050, debug=False, use_reloader=False)
