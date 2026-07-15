# Aether Memory

Aether Memory e um assistente local com chat, voz, memoria, RAG, importacao de conhecimento, Obsidian visual, sincronizacao local-first com Supabase e app desktop via Electron.

O nome vem de Aether, o eter: o quinto elemento da filosofia grega, associado ao espaco e ao conhecimento. A ideia do produto e ser um campo vivo de memoria, onde conversas, documentos, codigo e conexoes formam um segundo cerebro pessoal.

O projeto foi pensado para funcionar offline no Mac/Windows sempre que possivel. A IA roda com Ollama local, o historico fica em SQLite e a sincronizacao com Supabase e opcional.

## Recursos Principais

- Chat com streaming de resposta via Ollama.
- Modelos locais configuraveis: rapido, padrao e mais potente.
- Memoria cognitiva: short, medium, long e Core Memory.
- Obsidian/Second Brain: grafo visual de memorias, documentos, conceitos e relacoes.
- Importacao de PDFs, URLs, textos e pesquisas.
- RAG hibrido: chunks, BM25 offline, metadados e suporte opcional a embeddings locais.
- Codebase Indexer: indexa projetos e permite perguntas sobre arquivos, funcoes, classes, hooks, rotas e imports.
- Modo voz/conversacao.
- TTS offline com Piper.
- STT com faster-whisper.
- Busca Google opcional via Google Custom Search.
- Supabase Sync local-first.
- App macOS plug and play via Electron.

## Estrutura

```text
Nexus-Assistent-v1/
├── Back-end/
│   ├── app.py                    # API Flask principal, porta 5050
│   ├── agenty.py                 # Ollama, voz, STT/TTS e prompt principal
│   ├── database.py               # Historico, sessoes e conhecimento importado
│   ├── database_v2.py            # Tabelas cognitivas e migracoes
│   ├── supabase_sync.py          # Sync local-first com Supabase
│   ├── start_backend.sh          # Atalho para iniciar backend no macOS
│   ├── requirements.txt          # Dependencias Python
│   ├── supabase_schema.sql       # SQL para criar tabela de sync no Supabase
│   ├── cognitive/
│   │   ├── memory.py             # Memorias e Core Memory
│   │   ├── rag.py                # RAG e contexto de conhecimento
│   │   ├── codebase_indexer.py   # Indexador de projetos
│   │   ├── knowledge_graph.py    # Grafo de conhecimento
│   │   ├── summarizer.py         # Resumos persistentes
│   │   ├── detector.py           # Detecao cognitiva em conversas
│   │   ├── projects.py           # Projetos e sessoes relacionadas
│   │   ├── timeline.py           # Eventos cognitivos
│   │   └── search.py             # Busca interna
│   ├── voz/                      # Modelo de voz Piper
│   └── piper/                    # Binarios do Piper
├── front-end/
│   ├── src/                      # React/Vite
│   ├── electron/                 # App desktop Electron
│   ├── public/models             # Assets 3D
│   ├── public/textures           # Texturas
│   ├── package.json
│   └── scripts/update-app.sh
└── CROSS_PLATFORM.md
```

## Requisitos

### Obrigatorios

- macOS ou Windows.
- Python 3.9+.
- Node.js 20+ recomendado.
- npm.
- Ollama instalado e rodando.
- Pelo menos um modelo Ollama baixado.

### Recomendados

- `qwen2.5-coder:3b` para modo rapido.
- `qwen2.5-coder:7b` para uso padrao.
- `qwen2.5-coder:14b` para melhor raciocinio, se o Mac aguentar.
- 8 GB de RAM para modelos 3B.
- 16 GB ou mais para 7B/14B com mais conforto.

### Opcionais

- Supabase para sincronizacao em nuvem.
- Google Custom Search para busca web em tempo real.
- Modelo `faster-whisper-base` local para STT.
- Embeddings `sentence-transformers` para RAG semantico opcional.

## Instalacao

Clone o projeto:

```bash
git clone https://github.com/Nexus-Assitent-v1/Nexus-Assistent-v1.git
cd Nexus-Assistent-v1
```

## Backend

Entre na pasta do backend:

```bash
cd Back-end
```

Crie o ambiente virtual, se ainda nao existir:

```bash
python3 -m venv ambiente
```

Ative o ambiente no macOS/Linux:

```bash
source ambiente/bin/activate
```

No Windows PowerShell:

```powershell
.\ambiente\Scripts\Activate.ps1
```

Instale as dependencias:

```bash
python -m pip install -r requirements.txt
```

Se o comando `python` nao existir no macOS, use:

```bash
python3 -m pip install -r requirements.txt
```

## Ollama

Instale o Ollama:

```text
https://ollama.com
```

Baixe os modelos recomendados:

```bash
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:7b
```

Opcional, modelo mais pesado:

```bash
ollama pull qwen2.5-coder:14b
```

Confirme os modelos:

```bash
ollama list
```

O Ollama precisa estar ativo antes do chat responder.

## Variaveis de Ambiente

Crie o arquivo `Back-end/.env` baseado em `Back-end/.env.example`.

Exemplo:

```env
GOOGLE_API_KEY=
GOOGLE_CSE_ID=

SUPABASE_SYNC_ENABLED=0
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SYNC_TABLE=nexus_sync_records

OLLAMA_NUM_CTX=12288
OLLAMA_NUM_PREDICT=-1
OLLAMA_MODEL=qwen2.5-coder:7b
```

Observacoes:

- Nao coloque `/rest/v1` no final de `SUPABASE_URL`.
- Para uso local pessoal, `SUPABASE_SERVICE_ROLE_KEY` funciona, mas nao distribua app com essa chave.
- Se o Mac estiver travando, reduza `OLLAMA_NUM_CTX` para `8192` ou `4096`.
- O projeto carrega `.env` manualmente, entao `python-dotenv` nao e obrigatorio.

## Rodando em Desenvolvimento

### 1. Inicie o backend

Na pasta `Back-end`:

```bash
source ambiente/bin/activate
python app.py
```

Ou no macOS:

```bash
./start_backend.sh
```

O backend roda em:

```text
http://127.0.0.1:5050
```

Teste:

```bash
curl http://127.0.0.1:5050/api/config
```

### 2. Inicie o frontend

Em outro terminal:

```bash
cd front-end
npm install
npm run dev
```

O frontend roda em:

```text
http://localhost:5173
```

O Vite redireciona `/api` para:

```text
http://127.0.0.1:5050
```

## App macOS

O projeto possui Electron para gerar um app desktop.

Para abrir em modo desktop de desenvolvimento:

```bash
cd front-end
npm run desktop
```

Para gerar e instalar o app em `/Applications`:

```bash
cd front-end
npm run update:app
```

Esse script:

- builda o frontend;
- gera o app Electron;
- fecha o Aether Memory antigo, se estiver aberto;
- copia `Aether Memory.app` para `/Applications`;
- copia `Back-end/.env` para `~/Library/Application Support/Aether Memory/.env`;
- abre o app.

No app desktop, o Electron tenta iniciar o backend automaticamente em `127.0.0.1:5050`.

## Banco de Dados Local

O Aether Memory usa SQLite.

No desenvolvimento, o banco fica em:

```text
Back-end/chat_history.db
```

No app desktop, o banco fica em:

```text
~/Library/Application Support/Aether Memory/chat_history.db
```

Arquivos locais de banco e audio nao devem ser commitados.

## Supabase Sync

O Supabase e opcional. O app funciona offline sem ele.

### 1. Criar tabela no Supabase

No SQL Editor do Supabase, rode o arquivo:

```text
Back-end/supabase_schema.sql
```

Ele cria a tabela generica:

```text
nexus_sync_records
```

### 2. Configurar `.env`

```env
SUPABASE_SYNC_ENABLED=1
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_SYNC_TABLE=nexus_sync_records
```

Ou use `SUPABASE_ANON_KEY`, se suas policies permitirem.

### 3. Testar sync

Com backend ligado:

```bash
curl http://127.0.0.1:5050/api/sync/status
```

Pelo frontend/app, use o botao `Sincronizar agora`.

Se aparecer erro como `Failed to resolve`, confira:

- se o projeto Supabase nao esta pausado;
- se `SUPABASE_URL` esta correta;
- se a URL nao tem `/rest/v1`;
- se sua internet/DNS/VPN esta funcionando.

## Busca Google

Para ativar busca web em tempo real, use Google Custom Search JSON API.

No `.env`:

```env
GOOGLE_API_KEY=sua_api_key
GOOGLE_CSE_ID=seu_cse_id
```

No Google Programmable Search Engine, configure para pesquisar a web inteira se quiser resultados gerais.

Teste pelo app ativando `Buscar no Google` nas configuracoes e fazendo uma pergunta atual.

## Voz

### TTS

O TTS usa Piper local com:

```text
Back-end/voz/pt_BR-faber-medium.onnx
Back-end/voz/pt_BR-faber-medium.onnx.json
```

O backend procura o Piper nesta ordem:

1. `NEXUS_PIPER_BIN`;
2. binario em `Back-end/piper`;
3. `piper` no PATH.

### STT

O STT usa `faster-whisper`.

O modelo esperado fica em:

```text
Back-end/models/faster-whisper-base
```

Se precisar baixar:

```bash
cd Back-end
source ambiente/bin/activate
python baixar_stt.py
```

Chat por texto funciona mesmo sem STT.

## RAG, PDFs e Memoria

Quando voce importa PDF, texto, URL ou pesquisa:

- o conteudo completo e salvo em `knowledge_sources`;
- o texto e dividido em chunks;
- os chunks sao salvos em `embeddings`;
- o sistema gera resumo, topicos e entidades;
- o grafo cognitivo recebe conceitos detectados;
- a Obsidian passa a mostrar nos relacionados.

O RAG funciona offline com BM25. A busca semantica com `sentence-transformers` e opcional e controlada por:

```env
NEXUS_ENABLE_SEMANTIC_RAG=1
NEXUS_EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

Por padrao, o semantico pode ficar desligado para deixar o app mais leve.

## Codebase Indexer

Nas configuracoes do app existe a area `Codebase`.

Ela permite indexar uma pasta de projeto. O Aether Memory salva:

- arquivos;
- funcoes;
- classes;
- imports;
- hooks;
- rotas;
- endpoints;
- dependencias;
- componentes;
- resumo estrutural.

Depois disso, voce pode perguntar coisas como:

```text
Onde esta a funcao login?
Quais componentes usam useState?
Quais endpoints existem no backend?
Explique a estrutura desse projeto.
```

## Endpoints Importantes

```text
GET  /api/config
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/<id>/messages
GET  /api/sessions/<id>/knowledge
POST /api/sessions/<id>/knowledge
POST /api/chat
POST /api/chat/stream
GET  /api/sync/status
POST /api/sync/run
GET  /api/cognitive/health
GET  /api/cognitive/memory
GET  /api/cognitive/graph
POST /api/cognitive/codebase/index
GET  /api/cognitive/codebase/search
```

## Troubleshooting

### `zsh: command not found: python`

No macOS, use:

```bash
python3 app.py
```

Ou ative o ambiente:

```bash
source ambiente/bin/activate
python app.py
```

### `ModuleNotFoundError: No module named flask`

Voce nao esta no ambiente virtual ou nao instalou dependencias:

```bash
cd Back-end
source ambiente/bin/activate
python -m pip install -r requirements.txt
python app.py
```

### `Address already in use Port 5050`

Ja existe backend rodando na porta 5050.

Veja processos:

```bash
ps aux | grep app.py
```

Ou feche o app/terminal antigo antes de iniciar outro backend.

### Aviso `NotOpenSSLWarning` / LibreSSL

No macOS com Python do sistema, o `urllib3` pode avisar sobre LibreSSL. Em geral e apenas aviso. Se quiser evitar, instale Python recente via Homebrew ou python.org.

### Chat nao responde

Confira:

```bash
ollama list
curl http://127.0.0.1:5050/api/config
```

O Ollama precisa estar aberto e com modelo baixado.

### Supabase `Failed to resolve`

Provaveis causas:

- projeto Supabase pausado;
- `SUPABASE_URL` errada;
- DNS/VPN bloqueando;
- URL com `/rest/v1` no final.

Formato correto:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
```

### Frontend branco no Electron

Rode build novamente:

```bash
cd front-end
npm run build
npm run desktop
```

Para reinstalar:

```bash
npm run update:app
```

## Git e Arquivos Grandes

Nao commitar:

- `front-end/release/`;
- `front-end/dist/`;
- `Back-end/chat_history.db*`;
- `Back-end/models/`;
- ambientes virtuais;
- `.env`;
- arquivos gerados de audio.

Esses itens ja devem estar no `.gitignore`.

## Comandos Rapidos

Backend:

```bash
cd Back-end
source ambiente/bin/activate
python app.py
```

Frontend:

```bash
cd front-end
npm run dev
```

Build:

```bash
cd front-end
npm run build
```

Lint:

```bash
cd front-end
npm run lint
```

Atualizar app macOS:

```bash
cd front-end
npm run update:app
```

## Status Atual Esperado

Com tudo funcionando:

- backend responde em `http://127.0.0.1:5050/api/config`;
- frontend abre em `http://localhost:5173`;
- Ollama lista pelo menos um modelo;
- chat responde por texto;
- importacao de PDF cria conhecimento na Obsidian;
- Supabase sync fica online se `.env` estiver correto e projeto ativo;
- app desktop abre sem precisar iniciar backend pela IDE.
