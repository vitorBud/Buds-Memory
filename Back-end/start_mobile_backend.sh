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

echo ""
echo "Nexus Mobile Remote ligado"
echo "Front em desenvolvimento: http://$LOCAL_IP:$NEXUS_FRONTEND_PORT"
echo "Backend/API: http://$LOCAL_IP:$NEXUS_PORT"
echo ""
echo "No iPhone, abra o Front se estiver usando npm run dev:mobile."
echo "Use o Backend/API apenas para testar /api/health ou acessar o build servido pelo Flask."
echo "Token: $NEXUS_AUTH_TOKEN"
echo ""
echo "Se usar Tailscale, troque o IP pelo IP Tailscale do Mac."
echo ""

python app.py
