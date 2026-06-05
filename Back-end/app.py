from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import json
import time
import re
from pathlib import Path
from typing import Optional

# Importações de agenty.py (reaproveitando lógica já existente)
from agenty import (
    stt_local,
    llm_ollama,
    llm_ollama_stream,
    tts_piper,
    OUT_DIR,
    OLLAMA_MODEL
)
import database

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR.parent / "front-end" / "dist"
STATIC_DIR = FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.exists() else BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
# Habilita CORS para permitir conexões do Front-end em outras portas
CORS(app)

# Inicializa as tabelas do banco de dados SQLite
database.init_db()


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


def prepare_session_context(session_id: Optional[str], user_text: str):
    history = []
    title_update = None

    if not session_id:
        return history, title_update

    history = database.get_recent_session_messages(session_id, limit=12)
    if not history:
        title = database.make_title_from_message(user_text)
        title_update = database.update_session_title(session_id, title)

    database.add_message(session_id, "user", user_text)
    return history, title_update


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
        "ollama_url": "http://localhost:11434",
    }), 200


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


# ====== ENDPOINTS DE CHAT E MULTIMÍDIA ======

@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Endpoint síncrono para enviar texto ou áudio.
    Salva automaticamente a interação no banco se session_id for enviado.
    """
    session_id = request.form.get("session_id") or (request.json.get("session_id") if request.is_json else None)
    
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
        history, title_update = prepare_session_context(session_id, user_text)

        # 1. Envia o texto para a IA (Ollama)
        reply = llm_ollama(user_text, history)
        if not reply:
            return jsonify({"error": "Nenhuma resposta foi obtida da IA."}), 500

        # 2. Gera a resposta por voz usando o Piper
        audio_filename = f"reply_{int(time.time())}.wav"
        audio_url = gerar_audio_url(reply, audio_filename)

        # 3. Salva a resposta da IA no banco de dados se houver sessão ativa
        msg_data = None
        if session_id:
            msg_data = database.add_message(session_id, "ia", reply, audio_url)

        return jsonify({
            "user_text": user_text,
            "response_text": reply,
            "audio_url": audio_url,
            "message": msg_data,
            "session": title_update
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

    history, title_update = prepare_session_context(session_id, user_text)

    def generate():
        # Envia a transcrição do áudio do usuário primeiro
        yield sse_event({'type': 'transcription', 'content': user_text})
        if title_update:
            yield sse_event({'type': 'session_update', 'session': title_update})

        buffer = ""
        full_response = ""
        sentence_idx = 0
        
        try:
            for token in llm_ollama_stream(user_text, history):
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
