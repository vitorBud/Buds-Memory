# Pipeline de voz do Buds Memory

P0 iniciado em 13 de agosto de 2026; comportamento atual revisado em 17 de
agosto de 2026.

Este documento descreve o estado entregue do Voice. Memory, RAG, Context
Engine, Focus, Map, Obsidian e Local Sync continuam independentes do pipeline
de áudio.

## Estado por plataforma

| Recurso | MacBook/web | iPhone |
| --- | --- | --- |
| STT | faster-whisper local, snapshots parciais por upload | `SFSpeechRecognizer` com reconhecimento on-device |
| TTS | voz do sistema ou Piper local, alimentado por frases | Kokoro 82M, `pf_dora`, PCM local via Sherpa-ONNX |
| LLM | SSE do Ollama | tokens do Qwen3.5 4B via `llama.cpp` |
| Início da escuta | toque no núcleo | toque no núcleo |
| Interrupção | toque cancela stream/TTS e abre nova captura | toque cancela geração/PCM e abre nova captura |
| Escuta contínua | desativada | desativada |
| Sessão | chat de voz próprio | chat de voz próprio |

## Fluxo atual

1. O usuário toca o núcleo do Voice.
2. O TTS/geração anterior, se existir, é invalidado antes de abrir o microfone.
3. STT entrega parciais identificados por `recording_id`.
4. O fim de fala consolida o texto e inicia uma geração identificada por
   `generation_id` e `session_id`.
5. Frases completas são encaminhadas ao TTS enquanto a resposta ainda é gerada.
6. Trocar de tela, abrir Configurações ou tocar novamente encerra a operação
   corrente de forma cooperativa.

O microfone não fica reabrindo sozinho. A decisão foi intencional para evitar
ruído paralelo, feedback do alto-falante, erros `AU/VPIO render err: -1`,
interrupções sucessivas e consumo desnecessário no iPhone.

## Componentes compartilhados

- `VoiceEndpointDetector`: início, pausa natural e fim de fala.
- `extractSpeakableChunks`: libera frases por pontuação sem esperar a resposta
  inteira.
- `VoiceTurnTelemetry`: mede STT, TTFT, primeiro áudio e duração total.
- Identificadores impedem callbacks de uma captura antiga de modificar o turno
  atual.
- Cancelamento invalida conexão Ollama/llama.cpp, fila de TTS e reprodução.

## MacBook/web

- MediaRecorder usa cancelamento de eco, redução de ruído e ganho automático.
- Snapshots cumulativos alimentam uma única instância lazy do faster-whisper;
  transcrições periódicas nunca rodam em paralelo entre si.
- Arquivos temporários são removidos em sucesso, cancelamento ou falha.
- Piper pode começar por frase durante o streaming e recebe cancelamento
  cooperativo.
- O trecho visível de uma resposta interrompida pode permanecer no histórico da
  sessão para manter referências subsequentes coerentes.

## iPhone

- O Speech framework exige reconhecimento on-device; não há fallback silencioso
  para nuvem.
- A sessão de áudio usa `playAndRecord`/`voiceChat`, alto-falante e voice
  processing.
- Kokoro/Dora é local, quantizado e usa uma thread. O callback agenda PCM no
  player; frase completa é fallback para builds sem PCM incremental.
- O modelo é Qwen3.5 4B Q4_K_M. Políticas térmicas e de pouca energia continuam
  ativas.
- A voz leve ainda pode ter timbre sintético; isso é uma limitação de qualidade
  do modelo atual, não falha do pipeline ou uso de voz em nuvem.

## Validação

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/buds_pycache ambiente/bin/python -m unittest discover -s tests

cd ../front-end
npm run test:mobile
npm run build
npm run ios:sync
```

Os números exatos de testes devem ser lidos da execução atual, pois a suíte
cresce com o projeto. A validação física ainda deve cobrir dez minutos de voz,
interrupções repetidas, áudio silencioso, fala com pausas, Bluetooth, RAM,
bateria e temperatura no iPhone real.

Resultado da revisão de 17 de agosto de 2026: 151 testes de backend e 18 testes
mobile aprovados; ESLint, TypeScript e build Vite aprovados. O build nativo não
foi repetido nesta revisão exclusivamente documental.
