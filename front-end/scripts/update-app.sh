#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$ROOT_DIR/.." && pwd)"
APP_NAME="Aether Memory.app"
BUILT_APP="$ROOT_DIR/release/mac-arm64/$APP_NAME"
INSTALL_DIR="/Applications"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME"
APP_SUPPORT_DIR="$HOME/Library/Application Support/Aether Memory"

cd "$ROOT_DIR"

echo "==> Buildando Aether Memory..."
npm run build

echo "==> Empacotando backend autocontido..."
npm run build:backend:mac

echo "==> Gerando app macOS..."
npx electron-builder --mac dir

if [ ! -d "$BUILT_APP" ]; then
  echo "App gerado nao encontrado: $BUILT_APP"
  exit 1
fi

echo "==> Fechando app antigo, se estiver aberto..."
pkill -f "$APP_NAME" 2>/dev/null || true
pkill -f "Aether Memory" 2>/dev/null || true

echo "==> Instalando em $INSTALL_DIR..."
rm -rf "$INSTALLED_APP"
cp -R "$BUILT_APP" "$INSTALL_DIR/"

if [ -f "$PROJECT_DIR/Back-end/.env" ]; then
  echo "==> Atualizando configuracoes do app..."
  mkdir -p "$APP_SUPPORT_DIR"
  cp "$PROJECT_DIR/Back-end/.env" "$APP_SUPPORT_DIR/.env"
fi

echo "==> Abrindo Aether Memory..."
env -u ELECTRON_RUN_AS_NODE open "$INSTALLED_APP"

echo "Pronto: $INSTALLED_APP"
