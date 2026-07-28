#!/usr/bin/env bash
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/Back-end"
PYTHON_BIN="$BACKEND_DIR/ambiente/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Ambiente Python não encontrado em $PYTHON_BIN"
  echo "Crie-o e instale Back-end/requirements.txt antes de empacotar."
  exit 1
fi

if ! "$PYTHON_BIN" -c "import PyInstaller" >/dev/null 2>&1; then
  echo "PyInstaller não está instalado no ambiente de build."
  echo "Execute: Back-end/ambiente/bin/python -m pip install -r Back-end/requirements-build.txt"
  exit 1
fi

PYINSTALLER_ARGS=(
  --noconfirm
  --clean
  --onedir
  --name aether-backend
  --paths "$BACKEND_DIR"
  --distpath "$BACKEND_DIR/dist"
  --workpath "$BACKEND_DIR/build/pyinstaller"
  --specpath "$BACKEND_DIR/build"
  --collect-submodules faster_whisper
  --hidden-import piper.__main__
  --hidden-import piper.voice
  --hidden-import piper.config
  --hidden-import piper.phonemize_espeak
  --collect-data piper
  --collect-binaries piper
  --exclude-module piper.train
  --exclude-module sentence_transformers
  --exclude-module torch
  --exclude-module transformers
  --exclude-module scipy
  --exclude-module sklearn
  --add-data "$BACKEND_DIR/voz:voz"
)

if [ -d "$BACKEND_DIR/models" ]; then
  PYINSTALLER_ARGS+=(--add-data "$BACKEND_DIR/models:models")
fi

echo "==> Empacotando backend Python autocontido ($(uname -m))..."
cd "$BACKEND_DIR"
"$PYTHON_BIN" -m PyInstaller "${PYINSTALLER_ARGS[@]}" app.py

BACKEND_EXECUTABLE="$BACKEND_DIR/dist/aether-backend/aether-backend"
if [ ! -x "$BACKEND_EXECUTABLE" ]; then
  echo "Executável do backend não foi gerado: $BACKEND_EXECUTABLE"
  exit 1
fi

echo "Backend autocontido pronto: $BACKEND_EXECUTABLE"
