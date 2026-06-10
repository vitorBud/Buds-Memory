#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Nexus IA.app"
BUILT_APP="$ROOT_DIR/release/mac-arm64/$APP_NAME"
INSTALL_DIR="/Applications"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME"

cd "$ROOT_DIR"

echo "==> Buildando Nexus IA..."
npm run build

echo "==> Gerando app macOS..."
npx electron-builder --mac dir

if [ ! -d "$BUILT_APP" ]; then
  echo "App gerado nao encontrado: $BUILT_APP"
  exit 1
fi

echo "==> Fechando app antigo, se estiver aberto..."
pkill -f "$APP_NAME" 2>/dev/null || true
pkill -f "Nexus IA" 2>/dev/null || true

echo "==> Instalando em $INSTALL_DIR..."
rm -rf "$INSTALLED_APP"
cp -R "$BUILT_APP" "$INSTALL_DIR/"

echo "==> Abrindo Nexus IA..."
open "$INSTALLED_APP"

echo "Pronto: $INSTALLED_APP"
