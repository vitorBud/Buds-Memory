import subprocess
import time
import json
import os
import re
from pathlib import Path
from typing import Optional

import numpy as np
import requests
import sounddevice as sd
import soundfile as sf
from storage import get_env_path, get_output_dir

BASE = Path(__file__).resolve().parent
CONFIG_FILE = BASE / "config.json"
ENV_FILE = BASE / ".env"
OUT_DIR = get_output_dir()
OUT_DIR.mkdir(exist_ok=True)


def load_env_file(path: Path):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(get_env_path())
load_env_file(ENV_FILE)

# ====== Piper (TTS - 100% Offline) ======
PIPER_EXE = BASE / "piper" / "piper.exe"
MODEL = BASE / "voz" / "pt_BR-faber-medium.onnx"
CONFIG = BASE / "voz" / "pt_BR-faber-medium.onnx.json"


def limpar_texto_tts(texto: str) -> str:
    texto = texto.replace("—", "-")
    texto = texto.replace("–", "-")
    texto = texto.replace("“", '"')
    texto = texto.replace("”", '"')
    texto = texto.replace("‘", "'")
    texto = texto.replace("’", "'")
    texto = texto.replace("…", "...")
    texto = texto.replace("•", "-")

    # Remove caracteres que podem quebrar no Piper/Windows
    texto = texto.encode("utf-8", errors="ignore").decode("utf-8")

    return texto.strip()


def tts_piper(texto: str, out_wav: Path):
    texto = limpar_texto_tts(texto)

    if not texto:
        print("[TTS] Texto vazio. Nada para falar.")
        return

    if not PIPER_EXE.exists():
        raise FileNotFoundError(f"piper.exe não encontrado em: {PIPER_EXE}")

    if not MODEL.exists():
        raise FileNotFoundError(f"Modelo de voz .onnx não encontrado em: {MODEL}")

    if not CONFIG.exists():
        raise FileNotFoundError(f"Configuração .onnx.json não encontrada em: {CONFIG}")

    p = subprocess.run(
        [
            str(PIPER_EXE),
            "-m", str(MODEL),
            "-c", str(CONFIG),
            "-f", str(out_wav)
        ],
        input=texto,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True
    )

    if p.returncode != 0:
        raise RuntimeError(
            "Piper falhou.\n"
            f"Return code: {p.returncode}\n"
            f"STDOUT: {p.stdout}\n"
            f"STDERR: {p.stderr}"
        )


def play_wav(wav_path: Path, device_id: int):
    data, sr_val = sf.read(str(wav_path), dtype="float32")
    sd.play(data, sr_val, device=device_id)
    sd.wait()


# ====== STT (sounddevice + faster-whisper Local em CPU) ======
STT_MODEL_PATH = BASE / "models" / "faster-whisper-base"
stt_model = None


def get_stt_model():
    """Carrega o Whisper apenas quando o usuário envia áudio."""
    global stt_model
    if stt_model is not None:
        return stt_model

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError("STT indisponível: instale faster-whisper para usar áudio.") from e

    print("[STT] Carregando modelo faster-whisper sob demanda...")
    try:
        stt_model = WhisperModel(
            str(STT_MODEL_PATH),
            device="cpu",
            compute_type="int8"
        )
        print("[STT] Modelo carregado.")
        return stt_model
    except Exception as e:
        print(f"[Erro] Falha ao carregar o modelo STT local: {e}")
        print("Dica: confira se o modelo foi baixado corretamente em:")
        print(f"      {STT_MODEL_PATH}")
        print("Se ainda não baixou, rode:")
        print("      python baixar_stt.py")
        raise e


def record_wav_dynamic(out_path: Path, device_id: int, sr_rate=16000):
    config = load_config()
    threshold = config.get("silence_threshold", 0.03)
    silence_duration = config.get("silence_seconds", 1.5)
    max_duration = config.get("max_record_seconds", 15.0)

    chunk_size = int(sr_rate * 0.1) # 100ms chunks
    silence_limit = int(silence_duration / 0.1)
    max_chunks = int(max_duration / 0.1)

    print(f"\n[MIC] Ouvindo... (limiar: {threshold}, silêncio: {silence_duration}s, max: {max_duration}s)")

    audio_data = []
    started_talking = False
    silence_chunks = 0

    with sd.InputStream(samplerate=sr_rate, channels=1, dtype="float32", device=device_id) as stream:
        for _ in range(max_chunks):
            chunk, overflowed = stream.read(chunk_size)
            audio_data.append(chunk)

            # Calculate RMS energy of the chunk
            rms = np.sqrt(np.mean(chunk**2)) if chunk.size > 0 else 0.0

            if rms > threshold:
                if not started_talking:
                    print("[MIC] Voz detectada...")
                    started_talking = True
                silence_chunks = 0
            else:
                if started_talking:
                    silence_chunks += 1
                    if silence_chunks >= silence_limit:
                        print("[MIC] Silêncio detectado. Parando gravação.")
                        break
                else:
                    # Keep a rolling window of 0.5s (5 chunks) before talking started
                    if len(audio_data) > 5:
                        audio_data.pop(0)

    if not audio_data:
        print("[MIC] Nenhum áudio capturado.")
        return None

    audio = np.concatenate(audio_data, axis=0)
    audio = np.squeeze(audio)
    sf.write(str(out_path), audio, sr_rate)

    return out_path


def stt_local(wav_path: Path) -> str:
    try:
        model = get_stt_model()
        segments, _info = model.transcribe(
            str(wav_path),
            language="pt",
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False
        )

        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text

    except Exception as e:
        print(f"[Erro] Erro ao transcrever audio localmente: {e}")
        return ""


# ====== LLM local via HTTP (Ollama) ======
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b")

def get_ollama_models() -> list[str]:
    default_models = [
        "qwen2.5-coder:3b",
        "qwen2.5-coder:7b",
        "qwen2.5-coder:14b",
    ]
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=2)
        if response.status_code == 200:
            data = response.json()
            models = [item["name"] for item in data.get("models", []) if "name" in item]
            if models:
                return models
    except Exception:
        pass
    return default_models

OLLAMA_OPTIONS = {
    "temperature": 0.42,
    "top_p": 0.88,
    "repeat_penalty": 1.18,
    "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "12288")),
    "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", "-1")),
}
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "2m")
GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_SEARCH_API_KEY")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID") or os.getenv("GOOGLE_SEARCH_ENGINE_ID")

SYSTEM_STYLE = (
    "Sua identidade fixa é Nexus IA. Você é um assistente local inteligente criado por Vitor para ajudar com conversas, código, estudos, documentos, memória e organização de conhecimento. "
    "Quando perguntarem quem VOCÊ é: responda que é o Nexus IA, sem revelar o modelo base (Qwen, Ollama, etc.) a menos que o usuário pergunte explicitamente. "
    "Quando o usuário perguntar sobre SI MESMO ('quem sou eu?', 'você me conhece?', 'sabe meu nome?'): use EXCLUSIVAMENTE as informações do bloco PERFIL DO USUÁRIO que aparecem antes desta mensagem. Se não houver perfil, diga honestamente que ainda não tem informações salvas sobre ele e peça para se apresentar. "
    "REGRA CRÍTICA — repetição: NUNCA mencione Python, TypeScript, React ou qualquer dado do perfil do usuário a não ser que a pergunta atual seja diretamente sobre esse assunto. Não termine frases com 'Estou aqui para ajudar com Python, TypeScript...' ou variações. Isso é proibido. "
    "Responda sempre em português do Brasil. Entenda mensagens informais, erros de digitação, gírias e frases incompletas; reconstrua a intenção provável usando o histórico antes de pedir esclarecimento. "
    "Estilo: natural, direto e cooperativo. Por padrão, respostas curtas e úteis. Só faça respostas longas quando o usuário pedir detalhe, tutorial, análise ou passo a passo. "
    "Nunca responda com fragmentos, palavras cortadas ou abreviações sem sentido. Mesmo em respostas curtas, forme frases completas. "
    "Para cumprimentos como 'eai chat', responda de forma natural em 1 ou 2 frases e pergunte como pode ajudar — sem listar tecnologias. "
    "Ao analisar código, use apenas o trecho e o erro fornecidos; não invente bugs, arquivos ou logs. Se fizer hipótese, marque como hipótese."
)


DETAIL_KEYWORDS = {
    "explique", "detalhe", "detalhado", "profundo", "completo", "tutorial", "passo a passo",
    "me ensine", "aprenda", "analise", "análise", "resuma tudo", "documente", "compare",
}

SHORT_REPLY_KEYWORDS = {
    "sim", "não", "nao", "ok", "boa", "beleza", "valeu", "obrigado", "obrigada",
    "certo", "entendi", "qual", "onde", "quando", "quem", "pode", "tem como",
}


def infer_response_profile(user_text: str) -> dict:
    """Define o tamanho esperado da resposta sem depender do front-end."""
    text = (user_text or "").strip()
    lower = text.lower()
    word_count = len(re.findall(r"\w+", lower))

    asks_for_detail = any(keyword in lower for keyword in DETAIL_KEYWORDS)
    has_code = "```" in text or re.search(r"\b(def|class|function|const|let|var|import|from|return)\b", text)
    asks_for_code_fix = bool(re.search(r"\b(erro|bug|corrig|arruma|conserta|traceback|exception)\b", lower))

    if asks_for_detail:
        return {
            "name": "detalhada",
            "num_predict": -1,  # sem limite — resposta completa até o num_ctx
            "instruction": (
                "O usuário pediu profundidade. Responda com estrutura clara e completa, sem cortar no meio. "
                "Use seções e exemplos práticos quando ajudarem."
            ),
        }

    if has_code or asks_for_code_fix:
        return {
            "name": "tecnica",
            "num_predict": -1,  # sem limite — código pode ser longo
            "instruction": (
                "Resposta técnica completa: explique a causa, mostre a correção inteira sem cortar. "
                "Não invente arquivos, logs ou bugs não fornecidos."
            ),
        }

    if word_count <= 18 or any(keyword in lower for keyword in SHORT_REPLY_KEYWORDS):
        return {
            "name": "curta",
            "num_predict": 400,
            "instruction": (
                "Resposta curta, mas COMPLETA: 1 a 4 frases naturais. "
                "Não corte no meio de uma frase."
            ),
        }

    return {
        "name": "normal",
        "num_predict": 800,
        "instruction": (
            "Resposta conversacional completa: seja direto, cubra o necessário e não pare no meio. "
            "Use tópicos somente se melhorar a leitura."
        ),
    }


def is_google_search_configured() -> bool:
    return bool(GOOGLE_API_KEY and GOOGLE_CSE_ID)


def get_google_error_message(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    message = error.get("message") or response.reason or "erro desconhecido"
    reasons = [
        item.get("reason")
        for item in error.get("errors", [])
        if isinstance(item, dict) and item.get("reason")
    ]
    reason = f" ({', '.join(reasons)})" if reasons else ""
    return f"Google respondeu {response.status_code}: {message}{reason}"


def search_google(query: str, num_results: int = 5):
    if not is_google_search_configured():
        raise RuntimeError("Busca Google não configurada. Defina GOOGLE_API_KEY e GOOGLE_CSE_ID.")

    response = requests.get(
        GOOGLE_SEARCH_URL,
        params={
            "key": GOOGLE_API_KEY,
            "cx": GOOGLE_CSE_ID,
            "q": query,
            "num": max(1, min(num_results, 10)),
            "gl": "br",
            "lr": "lang_pt",
        },
        timeout=12,
    )
    if response.status_code >= 400:
        raise RuntimeError(get_google_error_message(response))

    data = response.json()
    results = []
    for item in data.get("items", []):
        results.append({
            "title": item.get("title", "").strip(),
            "link": item.get("link", "").strip(),
            "snippet": item.get("snippet", "").strip(),
        })
    return results


def format_web_context(results) -> str:
    if not results:
        return ""

    lines = [
        "Resultados recentes do Google para usar como contexto. Cite links quando usar informações destes resultados:",
    ]
    for index, result in enumerate(results, start=1):
        title = result.get("title") or "Resultado sem título"
        link = result.get("link") or "sem link"
        snippet = result.get("snippet") or "sem resumo"
        lines.append(f"{index}. {title}\nURL: {link}\nResumo: {snippet}")
    return "\n\n".join(lines)


def _extract_user_profile(knowledge_context: Optional[str]) -> tuple[str, str]:
    """
    Separa as memórias persistentes do usuário do restante do knowledge_context.
    Retorna (profile_block, remaining_context).
    """
    if not knowledge_context:
        return "", ""

    profile_marker = "Memórias persistentes do usuário (de conversas anteriores):"
    if profile_marker not in knowledge_context:
        return "", knowledge_context

    parts = knowledge_context.split(profile_marker, 1)
    before = parts[0].strip()
    after_marker = parts[1].strip()

    # O bloco de memórias vai até a primeira linha em branco dupla
    mem_end = after_marker.find("\n\n")
    if mem_end == -1:
        profile_block = after_marker.strip()
        remaining = before
    else:
        profile_block = after_marker[:mem_end].strip()
        rest_after = after_marker[mem_end:].strip()
        remaining = (before + "\n\n" + rest_after).strip() if rest_after else before

    return profile_block, remaining


def build_prompt(user_text: str, history=None, web_context: Optional[str] = None, knowledge_context: Optional[str] = None) -> str:
    history = history or []
    response_profile = infer_response_profile(user_text)

    # Separa perfil pessoal do restante do contexto de conhecimento
    user_profile_block, knowledge_remainder = _extract_user_profile(knowledge_context)

    lines = [SYSTEM_STYLE, ""]

    # ── Perfil do usuário no topo (prioridade máxima para modelo 3B) ──────────
    if user_profile_block:
        lines.extend([
            "### PERFIL DO USUÁRIO (informações salvas de conversas anteriores) ###",
            "Use OBRIGATORIAMENTE estas informações ao responder perguntas sobre o usuário:",
            user_profile_block,
            "### FIM DO PERFIL ###",
            "",
        ])

    lines.extend([
        "Contrato de resposta desta mensagem:",
        f"- Perfil: {response_profile['name']}",
        f"- {response_profile['instruction']}",
        "- Responda exatamente à pergunta atual, usando o histórico para entender referências vagas.",
        "- Não transforme uma pergunta simples em aula longa.",
        "- Se usar contexto importado/RAG, use só os trechos necessários para responder.",
        "",
        "Histórico recente da conversa:",
    ])

    if history:
        for item in history[-20:]:
            sender = item.get("sender", "")
            role = "Usuário" if sender == "user" else "Assistente"
            text = str(item.get("text", "")).strip()
            if text:
                if len(text) > 2200:
                    text = text[-2200:]
                lines.append(f"{role}: {text}")
    else:
        lines.append("(sem histórico anterior)")

    if web_context:
        lines.extend([
            "",
            "Contexto de busca em tempo real:",
            web_context,
            "",
            "Use a busca apenas quando ela ajudar a responder. Se os resultados forem insuficientes, diga isso claramente.",
        ])

    if knowledge_remainder:
        lines.extend([
            "",
            "Base de conhecimento importada:",
            knowledge_remainder,
            "",
            "Regra para PDFs e conhecimento importado: se o usuário perguntar de forma vaga, como 'o que você aprendeu do PDF', "
            "'resuma o PDF', 'e sobre Python?' ou mencionar um assunto presente nos títulos/tópicos/trechos, use primeiro a base importada. "
            "Responda com o que foi possível aprender a partir dos trechos disponíveis, citando o nome da fonte quando fizer sentido. "
            "Só diga que não encontrou informação se nenhum título, tópico, resumo ou trecho útil tiver relação com a pergunta. "
            "Não invente detalhes fora desse material; se o material for parcial, avise que a resposta está limitada ao conteúdo importado.",
        ])

    # Lembrete anti-repetição imediatamente antes da resposta (mais eficaz para LLMs)
    lines.extend([
        "",
        "[LEMBRETE FINAL: responda SOMENTE a pergunta abaixo. NÃO mencione Python, TypeScript, React, Engenharia de Software ou dados do perfil, a menos que a pergunta seja diretamente sobre esses temas. NÃO ofereça ajuda com listas de assuntos.]",
        "",
        f"Usuário: {user_text}",
        "Assistente:",
    ])
    return "\n".join(lines)



def resolve_ollama_model(model: Optional[str] = None) -> str:
    models = get_ollama_models()
    if model in models:
        return model
    if OLLAMA_MODEL in models:
        return OLLAMA_MODEL
    if models:
        return models[0]
    return OLLAMA_MODEL


def post_ollama(payload: dict, *, stream: bool):
    """Chama o Ollama com pequenas tentativas para recuperar falhas transitórias."""
    last_error = None
    for attempt in range(3):
        try:
            return requests.post(
                OLLAMA_URL,
                json=payload,
                stream=stream,
                timeout=(8, 180),
            )
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.45 * (attempt + 1))
    raise RuntimeError(f"Ollama indisponível após tentativas automáticas: {last_error}") from last_error


def llm_ollama(user_text: str, history=None, model: Optional[str] = None, web_context: Optional[str] = None, knowledge_context: Optional[str] = None) -> str:
    prompt = build_prompt(user_text, history, web_context, knowledge_context)
    selected_model = resolve_ollama_model(model)
    response_profile = infer_response_profile(user_text)
    options = {**OLLAMA_OPTIONS, "num_predict": response_profile["num_predict"]}

    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=False,
    )

    r.raise_for_status()

    return r.json().get("response", "").strip()


def llm_ollama_raw(prompt: str, model: Optional[str] = None, num_predict: int = 900) -> str:
    """Chamada direta ao Ollama para módulos internos como reflection."""
    selected_model = resolve_ollama_model(model)
    options = {**OLLAMA_OPTIONS, "num_predict": num_predict}
    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=False,
    )
    r.raise_for_status()
    return r.json().get("response", "").strip()


def llm_ollama_stream(user_text: str, history=None, model: Optional[str] = None, web_context: Optional[str] = None, knowledge_context: Optional[str] = None):
    prompt = build_prompt(user_text, history, web_context, knowledge_context)
    selected_model = resolve_ollama_model(model)
    response_profile = infer_response_profile(user_text)
    options = {**OLLAMA_OPTIONS, "num_predict": response_profile["num_predict"]}

    r = post_ollama(
        {
            "model": selected_model,
            "prompt": prompt,
            "stream": True,
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": options,
        },
        stream=True,
    )
    r.raise_for_status()

    for line in r.iter_lines():
        if line:
            try:
                data = json.loads(line.decode("utf-8"))
                token = data.get("response", "")
                if token:
                    yield token
            except Exception as e:
                print(f"\n[Erro Stream] Falha ao decodificar chunk: {e}")


# ====== Configuração de Dispositivos de Áudio ======
def load_config():
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return {}


def save_config(config):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print("[Erro] Falha ao salvar config.json:", e)


def setup_devices():
    config = load_config()
    devices = sd.query_devices()

    input_device = config.get("input_device")
    output_device = config.get("output_device")

    if input_device is not None and output_device is not None:
        if 0 <= input_device < len(devices) and 0 <= output_device < len(devices):
            return input_device, output_device

    print("\n=== CONFIGURAÇÃO DE DISPOSITIVOS DE ÁUDIO ===")
    print("Por favor, selecione os números dos seus dispositivos de som.")

    print("\n--- Microfones (Entrada de Áudio) Disponíveis ---")
    for i, dev in enumerate(devices):
        if dev["max_input_channels"] > 0:
            print(f"[{i}] {dev['name']} ({dev['hostapi']})")

    while True:
        try:
            inp = input("\nEscolha o número do Microfone: ").strip()
            inp_idx = int(inp)

            if 0 <= inp_idx < len(devices) and devices[inp_idx]["max_input_channels"] > 0:
                break

            print("Número inválido para microfone.")

        except ValueError:
            print("Por favor, digite apenas números.")

    print("\n--- Fones/Alto-falantes (Saída de Áudio) Disponíveis ---")
    for i, dev in enumerate(devices):
        if dev["max_output_channels"] > 0:
            print(f"[{i}] {dev['name']} ({dev['hostapi']})")

    while True:
        try:
            out = input("\nEscolha o número da Saída de Som: ").strip()
            out_idx = int(out)

            if 0 <= out_idx < len(devices) and devices[out_idx]["max_output_channels"] > 0:
                break

            print("Número inválido para saída de som.")

        except ValueError:
            print("Por favor, digite apenas números.")

    config["input_device"] = inp_idx
    config["output_device"] = out_idx

    # Parâmetros de latência padrão
    if "silence_threshold" not in config:
        config["silence_threshold"] = 0.03
    if "silence_seconds" not in config:
        config["silence_seconds"] = 1.5
    if "max_record_seconds" not in config:
        config["max_record_seconds"] = 15.0

    save_config(config)

    print(f"\n[OK] Configurações de áudio salvas em: {CONFIG_FILE.name}")

    return inp_idx, out_idx


# ====== Loop Principal ======
def main():
    input_idx, output_idx = setup_devices()

    print("\n[OK] STT (Whisper Local CPU) + LLM (Ollama HTTP) + TTS (Piper Local)")
    print(f"[OK] Modelo Ollama configurado: {OLLAMA_MODEL}")
    print("Dica: fale frases curtas. Pressione Ctrl+C para sair.\n")

    reply_wav = OUT_DIR / "reply.wav"

    try:
        tts_piper("Pronto para ouvir.", reply_wav)
        play_wav(reply_wav, output_idx)
    except Exception as e:
        print("[Erro TTS]:", e)

    while True:
        mic_wav = OUT_DIR / "mic.wav"

        try:
            record_wav_dynamic(mic_wav, input_idx)
        except Exception as e:
            print("[Erro MIC]:", e)
            print("Dica: apague o config.json e escolha novamente o microfone correto.")
            continue

        user_text = stt_local(mic_wav)

        if not user_text:
            print("[?] Nao entendi ou nao foi detectado audio. Tente novamente.")
            continue

        print("[Voce]:", user_text)

        print("[IA]: ", end="", flush=True)
        try:
            import re
            buffer = ""
            sentence_idx = 0

            # Generate and play sentence by sentence
            for token in llm_ollama_stream(user_text):
                print(token, end="", flush=True)
                buffer += token

                # Split on sentence boundaries followed by whitespace
                parts = re.split(r'(?<=[.!?\n])\s+', buffer)

                if len(parts) > 1:
                    for sentence in parts[:-1]:
                        sentence_clean = sentence.strip()
                        if sentence_clean:
                            out_file = OUT_DIR / f"reply_{sentence_idx}.wav"
                            try:
                                tts_piper(sentence_clean, out_file)
                                play_wav(out_file, output_idx)
                                sentence_idx += 1
                            except Exception as e:
                                print(f"\n[Erro TTS]: {e}")
                    buffer = parts[-1]

            # Process remaining text in buffer
            if buffer.strip():
                sentence_clean = buffer.strip()
                out_file = OUT_DIR / f"reply_{sentence_idx}.wav"
                try:
                    tts_piper(sentence_clean, out_file)
                    play_wav(out_file, output_idx)
                except Exception as e:
                    print(f"\n[Erro TTS]: {e}")
            
            print() # Print newline

        except Exception as e:
            print("\n[Erro] Falha ao processar resposta do Ollama:", e)
            print("Dica: Certifique-se de que o Ollama esta rodando em segundo plano:")
            print(f"      ollama run {OLLAMA_MODEL}")
            continue

        time.sleep(0.2)


if __name__ == "__main__":
    main()
