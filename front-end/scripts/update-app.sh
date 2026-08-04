#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$ROOT_DIR/.." && pwd)"
APP_NAME="Buds Memory.app"
INSTALL_DIR="/Applications"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME"
APP_SUPPORT_DIR="$HOME/Library/Application Support/Buds Memory"
LEGACY_APP_SUPPORT_DIR="$HOME/Library/Application Support/Aether Memory"
BUILD_OUTPUT_DIR="$(mktemp -d /private/tmp/buds-electron-build.XXXXXX)"
BUILT_APP="$BUILD_OUTPUT_DIR/mac-arm64/$APP_NAME"
# Recursos de dados não são código executável. Ignorá-los evita milhares de
# chamadas codesign e mantém a assinatura dos helpers, dylibs, .so e backend.
SIGN_IGNORE='(?:/Contents/Resources/(?:NexusAssets/|BudsBackend/_internal/(?:piper/espeak-ng-data/|models/|voz/))|\.(?:pyc|py|json|txt|md|wav|onnx|bin|xml|dic|aff|pak|dat|cfg|ini|ya?ml|html|css|js|map|woff2?|ttf|png|jpe?g|svg|asar)$)'

trap 'rm -rf "$BUILD_OUTPUT_DIR"' EXIT

cd "$ROOT_DIR"

echo "==> Buildando Buds Memory..."
npm run build

echo "==> Empacotando backend autocontido..."
npm run build:backend:mac

echo "==> Gerando app macOS..."
npx electron-builder --mac dir \
  --config.directories.output="$BUILD_OUTPUT_DIR" \
  --config.mac.signIgnore="$SIGN_IGNORE"

if [ ! -d "$BUILT_APP" ]; then
  echo "App gerado nao encontrado: $BUILT_APP"
  exit 1
fi

echo "==> Fechando app antigo, se estiver aberto..."
pkill -f "$APP_NAME" 2>/dev/null || true
pkill -f "Buds Memory" 2>/dev/null || true

echo "==> Instalando em $INSTALL_DIR..."
rm -rf "$INSTALLED_APP"
ditto --norsrc "$BUILT_APP" "$INSTALLED_APP"

if [ ! -d "$APP_SUPPORT_DIR" ] && [ -d "$LEGACY_APP_SUPPORT_DIR" ]; then
  echo "==> Migrando dados da instalação anterior..."
  ditto --norsrc "$LEGACY_APP_SUPPORT_DIR" "$APP_SUPPORT_DIR"
fi

if [ -f "$PROJECT_DIR/Back-end/.env" ]; then
  echo "==> Atualizando configuracoes do app..."
  mkdir -p "$APP_SUPPORT_DIR"
  cp "$PROJECT_DIR/Back-end/.env" "$APP_SUPPORT_DIR/.env"
  chmod 600 "$APP_SUPPORT_DIR/.env"
fi

echo "==> Abrindo Buds Memory..."
env -u ELECTRON_RUN_AS_NODE open "$INSTALLED_APP"

echo "Pronto: $INSTALLED_APP"
