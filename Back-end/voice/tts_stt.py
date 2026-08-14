"""
voice/tts_stt.py — Síntese e reconhecimento de voz do Buds Memory.

Responsabilidades extraídas de agenty.py:
  - TTS via Piper (offline, local)
  - STT via faster-whisper (offline, CPU int8)
  - Gravação WAV com detecção de silêncio
  - Reprodução de WAV

Carregamento sob demanda: o modelo STT só é carregado quando o usuário
envia áudio — não impacta o startup do Flask.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from storage import get_output_dir

# ── Caminhos dos recursos de voz ─────────────────────────────────────────────

_BASE = Path(__file__).resolve().parent.parent  # Back-end/

PIPER_EXE = _BASE / "piper" / "piper.exe"
PIPER_VOICE = os.getenv("BUDS_PIPER_VOICE", "pt_BR-cadu-medium").strip() or "pt_BR-cadu-medium"
MODEL     = _BASE / "voz" / f"{PIPER_VOICE}.onnx"
CONFIG    = _BASE / "voz" / f"{PIPER_VOICE}.onnx.json"

STT_MODEL_PATH = _BASE / "models" / "faster-whisper-base"

OUT_DIR = get_output_dir()
OUT_DIR.mkdir(exist_ok=True)

_CONFIG_FILE = _BASE / "config.json"

# ── Estado do modelo STT ──────────────────────────────────────────────────────

_stt_model = None
_stt_lock = threading.Lock()


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO DE ÁUDIO
# ═══════════════════════════════════════════════════════════════════════════════

def load_config() -> dict:
    """Carrega configuração de dispositivos de áudio de config.json."""
    if _CONFIG_FILE.exists():
        try:
            with open(_CONFIG_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_config(config: dict) -> None:
    try:
        with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
    except Exception as exc:
        print(f"[voice] Falha ao salvar config.json: {exc}")


# ═══════════════════════════════════════════════════════════════════════════════
# TTS — PIPER
# ═══════════════════════════════════════════════════════════════════════════════

def limpar_texto_tts(texto: str) -> str:
    """Normaliza texto para o Piper: remove caracteres que quebram a síntese."""
    texto = re.sub(r"```[\s\S]*?```", " bloco de código omitido. ", texto or "")
    texto = re.sub(r"`([^`]+)`", r"\1", texto)
    texto = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", texto)
    texto = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", texto)
    texto = re.sub(r"^\s{0,3}#{1,6}\s*", "", texto, flags=re.MULTILINE)
    texto = re.sub(r"[*_>#]+", "", texto)
    texto = texto.replace("—", "-").replace("–", "-")
    texto = texto.replace("\u201c", '"').replace("\u201d", '"')
    texto = texto.replace("\u2018", "'").replace("\u2019", "'")
    texto = texto.replace("\u2026", "...")
    texto = texto.replace("•", "-")
    texto = re.sub(r"\s+", " ", texto)
    texto = texto.encode("utf-8", errors="ignore").decode("utf-8")
    return texto.strip()


def _resolve_piper_command() -> list[str]:
    """
    Resolve o executável do Piper de forma cross-platform.

    O projeto antigo trazia apenas piper.exe, que é Windows. No macOS/Linux,
    preferimos BUDS_PIPER_BIN ou um binário `piper` instalado no PATH.
    """
    explicit_bin = os.getenv("BUDS_PIPER_BIN", os.getenv("AETHER_PIPER_BIN", "")).strip()
    if explicit_bin:
        explicit_path = Path(explicit_bin).expanduser()
        if explicit_path.exists():
            return [str(explicit_path)]
        resolved = shutil.which(explicit_bin)
        if resolved:
            return [resolved]
        raise FileNotFoundError(f"BUDS_PIPER_BIN aponta para um Piper inexistente: {explicit_bin}")

    # O app desktop empacotado reutiliza o próprio executável Python congelado
    # como entrada para o CLI do Piper. Assim não dependemos de um shebang ou
    # ambiente virtual pertencente à máquina onde o app foi compilado.
    if getattr(sys, "frozen", False):
        return [sys.executable, "--piper-cli"]

    local_candidates: list[Path] = []
    if sys.platform == "win32":
        local_candidates.append(PIPER_EXE)
    else:
        local_candidates.extend([
            Path(sys.executable).with_name("piper"),
            _BASE / "piper" / "piper",
            _BASE / "piper" / "piper_arm64",
        ])

    for candidate in local_candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return [str(candidate)]

    resolved = shutil.which("piper") or shutil.which("piper.exe")
    if resolved:
        if sys.platform != "win32" and resolved.lower().endswith(".exe"):
            raise FileNotFoundError(
                "Piper encontrado no PATH, mas é um binário Windows (.exe). "
                "Instale uma versão nativa para macOS/Linux."
            )
        return [resolved]

    raise FileNotFoundError(
        "Piper nativo não encontrado. No Mac, instale com `ambiente/bin/python -m pip install piper-tts` "
        "ou defina BUDS_PIPER_BIN com o caminho do binário Piper."
    )


def tts_piper(texto: str, out_wav: Path, cancel_event: Optional[threading.Event] = None) -> None:
    """
    Gera áudio WAV via Piper (offline).

    Raises FileNotFoundError se Piper ou o modelo não estiverem presentes.
    Raises RuntimeError se o Piper retornar código de erro.
    """
    texto = limpar_texto_tts(texto)
    if not texto:
        print("[TTS] Texto vazio. Nada para sintetizar.")
        return

    if not MODEL.exists():
        raise FileNotFoundError(f"Modelo .onnx não encontrado em: {MODEL}")
    if not CONFIG.exists():
        raise FileNotFoundError(f"Configuração .onnx.json não encontrada em: {CONFIG}")

    piper_command = _resolve_piper_command()
    command = [*piper_command, "-m", str(MODEL), "-c", str(CONFIG), "-f", str(out_wav)]
    if cancel_event is None:
        try:
            result = subprocess.run(
                command,
                input=texto,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=45,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Piper excedeu o limite de 45 segundos e foi encerrado.") from exc
    else:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        try:
            assert process.stdin is not None
            process.stdin.write(texto)
            process.stdin.close()
            started_at = time.monotonic()
            while process.poll() is None:
                if cancel_event.wait(0.05):
                    process.terminate()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise RuntimeError("Piper interrompido pelo usuário.")
                if time.monotonic() - started_at > 45:
                    process.kill()
                    raise RuntimeError("Piper excedeu o limite de 45 segundos e foi encerrado.")
            stdout = process.stdout.read() if process.stdout else ""
            stderr = process.stderr.read() if process.stderr else ""
            result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        finally:
            if process.poll() is None:
                process.kill()

    if result.returncode != 0:
        raise RuntimeError(
            f"Piper falhou (returncode={result.returncode}).\n"
            f"STDERR: {result.stderr}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# PLAYBACK WAV
# ═══════════════════════════════════════════════════════════════════════════════

def play_wav(wav_path: Path, device_id: int) -> None:
    """Reproduz arquivo WAV no dispositivo de saída especificado."""
    import sounddevice as sd
    import soundfile as sf

    data, sr_val = sf.read(str(wav_path), dtype="float32")
    sd.play(data, sr_val, device=device_id)
    sd.wait()


# ═══════════════════════════════════════════════════════════════════════════════
# STT — FASTER-WHISPER
# ═══════════════════════════════════════════════════════════════════════════════

def get_stt_model():
    """
    Carrega o modelo Whisper sob demanda (lazy loading).

    Não é carregado no startup — só quando o usuário envia áudio.
    Mantém instância global para reuso.
    """
    global _stt_model
    if _stt_model is not None:
        return _stt_model

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "STT indisponível: instale faster-whisper para usar reconhecimento de voz."
        ) from exc

    print("[STT] Carregando modelo faster-whisper sob demanda...")
    _stt_model = WhisperModel(
        str(STT_MODEL_PATH),
        device="cpu",
        compute_type="int8",
    )
    print("[STT] Modelo carregado.")
    return _stt_model


def stt_local(wav_path: Path) -> str:
    """
    Transcreve áudio WAV para texto usando Whisper local.

    Retorna string vazia em caso de falha.
    """
    try:
        # faster-whisper reutiliza uma única instância. A trava impede duas
        # transcrições concorrentes de disputarem o mesmo modelo no Voice.
        with _stt_lock:
            model = get_stt_model()
            segments, _info = model.transcribe(
                str(wav_path),
                language="pt",
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as exc:
        print(f"[STT] Erro ao transcrever áudio: {exc}")
        return ""


# ═══════════════════════════════════════════════════════════════════════════════
# GRAVAÇÃO COM DETECÇÃO DE SILÊNCIO
# ═══════════════════════════════════════════════════════════════════════════════

def record_wav_dynamic(
    out_path: Path,
    device_id: int,
    sr_rate: int = 16000,
) -> Optional[Path]:
    """
    Grava áudio do microfone com detecção de VAD por energia (RMS).

    Para automaticamente após silêncio configurado ou tempo máximo.
    Retorna None se nenhum áudio for capturado.
    """
    import numpy as np
    import sounddevice as sd
    import soundfile as sf

    config = load_config()
    threshold        = config.get("silence_threshold", 0.03)
    silence_duration = config.get("silence_seconds",   1.5)
    max_duration     = config.get("max_record_seconds", 15.0)

    chunk_size    = int(sr_rate * 0.1)           # chunks de 100ms
    silence_limit = int(silence_duration / 0.1)
    max_chunks    = int(max_duration / 0.1)

    print(f"[MIC] Ouvindo (limiar={threshold}, silêncio={silence_duration}s, max={max_duration}s)...")

    audio_data: list = []
    started_talking = False
    silence_chunks  = 0

    with sd.InputStream(
        samplerate=sr_rate, channels=1, dtype="float32", device=device_id
    ) as stream:
        for _ in range(max_chunks):
            chunk, _ = stream.read(chunk_size)
            audio_data.append(chunk)
            rms = float(np.sqrt(np.mean(chunk ** 2))) if chunk.size > 0 else 0.0

            if rms > threshold:
                if not started_talking:
                    print("[MIC] Voz detectada...")
                    started_talking = True
                silence_chunks = 0
            elif started_talking:
                silence_chunks += 1
                if silence_chunks >= silence_limit:
                    print("[MIC] Silêncio detectado. Parando gravação.")
                    break
            else:
                # Rolling window de 0.5s antes de começar a falar
                if len(audio_data) > 5:
                    audio_data.pop(0)

    if not audio_data:
        print("[MIC] Nenhum áudio capturado.")
        return None

    audio = np.concatenate(audio_data, axis=0)
    audio = np.squeeze(audio)
    sf.write(str(out_path), audio, sr_rate)
    return out_path
