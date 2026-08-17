# Estabilização arquitetural mobile

Estado revisado em 17 de agosto de 2026.

## Arquitetura atual

- **Interface:** React/Vite/Tailwind dentro do Capacitor, com navegação e
  safe-area adaptadas ao iPhone.
- **Chat nativo:** `BudsLocalRuntime` serializa inferências e usa `sessionId` e
  `generationId` para impedir respostas cruzadas ou atrasadas.
- **LLM:** `llama.cpp` + Qwen3.5 4B Q4_K_M, contexto máximo de 4096 tokens e uma
  geração válida por vez.
- **Banco:** SQLite nativo com sessões, pastas, mensagens, memórias, Focus,
  documentos por conversa, localização, trajetos e estado do Local Sync.
- **PDF:** PDFKit extrai texto localmente; chunks determinísticos recuperam
  somente trechos relevantes antes do prompt, sem outra chamada ao Qwen.
- **Voz:** `SFSpeechRecognizer` on-device para STT e Kokoro 82M/Dora local para
  TTS. Voice usa sessão própria e não contamina o chat de texto aberto.
- **Interação de voz:** o microfone só abre quando o usuário toca o núcleo. Um
  toque durante a fala cancela áudio/geração e inicia uma nova captura.
- **Focus/Contexto:** captura determinística, lugares e eventos passam por
  código antes de qualquer contexto chegar ao modelo.
- **Mapa:** tiles online com cache/download regional, lugares e trajetos locais.
- **Local Sync v1:** Focus bidirecional; chats, pastas, mensagens e memórias são
  enviados somente do iPhone para o Mac.
- **Desktop/web:** Flask monta perfil, Core Memory, histórico, resumo, RAG e
  contexto; Ollama gera a resposta.

## Isolamento e exclusão de chats

- Memórias têm escopo `global`, `conversation` ou `detached`.
- O prompt recebe globais e memórias da sessão atual, nunca contexto de outra
  conversa por conveniência.
- Excluir chat remove mensagens e dados conversacionais associados; fatos/Core
  globais permanecem.
- Chats de voz são sessões próprias e aparecem no gerenciamento de
  armazenamento.
- Bancos antigos são migrados sem recriar tabelas: fatos duráveis continuam
  globais e registros sem sessão recuperável ficam `detached`.

## Captura, voz e concorrência

- Cada captura possui `recording_id`; cada geração, `generation_id` e
  `session_id`.
- Callbacks obsoletos são ignorados no React, Capacitor e Swift.
- O buffer de áudio pertence à gravação que o criou e só é liberado depois do
  último `dataavailable`/envio.
- Captura web usa cancelamento de eco, redução de ruído e ganho automático.
- No iPhone, `playAndRecord`/`voiceChat` e voice processing reduzem retorno do
  alto-falante para o microfone.
- Cancelar invalida STT, geração e TTS em conjunto; resposta cancelada não é
  persistida como se estivesse completa.
- Não existe escuta contínua em segundo plano. Isso reduz falsos disparos,
  consumo e conflitos do Audio Unit no iOS.

## Armazenamento e temperatura

- alerta abaixo de 3 GiB livres;
- banco bloqueado para novas gravações abaixo de 1,5 GB;
- download do GGUF exige 2,71 GB mais 2 GiB de margem;
- estado térmico sério pausa geração e estado crítico pode descarregar o modelo;
- Modo de Pouca Energia reduz custo sem trocar os pesos do Qwen3.5 4B.

## Instrumentação

Logs `[BudsPerf]` registram captura, geração, TTS e saúde da UI. Logs
`[BudsVoicePerf]` registram início/fim de fala, primeiro parcial/final do STT,
primeiro token, primeiro áudio e fim do turno. Eles servem para diagnóstico e
não alteram quantização ou qualidade.

## Profiling no iPhone

1. Abra `front-end/ios/App/App.xcodeproj` e execute no aparelho em Debug.
2. Em **Product > Profile**, use Time Profiler, Allocations, Leaks, Energy Log e
   Metal System Trace.
3. Compare uma geração fria com outra após o modelo já estar carregado.
4. Teste texto, Voice, troca/exclusão de chats, Focus, Map e Local Sync.
5. Relacione `generation_id`/`recording_id` dos logs aos intervalos no
   Instruments.

## Validação automatizada

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/buds_pycache ambiente/bin/python -m unittest discover -s tests

cd ../front-end
npm run test:mobile
npm run build
npm run ios:sync
```

Microfone, alto-falante, assinatura, temperatura e bateria ainda exigem teste
em iPhone físico; simulador e CI não reproduzem acústica ou pressão térmica.

Na revisão de 17 de agosto de 2026: 151 testes de backend e 18 testes mobile
passaram; ESLint, TypeScript e o build Vite também concluíram sem erros.
