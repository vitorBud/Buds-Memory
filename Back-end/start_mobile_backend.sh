#!/usr/bin/env zsh

set -e

cd "$(dirname "$0")"

if [ -d "ambiente" ]; then
  source ambiente/bin/activate
elif [ -d "venv" ]; then
  source venv/bin/activate
else
  echo "Ambiente Python não encontrado. Rode primeiro: python3 -m venv ambiente"
  exit 1
fi

TOKEN_FILE=".nexus_remote_token"
if [ -z "$NEXUS_AUTH_TOKEN" ]; then
  if [ ! -f "$TOKEN_FILE" ]; then
    openssl rand -hex 24 > "$TOKEN_FILE"
  fi
  export NEXUS_AUTH_TOKEN="$(cat "$TOKEN_FILE")"
fi

export NEXUS_REMOTE_MODE=true
export NEXUS_PORT="${NEXUS_PORT:-5050}"
export NEXUS_FRONTEND_PORT="${NEXUS_FRONTEND_PORT:-5174}"

TAILSCALE_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
fi

LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="$(ifconfig en0 2>/dev/null | awk '/inet / {print $2; exit}')"
fi
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="$(ifconfig en1 2>/dev/null | awk '/inet / {print $2; exit}')"
fi
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="IP_DO_MAC"
fi

LAN_FRONT_URL="http://$LOCAL_IP:$NEXUS_FRONTEND_PORT"
LAN_API_URL="http://$LOCAL_IP:$NEXUS_PORT"
OUTSIDE_FRONT_URL="${NEXUS_PUBLIC_FRONTEND_URL:-}"
OUTSIDE_API_URL="${NEXUS_PUBLIC_URL:-}"

if [ -z "$OUTSIDE_FRONT_URL" ] && [ -n "$TAILSCALE_IP" ]; then
  OUTSIDE_FRONT_URL="http://$TAILSCALE_IP:$NEXUS_FRONTEND_PORT"
fi
if [ -z "$OUTSIDE_API_URL" ] && [ -n "$TAILSCALE_IP" ]; then
  OUTSIDE_API_URL="http://$TAILSCALE_IP:$NEXUS_PORT"
fi

echo ""
echo "Aether Memory Mobile Remote ligado"
echo "Mesma Wi-Fi - Front: $LAN_FRONT_URL"
echo "Mesma Wi-Fi - Backend/API: $LAN_API_URL"
echo ""
if [ -n "$OUTSIDE_FRONT_URL" ]; then
  echo "Wi-Fi diferente / internet - Front: $OUTSIDE_FRONT_URL"
  echo "Wi-Fi diferente / internet - Backend/API: $OUTSIDE_API_URL"
else
  echo "Wi-Fi diferente / internet: configure Tailscale, Cloudflare Tunnel ou ngrok."
  echo "Depois defina NEXUS_PUBLIC_FRONTEND_URL e NEXUS_PUBLIC_URL, se nao usar Tailscale."
fi
echo ""
echo "No celular, abra sempre a URL do Front mostrada pelo npm run dev."
echo "Use o Backend/API apenas para testar /api/health ou acessar o build servido pelo Flask."
echo "Token: $NEXUS_AUTH_TOKEN"
echo ""
echo "Dica: Tailscale e a opcao mais simples para usar em Wi-Fi diferente sem abrir porta no roteador."
echo ""

python app.py
