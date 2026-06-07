import subprocess
import time
import json
import os
from pathlib import Path
from typing import Optional

import numpy as np
import requests
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel

BASE = Path(__file__).resolve().parent
CONFIG_FILE = BASE / "config.json"
ENV_FILE = BASE / ".env"
OUT_DIR = BASE / "out"
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

print("[OK] Inicializando modelo STT (faster-whisper) na CPU...")

try:
    stt_model = WhisperModel(
        str(STT_MODEL_PATH),
        device="cpu",
        compute_type="int8"
    )
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
        segments, _info = stt_model.transcribe(
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
OLLAMA_MODEL = "qwen2.5-coder:7b"
OLLAMA_MODELS = [
    "qwen2.5-coder:3b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
]
GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_SEARCH_API_KEY")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID") or os.getenv("GOOGLE_SEARCH_ENGINE_ID")

SYSTEM_STYLE = (
    "Você é um assistente virtual prestativo, claro e educado, com um estilo parecido com o ChatGPT. "
    "Responda sempre em português do Brasil, com precisão, naturalidade e objetividade. "
    "Quando for útil, organize a resposta em passos curtos ou tópicos, sem ironia, grosseria ou sarcasmo. "
    "Se faltar contexto, faça uma pergunta simples antes de assumir algo arriscado. "
    "Ao analisar código, use apenas o trecho e o erro fornecidos pelo usuário; não invente bugs, arquivos, funções, "
    "logs ou requisitos que não foram mostrados. Se fizer uma hipótese, marque claramente como hipótese."
)


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


def build_prompt(user_text: str, history=None, web_context: Optional[str] = None) -> str:
    history = history or []
    lines = [
        SYSTEM_STYLE,
        "",
        "Histórico recente da conversa:",
    ]

    if history:
        for item in history[-12:]:
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

    lines.extend([
        "",
        f"Usuário: {user_text}",
        "Assistente:",
    ])
    return "\n".join(lines)


def resolve_ollama_model(model: Optional[str] = None) -> str:
    return model if model in OLLAMA_MODELS else OLLAMA_MODEL


def llm_ollama(user_text: str, history=None, model: Optional[str] = None, web_context: Optional[str] = None) -> str:
    prompt = build_prompt(user_text, history, web_context)
    selected_model = resolve_ollama_model(model)

    r = requests.post(
        OLLAMA_URL,
        json={
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "top_p": 0.85,
                "repeat_penalty": 1.08
            }
        },
        timeout=180
    )

    r.raise_for_status()

    return r.json().get("response", "").strip()


def llm_ollama_stream(user_text: str, history=None, model: Optional[str] = None, web_context: Optional[str] = None):
    prompt = build_prompt(user_text, history, web_context)
    selected_model = resolve_ollama_model(model)

    r = requests.post(
        OLLAMA_URL,
        json={
            "model": selected_model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": 0.2,
                "top_p": 0.85,
                "repeat_penalty": 1.08
            }
        },
        stream=True,
        timeout=180
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
