from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
import json
import time
import re
from pathlib import Path

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
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
# Habilita CORS para permitir conexões do Front-end em outras portas
CORS(app)

# Inicializa as tabelas do banco de dados SQLite
database.init_db()


# ====== ROTA PRINCIPAL - SERVE O FRONT-END ======

@app.route('/')
def index():
    """Serve o index.html principal do Front-end."""
    return send_from_directory(STATIC_DIR, 'index.html')



# ====== ENDPOINTS DE HISTÓRICO (CRUD SESSÕES) ======

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Retorna todas as sessões de chat em ordem cronológica reversa."""
    try:
        sessions = database.get_all_sessions()
        return jsonify(sessions), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
            database.add_message(session_id, "user", user_text)
            
    # Se receber texto em formato JSON
    elif request.is_json:
        user_text = request.json.get("text", "")
        if session_id and user_text:
            database.add_message(session_id, "user", user_text)
            
    # Se receber texto em formulário tradicional
    else:
        user_text = request.form.get("text", "")
        if session_id and user_text:
            database.add_message(session_id, "user", user_text)

    if not user_text:
        return jsonify({"error": "Nenhum texto ou áudio fornecido"}), 400

    try:
        # 1. Envia o texto para a IA (Ollama)
        reply = llm_ollama(user_text)
        if not reply:
            return jsonify({"error": "Nenhuma resposta foi obtida da IA."}), 500

        # 2. Gera a resposta por voz usando o Piper
        audio_filename = f"reply_{int(time.time())}.wav"
        out_file = OUT_DIR / audio_filename
        tts_piper(reply, out_file)
        audio_url = f"/api/audio/{audio_filename}"

        # 3. Salva a resposta da IA no banco de dados se houver sessão ativa
        msg_data = None
        if session_id:
            msg_data = database.add_message(session_id, "ia", reply, audio_url)

        return jsonify({
            "user_text": user_text,
            "response_text": reply,
            "audio_url": audio_url,
            "message": msg_data
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

    # Salva a mensagem do usuário se a sessão existir
    if session_id:
        database.add_message(session_id, "user", user_text)

    def generate():
        # Envia a transcrição do áudio do usuário primeiro
        yield f"data: {json.dumps({'type': 'transcription', 'content': user_text})}\n\n"

        buffer = ""
        full_response = ""
        sentence_idx = 0
        
        try:
            for token in llm_ollama_stream(user_text):
                # Envia o token de texto gerado para o Front-end imprimir na tela
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                buffer += token
                full_response += token
                
                # Split de sentenças por pontuação seguida de espaço
                parts = re.split(r'(?<=[.!?\n])\s+', buffer)
                if len(parts) > 1:
                    for sentence in parts[:-1]:
                        sentence_clean = sentence.strip()
                        if sentence_clean:
                            audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                            out_file = OUT_DIR / audio_filename
                            try:
                                tts_piper(sentence_clean, out_file)
                                # Envia o evento de áudio pronto para aquela frase
                                yield f"data: {json.dumps({
                                    'type': 'audio_sentence',
                                    'text': sentence_clean,
                                    'url': f'/api/audio/{audio_filename}'
                                })}\n\n"
                                sentence_idx += 1
                            except Exception as e:
                                print(f"Erro TTS no streaming: {e}")
                    buffer = parts[-1]
            
            # Processa o que restou no buffer
            if buffer.strip():
                sentence_clean = buffer.strip()
                audio_filename = f"reply_{int(time.time())}_{sentence_idx}.wav"
                out_file = OUT_DIR / audio_filename
                try:
                    tts_piper(sentence_clean, out_file)
                    yield f"data: {json.dumps({
                        'type': 'audio_sentence',
                        'text': sentence_clean,
                        'url': f'/api/audio/{audio_filename}'
                    })}\n\n"
                except Exception as e:
                    print(f"Erro TTS no streaming (fim): {e}")

            # Salva a resposta completa da IA ao final do fluxo
            if session_id and full_response:
                # Salva o texto completo gerado
                database.add_message(session_id, "ia", full_response.strip(), f"/api/audio/reply_{int(time.time())}_0.wav")

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/audio/<filename>', methods=['GET'])
def get_audio(filename):
    """Rota estática para servir os arquivos de áudio gerados."""
    return send_from_directory(OUT_DIR, filename)


if __name__ == "__main__":
    # Roda a API Flask na porta local 5000
    app.run(host="0.0.0.0", port=5000, debug=True)
