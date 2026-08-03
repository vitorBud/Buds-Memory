# Aether Memory

Aether Memory e um assistente local-first com chat, voz, memoria, RAG, Obsidian visual, backup portatil e app desktop via Electron.

O projeto roda com Ollama local, salva dados em SQLite e foi adaptado para macOS e Windows sem precisar trocar a API do frontend. No Mac ele preserva o visual mais pesado. No Windows ele usa um perfil visual mais leve para evitar travadas no Chromium/Electron.

## Recursos

- Chat com streaming via Ollama.
- Modelos locais: `qwen2.5-coder:3b`, `qwen2.5-coder:7b` e `qwen2.5-coder:14b`.
- Memoria cognitiva com short, medium, long, archive e Core Memory.
- RAG local com BM25 e embeddings opcionais.
- Importacao de PDFs, textos, URLs e pesquisas.
- Obsidian/Second Brain com grafo de memorias, documentos, topicos e entidades.
- Codebase Indexer para perguntar sobre arquivos, funcoes, classes, hooks, rotas e imports.
- Voz no navegador e TTS Piper local.
- STT com faster-whisper.
- Backup local em JSON para migrar memoria entre computadores.
- Acesso remoto opcional por LAN/VPN/Tailscale/ngrok/Cloudflare Tunnel.
- Aplicativo iOS via Capacitor, instalavel e atualizavel pelo Xcode/cabo.

## Estrutura

```text
Nexus-Assistent-v1/
  Back-end/
    app.py                    API Flask principal, porta 5050
    agenty.py                 Ollama, prompt, voz, STT/TTS e busca
    performance.py            roteamento de pipeline e orcamentos
    database.py               sessoes, mensagens e knowledge_sources
    database_v2.py            tabelas cognitivas e migracoes
    local_backup.py           exportacao/importacao da memoria local
    cognitive/                memoria, RAG, grafo, perfil, resumo e codebase
    llm/ollama_client.py      cliente Ollama
    voice/tts_stt.py          STT/TTS
  front-end/
    src/App.tsx               telas Home, Chat, Voice, Obsidian e Config
    src/index.css             design system e perfil Windows
    src/hooks/useChat.ts      streaming, audio e fila offline
    src/components/           UI principal
    src/utils/runtime.ts      deteccao de plataforma
    electron/                 app desktop
    ios/                      projeto nativo do iPhone
```

## Aplicativo para iPhone

O projeto iOS reaproveita a interface React e conecta com seguranca ao modelo,
memorias e documentos mantidos no Mac. Consulte o passo a passo em
[INSTALACAO_IPHONE.md](INSTALACAO_IPHONE.md).

## Requisitos

- Python 3.9+.
- Node.js 20+ recomendado.
- npm.
- Ollama instalado e rodando.
- Pelo menos um modelo Ollama baixado.

Modelos recomendados:

```powershell
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:7b
```

Opcional:

```powershell
ollama pull qwen2.5-coder:14b
```

## Instalacao no Windows

Backend:

```powershell
cd C:\Users\Vitor\Desktop\programacao\Nexus-Assistent-v1\Back-end
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python baixar_stt.py
python app.py
```

Frontend:

```powershell
cd C:\Users\Vitor\Desktop\programacao\Nexus-Assistent-v1\front-end
npm ci
npm run dev
```

Abra:

```text
http://localhost:5173
```

## Instalacao no macOS

Backend:

```bash
cd Back-end
python3 -m venv ambiente
source ambiente/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Frontend:

```bash
cd front-end
npm ci
npm run dev
```

## Portas

- Backend Flask: `http://127.0.0.1:5050`
- Frontend Vite: `http://localhost:5173`
- Frontend mobile/dev remoto: `5174` quando usado pelo script mobile

## Variaveis Uteis

```env
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_NUM_CTX=8192
OLLAMA_NUM_PREDICT=-1
OLLAMA_NUM_THREAD=12

GOOGLE_API_KEY=
GOOGLE_CSE_ID=

NEXUS_WINDOWS_HIGH_PERFORMANCE=1
NEXUS_WINDOWS_PIPER_TTS=0
NEXUS_RETRIEVAL_WORKERS=6
```

Notas:

- `NEXUS_WINDOWS_HIGH_PERFORMANCE=1` mantem Windows com orcamento forte.
- `NEXUS_WINDOWS_HIGH_PERFORMANCE=0` ativa modo economico no Windows.
- `NEXUS_WINDOWS_PIPER_TTS=1` religa Piper no backend Windows, mas pode pesar.
- O Mac nao usa o perfil visual Windows.

## Performance no Windows

O Windows usa um perfil proprio porque Chrome/Electron no Windows costuma sofrer com:

- `backdrop-filter` em areas grandes;
- sombras grandes em elementos que repintam;
- troca de telas com scale/opacity;
- canvas 3D junto de Ollama usando CPU/GPU;
- textarea medindo altura a cada tecla.

Adaptacoes feitas:

- HTML recebe `data-platform="windows"`.
- CSS remove blur pesado, sombras grandes e animacoes do Chat/Config/Obsidian no Windows.
- Troca de Home/Chat/Voice/Obsidian fica sem transicao no Windows.
- Textarea do chat tem altura fixa no Windows.
- HomeBrain e BrainMap usam menos pixel ratio, menos antialias e 30 FPS no Windows.
- Ollama no Windows usa ate 12 threads por padrao em maquina forte, deixando folga para UI.

## Backup Local

No app:

```text
Config > Backup > Baixar memoria
Config > Backup > Inserir backup
```

O backup exporta conversas, mensagens, PDFs/textos, memorias, perfil, resumos, grafo, embeddings, projetos e indice de codebase.

Pelo terminal:

```powershell
curl http://127.0.0.1:5050/api/local-backup/status
curl -o aether-memory-backup.json http://127.0.0.1:5050/api/local-backup/export
```

## Acesso Remoto

Modo local e padrao:

```powershell
python Back-end\app.py
```

Para LAN/VPN:

```powershell
$env:NEXUS_REMOTE_MODE="true"
$env:NEXUS_AUTH_TOKEN="troque-por-um-token-longo"
python Back-end\app.py
```

Em modo remoto, rotas `/api/*` exigem token, exceto health/login/status.

## Comandos de Validacao

Backend:

```powershell
cd Back-end
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests
```

Frontend:

```powershell
cd front-end
npm run build
```

Health:

```powershell
curl http://127.0.0.1:5050/api/health
curl http://127.0.0.1:5050/api/config
```

## Troubleshooting

### Venv nao ativa no PowerShell

Use:

```powershell
.\.venv\Scripts\Activate.ps1
```

`source activate` e comando de shell Unix/conda, nao de PowerShell.

### Chat nao responde

Confira:

```powershell
ollama list
curl http://127.0.0.1:5050/api/config
```

### Porta 5050 ocupada

Existe outro backend rodando. Feche o terminal/app antigo antes de iniciar outro.

### Front travando no Windows

Reinicie o Vite depois das mudancas:

```powershell
cd front-end
npm run dev
```

Se ainda travar, teste com voz automatica desligada e com a tela Home/Obsidian fechada. O chat deve ficar mais liso com o perfil Windows ativo.

## Arquivos que Nao Devem Ir Para o Git

- `.env`
- `Back-end/chat_history.db*`
- `Back-end/out/*.wav`
- `Back-end/.venv/`, `Back-end/ambiente/`, `venv/`
- `Back-end/models/`
- `front-end/node_modules/`
- `front-end/dist/`
- `front-end/release/`
- backups `aether-memory-backup-*.json`

## Status Esperado

- Backend online em `127.0.0.1:5050`.
- Frontend online em `localhost:5173`.
- Ollama com pelo menos um modelo instalado.
- Chat responde por texto.
- Backup exporta JSON.
- Obsidian abre sem congelar o chat no Windows.
