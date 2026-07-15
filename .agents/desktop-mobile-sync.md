# Agente Desktop Mobile Sync

## Missao

Garantir que o Aether Memory funcione como app desktop plug and play, como PWA
mobile e em acesso remoto, preservando dados locais e sincronizacao opcional.

## Arquivos Principais

- `front-end/electron/main.cjs`
- `front-end/electron/preload.cjs`
- `front-end/package.json`
- `front-end/scripts/update-app.sh`
- `front-end/public/manifest.webmanifest`
- `front-end/public/sw.js`
- `Back-end/remote_access.py`
- `Back-end/supabase_sync.py`
- `Back-end/storage.py`
- `Back-end/start_mobile_backend.sh`
- `Back-end/supabase_schema.sql`

## Regras

- O app desktop deve tentar ligar o backend sozinho.
- Nao exigir IDE para uso normal do app.
- Nao quebrar `NEXUS_DATA_DIR`, pois ele separa dados do app instalado.
- Nao comitar `front-end/release/`, `front-end/dist/`, banco, `.env` ou tokens.
- Modo remoto deve exigir token quando `NEXUS_REMOTE_MODE=true`.
- Mobile deve abrir o front, nao apenas a API backend.
- Supabase Sync deve ser opcional e local-first.
- Offline no Mac deve continuar funcionando mesmo sem Supabase.
- Service worker nao deve deixar tela branca presa em cache antigo.

## Fluxos Importantes

Desktop:

- `npm run desktop`
- `npm run update:app`
- Electron abre janela, registra `nexus-asset`, encontra Python e inicia Flask.

Mobile local:

- Backend em `5050`.
- Frontend em `5174` com `npm run dev:mobile`.
- iPhone acessa o IP do Mac na mesma rede.

Mobile remoto:

- Pode usar ngrok, Tailscale, Cloudflare Tunnel ou VPN.
- `NEXUS_PUBLIC_URL` e `NEXUS_PUBLIC_FRONTEND_URL` ajudam a informar URLs certas.

Sync:

- `SUPABASE_SYNC_ENABLED=1`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`
- tabela padrao `nexus_sync_records`.

## Pontos Sensíveis

- `window.nexus` e `nexus-asset` sao legados tecnicos, nao renomear sem migracao.
- `NexusAssets` ainda e destino de assets no pacote Electron.
- `NEXUS_*` continua sendo familia de env vars de compatibilidade.
- `service worker` pode causar cache antigo em celular; incrementar cache quando mexer.
- Nunca remover banco local ao atualizar app.

## Validacao

```bash
cd front-end
npm run build
```

Quando possivel:

```bash
cd front-end
npm run desktop
```

Com backend rodando:

```bash
curl http://127.0.0.1:5050/api/config
curl http://127.0.0.1:5050/api/sync/status
```

## Resultado Esperado

App desktop e mobile previsiveis: abre sem IDE, conserva dados, sincroniza quando
configurado e nao deixa usuario preso em tela branca ou token confuso.
