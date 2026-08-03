#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_SOURCE="$ROOT_DIR/ios-assets/AppIcon.png"
SPLASH_SOURCE="$ROOT_DIR/ios-assets/Splash.png"
ICON_TARGET="$ROOT_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
SPLASH_DIR="$ROOT_DIR/ios/App/App/Assets.xcassets/Splash.imageset"

if [ ! -f "$ICON_SOURCE" ] || [ ! -f "$SPLASH_SOURCE" ]; then
  echo "Assets iOS não encontrados em $ROOT_DIR/ios-assets"
  exit 1
fi

cp "$ICON_SOURCE" "$ICON_TARGET"
cp "$SPLASH_SOURCE" "$SPLASH_DIR/splash-2732x2732.png"
cp "$SPLASH_SOURCE" "$SPLASH_DIR/splash-2732x2732-1.png"
cp "$SPLASH_SOURCE" "$SPLASH_DIR/splash-2732x2732-2.png"

echo "Assets do Aether Memory sincronizados com o projeto iOS."
