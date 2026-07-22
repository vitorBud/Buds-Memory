"""
agenty.py — Facade de compatibilidade do Aether Memory.

Todos os imports e funcionalidades foram movidos para módulos especializados:

  voz/TTS/STT     → voice/tts_stt.py
  Ollama client   → llm/ollama_client.py
  Prompt builder  → llm/prompt_builder.py
  Web search      → llm/web_search.py

Este arquivo mantém todos os nomes públicos originais para que nenhum import
em app.py, cognitive/ ou outros módulos precise ser alterado.
"""

from __future__ import annotations

# ── Carregamento do .env (deve ser o primeiro passo, antes de qualquer import) ─
import os
from pathlib import Path

BASE       = Path(__file__).resolve().parent
ENV_FILE   = BASE / ".env"
CONFIG_FILE = BASE / "config.json"


def load_env_file(path: Path) -> None:
    """Carrega variáveis de ambiente de um arquivo .env sem sobrescrever as existentes."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key   = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


try:
    from storage import get_env_path
    load_env_file(get_env_path())
except Exception:
    pass
load_env_file(ENV_FILE)


# ── Re-exports de llm/ ────────────────────────────────────────────────────────
from llm.ollama_client import (          # noqa: E402
    OLLAMA_URL,
    OLLAMA_MODEL,
    OLLAMA_OPTIONS,
    OLLAMA_KEEP_ALIVE,
    get_ollama_models,
    resolve_ollama_model,
    post_ollama,
    llm_ollama,
    llm_ollama_raw,
    llm_ollama_stream,
)

from llm.prompt_builder import (         # noqa: E402
    SYSTEM_STYLE,
    DETAIL_KEYWORDS,
    SHORT_REPLY_KEYWORDS,
    CASUAL_SOCIAL_PATTERNS,
    is_casual_social_text,
    infer_response_profile,
    build_prompt,
)

from llm.web_search import (             # noqa: E402
    GOOGLE_SEARCH_URL,
    GOOGLE_API_KEY,
    GOOGLE_CSE_ID,
    is_google_search_configured,
    search_google,
    format_web_context,
)

# ── Re-exports de voice/ ──────────────────────────────────────────────────────
from voice.tts_stt import (              # noqa: E402
    PIPER_EXE,
    MODEL,
    CONFIG,
    STT_MODEL_PATH,
    OUT_DIR,
    limpar_texto_tts,
    tts_piper,
    play_wav,
    get_stt_model,
    stt_local,
    record_wav_dynamic,
    load_config,
    save_config,
)


# ── Compatibilidade com imports que usam get_google_error_message ─────────────
def get_google_error_message(response=None) -> str:
    """Legado: retorna mensagem de erro de configuração do Google Search."""
    from llm.web_search import get_google_error_message as _impl
    return _impl()


# ── Loop CLI de voz (uso standalone) ─────────────────────────────────────────

def setup_devices():
    """Configura dispositivos de áudio interativamente (uso CLI)."""
    try:
        import sounddevice as sd
    except ImportError:
        print("[voice] sounddevice não instalado. Dispositivos de áudio indisponíveis.")
        return 0, 0

    config  = load_config()
    devices = sd.query_devices()

    input_device  = config.get("input_device")
    output_device = config.get("output_device")

    if input_device is not None and output_device is not None:
        if 0 <= input_device < len(devices) and 0 <= output_device < len(devices):
            return input_device, output_device

    print("\n=== CONFIGURAÇÃO DE DISPOSITIVOS DE ÁUDIO ===")
    print("\n--- Microfones (Entrada de Áudio) Disponíveis ---")
    for i, dev in enumerate(devices):
        if dev["max_input_channels"] > 0:
            print(f"[{i}] {dev['name']} ({dev['hostapi']})")

    while True:
        try:
            inp_idx = int(input("\nEscolha o número do Microfone: ").strip())
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
            out_idx = int(input("\nEscolha o número da Saída de Som: ").strip())
            if 0 <= out_idx < len(devices) and devices[out_idx]["max_output_channels"] > 0:
                break
            print("Número inválido para saída de som.")
        except ValueError:
            print("Por favor, digite apenas números.")

    config.update({
        "input_device":      inp_idx,
        "output_device":     out_idx,
        "silence_threshold": config.get("silence_threshold", 0.03),
        "silence_seconds":   config.get("silence_seconds",   1.5),
        "max_record_seconds": config.get("max_record_seconds", 15.0),
    })
    save_config(config)
    print(f"\n[OK] Configurações de áudio salvas em: {CONFIG_FILE.name}")
    return inp_idx, out_idx


def main():
    """Loop de voz standalone: mic → STT → Ollama → TTS → speaker."""
    import re
    import time

    input_idx, output_idx = setup_devices()
    print(f"\n[OK] STT + LLM ({OLLAMA_MODEL}) + TTS prontos.")
    print("Dica: fale frases curtas. Ctrl+C para sair.\n")

    reply_wav = OUT_DIR / "reply.wav"
    try:
        tts_piper("Pronto para ouvir.", reply_wav)
        play_wav(reply_wav, output_idx)
    except Exception as exc:
        print(f"[TTS] {exc}")

    while True:
        mic_wav = OUT_DIR / "mic.wav"
        try:
            record_wav_dynamic(mic_wav, input_idx)
        except Exception as exc:
            print(f"[MIC] {exc}")
            continue

        user_text = stt_local(mic_wav)
        if not user_text:
            print("[?] Áudio não detectado. Tente novamente.")
            continue

        print("[Você]:", user_text)
        print("[IA]: ", end="", flush=True)

        try:
            buffer        = ""
            sentence_idx  = 0
            for token in llm_ollama_stream(user_text):
                print(token, end="", flush=True)
                buffer += token
                parts = re.split(r"(?<=[.!?\n])\s+", buffer)
                if len(parts) > 1:
                    for sentence in parts[:-1]:
                        clean = sentence.strip()
                        if clean:
                            out_file = OUT_DIR / f"reply_{sentence_idx}.wav"
                            try:
                                tts_piper(clean, out_file)
                                play_wav(out_file, output_idx)
                                sentence_idx += 1
                            except Exception as exc:
                                print(f"\n[TTS] {exc}")
                    buffer = parts[-1]

            if buffer.strip():
                out_file = OUT_DIR / f"reply_{sentence_idx}.wav"
                try:
                    tts_piper(buffer.strip(), out_file)
                    play_wav(out_file, output_idx)
                except Exception as exc:
                    print(f"\n[TTS] {exc}")
            print()

        except Exception as exc:
            print(f"\n[Erro] {exc}")
            print(f"Verifique se o Ollama está rodando: ollama run {OLLAMA_MODEL}")

        time.sleep(0.2)


if __name__ == "__main__":
    main()
