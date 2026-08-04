# Agente Desktop Mobile Backup

## Missao

Garantir que o Buds Memory funcione como app desktop plug and play, como PWA
mobile e em acesso remoto, preservando dados locais e oferecendo backup portatil
da memoria.

## Arquivos Principais

- `front-end/electron/main.cjs`
- `front-end/electron/preload.cjs`
- `front-end/package.json`
- `front-end/scripts/update-app.sh`
- `front-end/public/manifest.webmanifest`
- `front-end/public/sw.js`
- `Back-end/remote_access.py`
- `Back-end/local_backup.py`
- `Back-end/storage.py`
- `Back-end/start_mobile_backend.sh`

## Regras

- O app desktop deve tentar ligar o backend sozinho.
- Nao exigir IDE para uso normal do app.
- Nao quebrar `NEXUS_DATA_DIR`, pois ele separa dados do app instalado.
- Nao comitar `front-end/release/`, `front-end/dist/`, banco, `.env`, tokens ou backups exportados.
- Modo remoto deve exigir token quando `NEXUS_REMOTE_MODE=true`.
- Mobile deve abrir o front, nao apenas a API backend.
- Backup local deve ser simples: baixar memoria e inserir backup.
- Offline no Mac deve continuar funcionando sem banco externo.
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

Backup:

- `GET /api/local-backup/status` mostra contagem de registros locais.
- `GET /api/local-backup/export` baixa `buds-memory-backup-*.json`.
- `POST /api/local-backup/import` importa backup em modo merge.

## Pontos Sensíveis

- `window.nexus` e `nexus-asset` sao legados tecnicos, nao renomear sem migracao.
- `NexusAssets` ainda e destino de assets no pacote Electron.
- `NEXUS_*` continua sendo familia de env vars de compatibilidade.
- `service worker` pode causar cache antigo em celular; incrementar cache quando mexer.
- Nunca remover banco local ao atualizar app.
- Nunca sobrescrever memorias locais ao importar backup; o fluxo deve ser merge.

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
curl http://127.0.0.1:5050/api/local-backup/status
```

## Resultado Esperado

App desktop e mobile previsiveis: abre sem IDE, conserva dados, permite baixar
e restaurar memoria local, e nao deixa usuario preso em tela branca ou token
confuso.
