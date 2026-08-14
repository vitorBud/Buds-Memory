# P0 — Voice Pipeline do Buds Memory

Data da validação: 13 de agosto de 2026.

Esta fase foi limitada à auditoria e ao P0: Voice, STT/TTS incrementais,
barge-in, cancelamento e métricas. Modelos, Memory, RAG, Context Engine,
Focus, Map, Obsidian e Local Sync foram preservados; o P1 não foi iniciado.

## Auditoria por plataforma

| Recurso | MacBook antes do P0 | iPhone antes do P0 | Estado após P0 |
| --- | --- | --- | --- |
| STT | faster-whisper local, final por upload, VAD por energia | Speech framework local com resultados parciais | Mac recebe snapshots parciais sem duplicar modelo; iPhone exige reconhecimento on-device |
| TTS | voz do sistema por frase ou Piper/Cadu local | Kokoro 82M/Dora local | chunker compartilhado; Piper entrega frases prontas durante o stream; Kokoro agenda PCM do callback |
| Streaming LLM | SSE do Ollama | tokens do llama.cpp/Qwen nativo | preservado e integrado à telemetria de Voice |
| Barge-in | somente interrupção manual | somente interrupção manual | escuta contínua automática, threshold/debounce próprios, voice processing e cancelamento ao confirmar fala |
| Cancelamento | AbortController parcial; Ollama/Piper podiam continuar | geração e voz canceláveis separadamente | socket Ollama, fila/áudio, processo Piper e geração/TTS nativos são invalidados em conjunto |
| Working Memory | explícita no Conversation Engine | histórico recente + memórias relevantes | não alterada no P0; trecho interrompido agora permanece no histórico da sessão |
| Long-term Memory | SQLite cognitivo completo | SQLite nativo local | preservada |
| RAG | BM25/embeddings/documentos/codebase | recuperação leve de memórias locais | preservado; P1/P2 pendentes |
| Knowledge Graph | completo no backend/Obsidian | visualização simplificada dos dados locais | preservado |
| Background | pool pós-resposta para cognição | background task de geração e runtime local | preservado |
| Thermal | recursos do Mac, sem política térmica específica | proteção nominal/fair/serious/critical no llama.cpp | proteção existente preservada; TTS continua com uma thread |

## Implementação compartilhada

- `VoiceEndpointDetector`: início de fala, pausa natural e fim de turno.
- `extractSpeakableChunks`: entrega frases por pontuação e limita parágrafos
  longos sem pontuação para reduzir o primeiro áudio.
- `VoiceTurnTelemetry`: registra `speech_start`, `speech_end`,
  `stt_first_partial`, `stt_final`, `llm_start`, `llm_first_token`,
  `tts_first_chunk`, `audio_start` e `response_end`.
- Métricas derivadas: latência STT, TTFT, primeiro áudio, LLM até áudio e
  tempo total do turno, publicadas como `[BudsVoicePerf]`.
- Voice Mode mantém o microfone em turnos automáticos e entra em captura
  conservadora de barge-in durante a fala do Buds.
- Trocar de tela ou abrir Configurações encerra captura e saída de voz.

## MacBook

- Captura web continua usando cancelamento de eco, redução de ruído e ganho
  automático.
- O MediaRecorder envia snapshot cumulativo a cada intervalo seguro para
  faster-whisper e mostra a transcrição parcial no Voice Mode.
- A instância lazy de faster-whisper é única e agora possui exclusão mútua.
- Uploads temporários de áudio são removidos em sucesso ou falha.
- Piper/Cadu é submetido conforme frases surgem; eventos de áudio são enviados
  assim que ficam prontos, mantendo a ordem.
- Barge-in fecha o SSE; o fechamento agora fecha também a conexão HTTP com o
  Ollama. O subprocesso Piper recebe sinal cooperativo de cancelamento.
- O trecho visível de uma resposta interrompida fica no histórico para que
  referências como “quero a segunda” continuem coerentes.

## iPhone

- `SFSpeechRecognizer` mantém resultados parciais, mas agora exige suporte
  on-device. Não há fallback silencioso para nuvem.
- A sessão usa `playAndRecord`/`voiceChat`, saída no alto-falante e voice
  processing do input para favorecer cancelamento de eco.
- Durante barge-in, texto parcial isolado não basta: energia sustentada precisa
  confirmar voz humana após o período de guarda.
- Kokoro/Dora continua local, quantizado, com uma thread. O callback do Sherpa
  agenda PCM incremental no `AVAudioEngine`; a frase completa é somente fallback
  para builds sem PCM incremental.
- Qwen/llama.cpp, modelo, limites térmicos e modo de baixo consumo não foram
  alterados.
- O trecho já gerado antes de uma interrupção é salvo somente como contexto da
  conversa, sem disparar cognição pesada.

## Testes e resultados

- Backend: 150 testes aprovados, incluindo 3 novos testes de Voice.
- Frontend/mobile: 16 testes aprovados, incluindo pausa, eco, barge-in,
  20 operações consecutivas, chunking e cálculos de telemetria.
- TypeScript/Vite: build aprovado.
- Capacitor: `ios:sync` aprovado.
- Swift/iOS arm64: build nativo aprovado sem assinatura.
- Piper/Cadu real: WAV local gerado com 107.052 bytes.
- Python: compilação de backend/Voice/LLM/cognição aprovada.
- ESLint dos arquivos tocados pelo P0: aprovado.

O lint global ainda aponta débitos anteriores em `StatusPanel.tsx` e
`BudsMap.tsx`, fora do escopo P0. Nenhum erro pertence aos arquivos de Voice.

## Performance, bateria e limites

O P0 adiciona as medições necessárias para obter números reais no dispositivo;
não foram inventadas comparações antes/depois sem uma sessão física controlada.
O primeiro áudio tende a cair porque TTS não espera mais a resposta completa e
parágrafos sem pontuação também são quebrados. No Mac, STT parcial adiciona
trabalho periódico de CPU enquanto o usuário fala, mas reutiliza uma única
instância e nunca roda em paralelo consigo mesmo. No iPhone, não foi adicionado
outro modelo: Speech on-device, Qwen e Kokoro existentes foram orquestrados.

O teste físico V7 de 10 minutos, temperatura, bateria e RAM exige execução no
iPhone real com Instruments/Xcode. Ele permanece como validação de produto,
não como falha de compilação. A próxima fase recomendada é coletar esses dados
em aparelho e calibrar thresholds; somente depois deve começar o P1 cognitivo.
