# Agente Backend API

## Missao

Manter e evoluir a API Flask do Aether Memory sem quebrar chat, sessoes,
importacao de conhecimento, voz, auth remoto, Supabase Sync ou Electron.

## Arquivos Principais

- `Back-end/app.py`
- `Back-end/agenty.py`
- `Back-end/database.py`
- `Back-end/database_v2.py`
- `Back-end/cognitive_api.py`
- `Back-end/storage.py`
- `Back-end/remote_access.py`
- `Back-end/requirements.txt`

## Regras

- Nao recrie a API do zero.
- Preserve rotas existentes em `/api/*` e `/api/cognitive/*`.
- Preserve compatibilidade com Electron e Web.
- Mantenha porta padrao `5050`.
- Nao remova `X-Nexus-Token` nem variaveis `NEXUS_*` sem migracao.
- Nao exponha `.env`, tokens ou service role no front.
- O app deve continuar funcionando offline.
- Supabase e sync opcional, nao banco principal.
- O modelo padrao deve continuar leve, salvo pedido contrario.
- Mensagens de erro devem ser amigaveis e em portugues quando forem para o usuario.

## Fluxos Importantes

- Chat normal: `POST /api/chat`.
- Chat streaming: `POST /api/chat/stream`.
- Config: `GET /api/config`.
- Health: `GET /api/health`.
- Sessoes: `/api/sessions`.
- Conhecimento: `/api/sessions/<session_id>/knowledge`.
- Audio gerado: `/api/audio/<filename>`.
- Auth remoto/local/Supabase: `/api/auth/*`.

## Pontos Sensíveis

- `agenty.py` define identidade, prompt principal, Ollama, Google Search, TTS e STT.
- `app.py` prepara contexto, RAG, historico, perfil e streaming SSE.
- `database.py` guarda historico e knowledge_sources.
- `database_v2.py` deve ter migracoes idempotentes.
- `storage.py` muda caminhos entre desenvolvimento e app desktop.
- `remote_access.py` protege API em modo remoto.

## Validacao

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/aether_pycache ambiente/bin/python -m py_compile app.py agenty.py cognitive/*.py
```

Com backend rodando:

```bash
curl http://127.0.0.1:5050/api/config
curl http://127.0.0.1:5050/api/health
```

## Resultado Esperado

Backend estavel, local-first, com rotas consistentes e sem exigir reinicio do
usuario para recuperar falhas comuns.
