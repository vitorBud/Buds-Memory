# AGENTS.md

Indice e regras globais para agentes de codigo trabalhando no Aether Memory.

Este projeto nao deve ser recriado do zero. Ele ja possui backend Flask,
frontend React/Vite, app desktop Electron, memoria cognitiva, RAG, Obsidian,
voz, sincronizacao Supabase e acesso remoto. Sempre preserve a arquitetura
existente e faca mudancas incrementais.

## Equipe de Agentes

Use estes arquivos especializados conforme a tarefa:

- [Agente Frontend Liquid Glass](.agents/frontend-liquid-glass.md): UI, UX,
  Home, Chat, Voice Mode, configuracoes, responsividade e design system.
- [Agente Backend API](.agents/backend-api.md): Flask, rotas, Ollama, auth,
  sessoes, importacao, voz e estabilidade do backend.
- [Agente Memoria RAG Cognicao](.agents/memory-rag-cognition.md): memoria,
  perfil do usuario, RAG, contexto conversacional, documentos e resumos.
- [Agente Obsidian Graph](.agents/obsidian-graph.md): BrainMap, grafo visual,
  memorias, documentos, pontos, zoom, arraste e interacao.
- [Agente Desktop Mobile Sync](.agents/desktop-mobile-sync.md): Electron,
  PWA/mobile, acesso remoto, service worker, Supabase Sync e instalacao.

Quando uma tarefa tocar mais de uma area, combine os agentes relevantes. Exemplo:
importacao de PDF que aparece na Obsidian usa Memoria RAG Cognicao + Obsidian
Graph + Frontend Liquid Glass.

## Identidade do Produto

- Nome publico atual: `Aether Memory`.
- Nome curto permitido: `Aether`.
- A IA deve se apresentar como Aether Memory/Aether, criada por Vitor.
- Ao explicar o nome, use: Aether vem do eter, o quinto elemento da filosofia
  grega, associado ao espaco e ao conhecimento.
- Nao reintroduza textos publicos com `Nexus IA`, `Nexus AI` ou `Nexus Prime`.

Alguns nomes tecnicos legados ainda existem por compatibilidade e nao devem ser
alterados sem migracao cuidadosa:

- Variaveis `NEXUS_*`.
- Header `X-Nexus-Token`.
- Bridge Electron `window.nexus`.
- Scheme `nexus-asset`.
- Pasta empacotada `NexusAssets`.
- Tabela Supabase padrao `nexus_sync_records`.
- Chaves antigas de `localStorage` com prefixo `nexus-*`.

## Visao Rapida

O Aether Memory e um assistente local-first:

- LLM local via Ollama.
- Historico e conhecimento em SQLite.
- Sync opcional com Supabase.
- Web opcional via Google Custom Search.
- Voz offline com Piper e STT com faster-whisper.
- Obsidian/Second Brain com memorias, documentos, entidades e grafo.
- Codebase Indexer para entender projetos de codigo.
- App desktop macOS via Electron que tenta iniciar o backend automaticamente.

## Estrutura Principal

```text
Back-end/
  app.py                  API Flask principal, rotas /api/*
  agenty.py               Ollama, prompt principal, STT/TTS, Google Search
  database.py             Sessoes, mensagens e knowledge_sources
  database_v2.py          Migracoes cognitivas e tabelas do Second Brain
  cognitive_api.py        Blueprint /api/cognitive/*
  supabase_sync.py        Sync local-first com Supabase
  remote_access.py        Modo remoto, tokens, LAN/ngrok/Tailscale
  storage.py              Caminhos persistentes no dev e no Electron
  cognitive/
    memory.py             Short/medium/long/archive/Core Memory
    rag.py                Chunking, BM25, embeddings opcionais, contexto RAG
    conversation.py       Preparacao de contexto conversacional
    user_profile.py       Perfil do usuario
    knowledge_graph.py    Entidades e relacoes
    codebase_indexer.py   Indice estrutural de projetos
    summarizer.py         Resumos persistentes de conversas
    detector.py           Extracao cognitiva de conversas
    timeline.py           Eventos cognitivos
    insights.py           Insights automaticos
    projects.py           Projetos e sessoes relacionadas
    search.py             Busca interna unificada

front-end/
  src/App.tsx             Orquestracao das telas Home, Chat, Voice, Obsidian
  src/services/api.ts     Camada unica de chamadas HTTP
  src/types/index.ts      Contratos TypeScript compartilhados no front
  src/components/         UI principal
  src/components/panels/  Paineis de memoria, arquivos, resumo, etc.
  src/hooks/useChat.ts    Streaming do chat e fila offline
  src/hooks/useRecorder.ts Gravacao/transcricao
  src/index.css           Design system Liquid Glass e responsividade
  electron/main.cjs       App desktop e bootstrap do backend
  electron/preload.cjs    Bridge segura do Electron
  scripts/update-app.sh   Build/instalacao do app no macOS
```

## Comandos de Desenvolvimento

Backend:

```bash
cd Back-end
source ambiente/bin/activate
python app.py
```

Atalho macOS:

```bash
cd Back-end
./start_backend.sh
```

Frontend web:

```bash
cd front-end
npm run dev
```

Frontend acessivel no celular na mesma rede:

```bash
cd front-end
npm run dev:mobile
```

Build do frontend:

```bash
cd front-end
npm run build
```

App desktop:

```bash
cd front-end
npm run desktop
```

Atualizar app em `/Applications`:

```bash
cd front-end
npm run update:app
```

Validacao Python sem escrever cache fora do workspace:

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/aether_pycache ambiente/bin/python -m py_compile app.py agenty.py cognitive/*.py
```

## Dependencias

Backend:

- Arquivo oficial: `Back-end/requirements.txt`.
- Ambiente local comum: `Back-end/ambiente`.
- Nao comitar `ambiente/`, `.venv/`, `venv/`, `chat_history.db*`, `.env`,
  `Back-end/models/`, `front-end/dist/` ou `front-end/release/`.

Frontend:

- `front-end/package.json` usa React, Vite, TypeScript, Three.js,
  framer-motion, lucide-react e Electron.
- Use `npm run build` antes de concluir mudancas de front.

## Banco de Dados e Dados Locais

SQLite:

- Dev: `Back-end/chat_history.db`.
- Electron: definido por `NEXUS_DATA_DIR`, normalmente em Application Support.
- `database.py` cria tabelas base: `sessions`, `messages`, `knowledge_sources`.
- `database_v2.py` faz migracoes idempotentes para:
  `memories`, `user_profile_facts`, `kg_entities`, `kg_relations`, `projects`,
  `timeline_events`, `insights`, `embeddings`, `conversation_summaries`,
  `codebase_index`, `sync_state`.

Ao adicionar colunas/tabelas:

- Faca migracao idempotente em `database_v2.py`.
- Preserve bancos existentes do usuario.
- Nao apague ou recrie tabelas em producao local.

## Fluxo do Chat

Rotas principais:

- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/<id>/messages`
- `POST /api/sessions/<id>/knowledge`

Pontos importantes:

- `agenty.py` define `SYSTEM_STYLE`, modelo Ollama, Google Search, TTS/STT.
- `app.py` prepara historico, perfil, RAG, web search e streaming SSE.
- `cognitive/conversation.py` prepara contexto persistente e conversacional.
- `cognitive/detector.py` e `process_post_chat_cognition` rodam memoria e
  resumos em background apos respostas.
- Evite respostas gigantes por padrao; o prompt ja pede respostas curtas e
  completas, com detalhe somente quando o usuario pedir.

## Memoria, RAG e Obsidian

Memorias:

- `memory_type`: `short`, `medium`, `long`, `archive`.
- Core Memory usa `is_core`, `locked`, `user_confirmed`.
- Core Memory nao deve expirar nem ser podada automaticamente.
- Triviais devem ser filtradas pelo detector/memory antes de salvar.

Conhecimento importado:

- PDFs, URLs, textos e pesquisas entram em `knowledge_sources`.
- `rag.index_document` gera chunks em `embeddings`.
- `analyze_imported_document` gera metadados, topicos e resumos deterministas.

Obsidian:

- O front le `getCognitiveMemories` e `getKnowledgeGraph`.
- `BrainMap.tsx` deve mostrar memorias/conceitos de forma visual.
- Nao mude o contrato de `CognitiveMemory` ou `KnowledgeGraph` sem atualizar
  `front-end/src/types/index.ts` e `front-end/src/services/api.ts`.

## Codebase Indexer

Arquivo: `Back-end/cognitive/codebase_indexer.py`.

Ele indexa projetos locais em `codebase_index`, ignorando:

- `.git`
- `node_modules`
- `dist`
- `build`
- `release`
- `.venv`, `venv`, `ambiente`
- `__pycache__`

Ao melhorar busca de codigo, reaproveite:

- `index_codebase`
- `search_codebase`
- `analyze_file`
- endpoints `/api/cognitive/codebase/index` e `/api/cognitive/codebase/search`

## Sync Supabase

Arquivo: `Back-end/supabase_sync.py`.

Caracteristicas:

- Local-first: o app deve funcionar offline.
- Sync opcional via `SUPABASE_SYNC_ENABLED=1`.
- URL deve ser base do projeto Supabase, sem `/rest/v1`.
- A tabela padrao ainda e `nexus_sync_records` por compatibilidade.
- `run_sync(mode='both'|'push'|'pull')` envia snapshots e pode puxar chats.

Nao coloque chaves reais no codigo. Use `.env`.

## Acesso Remoto e Mobile

Arquivo: `Back-end/remote_access.py`.

Variaveis principais:

- `NEXUS_REMOTE_MODE`
- `NEXUS_AUTH_TOKEN`
- `NEXUS_PORT`
- `NEXUS_FRONTEND_PORT`
- `NEXUS_PUBLIC_URL`
- `NEXUS_PUBLIC_FRONTEND_URL`

O modo remoto exige token para APIs protegidas. Nao remova esse controle.

## Electron

Arquivo: `front-end/electron/main.cjs`.

Responsabilidades:

- Registrar `nexus-asset`.
- Localizar backend em dev ou build empacotado.
- Encontrar Python dentro de `ambiente`, `venv`, `.venv` ou sistema.
- Copiar `.env` para o diretorio de dados do app se necessario.
- Iniciar backend em `127.0.0.1:5050`.
- Abrir janela desktop com Aether Memory.

Ao mexer no Electron:

- Preserve `contextIsolation`.
- Nao exponha APIs Node diretamente ao renderer.
- Atualize tambem `preload.cjs` se mudar a bridge.
- Teste `npm run build` e, quando possivel, `npm run desktop`.

## Frontend e Design

Design esperado:

- Apple Liquid Glass.
- Compacto, premium, responsivo.
- Mobile Safari/Chrome deve funcionar.
- Evitar UI poluida no chat.
- Home, Chat, Voice, Obsidian e Configuracoes devem continuar existindo.

Regras praticas:

- Use componentes existentes antes de criar novos.
- `App.tsx` orquestra views e estado global.
- `StatusPanel.tsx` concentra configuracoes.
- `ChatWindow.tsx`, `ChatInput.tsx`, `Sidebar.tsx` compoem chat.
- `VoiceMode.tsx` cuida da conversa por voz.
- `BrainMap.tsx` cuida da Obsidian.
- `HomeBrain.tsx` cuida do cerebro da Home.
- Estilos principais ficam em `front-end/src/index.css`.
- Use `lucide-react` para icones.
- Nao crie landing page generica; a Home deve ser produto funcional.

Responsividade:

- Sempre revisar regras `@media (max-width: 760px)`.
- Cuidado com `100vh`; prefira `100dvh`/`100svh` quando ja usado.
- Evite elementos fixos cobrindo chat, nav mobile ou Obsidian.
- Bottom nav deve respeitar `env(safe-area-inset-bottom)`.

## API Frontend

Arquivo: `front-end/src/services/api.ts`.

Todas as chamadas HTTP devem passar por essa camada.

- Browser dev usa proxy Vite ou `VITE_API_BASE_URL`.
- Electron usa `window.nexus.apiBase`.
- Auth remoto usa Bearer token salvo no localStorage.
- `resolveUrl` trata audio no browser/Electron.

Ao adicionar endpoints:

- Adicione funcao tipada em `services/api.ts`.
- Atualize tipos em `types/index.ts`.
- Nao espalhe `fetch` direto em componentes, salvo motivo forte.

## Arquivos Gerados e Sensíveis

Nunca comitar:

- `.env`
- `Back-end/chat_history.db*`
- `Back-end/out/*.wav`
- `Back-end/ambiente/`, `.venv/`, `venv/`
- `Back-end/models/`
- `front-end/dist/`
- `front-end/release/`
- `.DS_Store`
- tokens como `Back-end/.nexus_remote_token`

Se aparecerem no git, remova do controle de versao sem apagar dados do usuario.

## Validacao Antes de Finalizar

Para mudancas de front:

```bash
cd front-end
npm run build
```

Para mudancas de backend:

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/aether_pycache ambiente/bin/python -m py_compile app.py agenty.py cognitive/*.py
```

Para mudancas em rotas:

```bash
curl http://127.0.0.1:5050/api/config
curl http://127.0.0.1:5050/api/health
```

Se o backend ja estiver usando a porta 5050, nao inicie segunda instancia sem
necessidade. Identifique e pare o processo antigo somente com permissao clara.

## Padrao de Mudanca

1. Leia o codigo existente antes de editar.
2. Preserve dados e compatibilidade local-first.
3. Reaproveite funcoes, hooks, servicos e componentes atuais.
4. Faca alteracoes pequenas e verificaveis.
5. Atualize tipos e camada API quando contratos mudarem.
6. Rode validacoes relevantes.
7. Explique o que mudou e o que nao foi testado.

## Cuidados Especiais

- Nao transforme o projeto em dependencia de nuvem. Offline precisa continuar.
- Nao remova suporte a Ollama local.
- Nao quebre o app Electron ao mudar caminhos.
- Nao substitua SQLite por Supabase; Supabase e sync, nao fonte unica.
- Nao remova memorias, banco, historico ou arquivos do usuario.
- Nao crie novas tabelas sem migracao idempotente.
- Nao salve mensagens triviais como memoria importante.
- Nao deixe a IA dizer que se chama outro nome.
- Nao reintroduza temas antigos alem de `black`, `gold` e `silver`, salvo pedido.
- Nao editar arquivos dentro de `front-end/release/`; gere novamente pelo build.

## Estado Atual Importante

- Modelo padrao leve: `qwen2.5-coder:3b`.
- Modelos conhecidos: `qwen2.5-coder:3b`, `qwen2.5-coder:7b`,
  `qwen2.5-coder:14b`.
- Porta backend padrao: `5050`.
- Porta mobile frontend padrao: `5174`.
- Tema desktop tende a iniciar em `black`; web padrao usa `silver`.
- Produto publico: `Aether Memory`.
- Compatibilidade tecnica legada ainda usa alguns nomes `NEXUS_*`.
