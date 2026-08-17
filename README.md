# Buds Memory

Buds Memory é um assistente local-first com chat, voz, memória cognitiva, RAG,
Obsidian visual, Focus, mapa contextual, backup portátil e aplicativos para
desktop e iPhone. Os dados pessoais permanecem em SQLite local; recursos de
nuvem são opcionais.

No macOS e no Windows, o Buds usa Flask + Ollama. No iPhone, o chat principal
usa um runtime nativo independente, com Qwen3.5 4B quantizado e aceleração
Metal. A mesma interface React/Tailwind é compartilhada entre web, Electron e
Capacitor, com ajustes específicos de desempenho por plataforma.

## Recursos atuais

- Chat com streaming, histórico por sessão, pastas personalizáveis e execução
  mantida ao trocar de tela.
- Ollama local no desktop, com suporte conhecido a
  `qwen2.5-coder:3b`, `qwen2.5-coder:7b` e `qwen2.5-coder:14b`.
- Qwen3.5 4B Q4_K_M local no iPhone, executado por `llama.cpp`/Metal.
- Memória cognitiva `short`, `medium`, `long`, `archive` e Core Memory.
- RAG local com BM25 e embeddings opcionais; importação de PDF, texto, URL e
  pesquisa.
- Anexo de PDF no iPhone com extração PDFKit, armazenamento por conversa e
  recuperação local de trechos relevantes para o Qwen3.5 4B.
- Obsidian/Second Brain com memórias, documentos, tópicos, entidades e relações.
- Buds Focus com tarefas, lembretes, Inbox, Timeline e captura contextual a
  partir do chat.
- Buds Map com lugares salvos, trajetos e contexto semântico. Desktop/web
  oferecem download regional; no iPhone, o mapa-base ainda usa internet.
- Context Engine determinístico: sensores → código → contexto → modelo.
- Voz separada do chat de texto. No iPhone, STT on-device e Kokoro 82M/Dora;
  no desktop, faster-whisper e voz do sistema ou Piper.
- Buds Local Sync v1: Focus nos dois sentidos; chats, pastas e memórias do
  iPhone são enviados somente ao Mac.
- Backup local em JSON para migração/recuperação do banco desktop.
- Codebase Indexer para busca estrutural em projetos locais.
- Acesso web remoto opcional e autenticado por LAN/VPN/Tailscale/túnel.

## Plataformas e dados

| Execução | Motor de chat | Banco principal | Precisa do Mac | Token remoto |
| --- | --- | --- | --- | --- |
| App macOS/Windows | Ollama via Flask | SQLite desktop | Não | Não |
| Web local no computador | Ollama via Flask | SQLite desktop | Backend local | Não |
| Web em outro aparelho | Ollama via Flask no computador | SQLite desktop | Sim | Sim |
| App nativo iPhone | Qwen3.5 4B via `llama.cpp` | SQLite do iPhone | Não | Não |

O Local Sync não mistura os dois motores. Ele transfere dados autorizados entre
as instalações por pareamento manual na rede local.

## Estrutura principal

```text
Back-end/
  app.py                         API Flask e streaming, porta 5050
  agenty.py                      prompt, Ollama, STT/TTS e busca web opcional
  database.py                    sessões, mensagens e fontes de conhecimento
  database_v2.py                 migrações cognitivas idempotentes
  local_backup.py                exportação/importação portátil
  local_sync.py                  pareamento e Buds Local Sync v1
  cognitive/                     memória, RAG, grafo, Focus e contexto
  llm/ollama_client.py           cliente Ollama
  voice/tts_stt.py               faster-whisper e Piper
front-end/
  src/App.tsx                    orquestra Home, Chat, Voice, Obsidian,
                                 Focus, Map e Configurações
  src/tailwind.css               tokens globais, base e regras de plataforma
  src/styles/                    classes Tailwind por tela/componente
  src/components/               interface React
  src/services/api.ts            camada tipada de API
  electron/                      aplicativo desktop
  ios/                           aplicativo nativo do iPhone
```

## Requisitos do desktop/web

- Python 3.9 ou mais recente.
- Node.js 20 ou mais recente recomendado.
- npm.
- Ollama instalado e em execução.
- Pelo menos um modelo Ollama baixado.

```bash
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:7b
# opcional, para máquinas com mais memória:
ollama pull qwen2.5-coder:14b
```

## Desenvolvimento no macOS

Backend:

```bash
cd Back-end
python3 -m venv ambiente          # somente se o ambiente ainda não existir
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

Abra `http://localhost:5174`.

## Desenvolvimento no Windows

Backend, a partir da raiz clonada:

```powershell
cd Back-end
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python baixar_stt.py
python app.py
```

Frontend:

```powershell
cd front-end
npm ci
npm run dev
```

Abra `http://localhost:5174`.

## Portas

- Backend Flask: `http://127.0.0.1:5050`.
- Frontend Vite: `http://localhost:5174`.
- O Vite anuncia a URL da rede local, mas chamadas `/api` pela LAN só são
  liberadas quando o modo remoto autenticado está ativo.

## Aplicativo desktop

Executar em desenvolvimento:

```bash
cd front-end
npm run desktop
```

Gerar e instalar a versão atual em `/Applications` no macOS:

```bash
cd front-end
npm run update:app
```

O Electron inicia o backend automaticamente e preserva os dados em Application
Support. Não abra uma segunda instância do Flask na mesma porta sem necessidade.

## Aplicativo para iPhone

O app iOS funciona sem Flask, Ollama ou token. Modelo, conversas, memórias,
Focus, lugares e trajetos ficam no armazenamento privado do aparelho. Consulte
[INSTALACAO_IPHONE.md](INSTALACAO_IPHONE.md) para preparação, instalação e
atualização pelo Xcode/cabo.

## Buds Local Sync

- Pareamento manual com código de seis dígitos e credencial própria.
- Descoberta Bonjour somente durante a janela de pareamento.
- Focus sincroniza nos dois sentidos.
- Chats, pastas, mensagens e memórias vão do iPhone para o Mac; o Mac não envia
  esses domínios pesados de volta ao iPhone.
- O usuário inicia a sincronização; não há serviço de nuvem nem GPS envolvido.

Local Sync e acesso web remoto são recursos diferentes. O guia do navegador em
outro aparelho está em [BUDS_MOBILE_REMOTE.md](BUDS_MOBILE_REMOTE.md).

## Backup local do desktop

No app, abra `Configurações > Armazenamento/Backup`. A exportação inclui
conversas, mensagens, conhecimentos, memórias, perfil, resumos, grafo,
embeddings, projetos e índice de codebase. A importação usa merge e não apaga o
banco atual.

Pelo terminal:

```bash
curl http://127.0.0.1:5050/api/local-backup/status
curl -o buds-memory-backup.json http://127.0.0.1:5050/api/local-backup/export
```

## Variáveis úteis

Copie `Back-end/.env.example` para um `.env` local e preencha apenas o que usar.
Os nomes `NEXUS_*` são mantidos por compatibilidade técnica; não representam o
nome público do produto.

```env
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_NUM_CTX=8192
OLLAMA_NUM_PREDICT=-1

GOOGLE_API_KEY=
GOOGLE_CSE_ID=

NEXUS_WINDOWS_HIGH_PERFORMANCE=1
NEXUS_WINDOWS_PIPER_TTS=0
NEXUS_REMOTE_MODE=false
```

## Desempenho por plataforma

O macOS preserva o visual Liquid Glass completo. No Windows, o atributo
`data-platform="windows"` reduz blur, sombras, animações e custo de canvas sem
reduzir a inteligência do modelo. HomeBrain e BrainMap usam pixel ratio/FPS
controlados, e o Piper do backend é opt-in no Windows.

No iPhone, limites de threads, resposta, temperatura e pouca energia são
aplicados pelo runtime nativo. Esses limites não trocam silenciosamente o
modelo instalado.

## Validação

Backend:

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/buds_pycache ambiente/bin/python -m unittest discover -s tests
```

Frontend/mobile:

```bash
cd front-end
npm run test:mobile
npm run build
```

iOS:

```bash
cd front-end
npm run ios:doctor
npm run ios:sync
```

Health local:

```bash
curl http://127.0.0.1:5050/api/health
curl http://127.0.0.1:5050/api/config
```

## Solução de problemas

- **Chat desktop não responde:** confirme `ollama list`, o backend na porta
  5050 e `GET /api/config`.
- **Porta 5050 ocupada:** feche o app/backend anterior antes de iniciar outro.
- **PowerShell não ativa o ambiente:** use `.\.venv\Scripts\Activate.ps1`.
- **iPhone não abre após instalar:** confie no certificado em
  `Ajustes > Geral > VPN e Gerenciamento de Dispositivo`.
- **Mapa sem imagem:** no iPhone, verifique a internet e a permissão de rede; no
  desktop/web, também é possível abrir uma região baixada.

## Arquivos que não devem ir para o Git

- `.env`, tokens e backups exportados.
- `Back-end/chat_history.db*`, `Back-end/out/*.wav` e `Back-end/models/`.
- `Back-end/ambiente/`, `.venv/` e `venv/`.
- `front-end/node_modules/`, `front-end/dist/` e `front-end/release/`.
- `front-end/ios/App/BudsNativeRuntime/Vendor/`.
- modelo GGUF e recursos Kokoro baixados pelos scripts iOS.

## Identidade

O nome público é **Buds Memory** ou **Buds**. “Buds” remete a brotos que crescem
e criam novas conexões: uma memória viva que evolui com as conversas e o
conhecimento do usuário. Alguns identificadores `NEXUS_*`, `window.nexus`,
`nexus-asset` e o bundle ID iOS antigo permanecem somente para compatibilidade.
