# Estabilização arquitetural do Aether Memory mobile

## Arquitetura verificada

- **Frontend/mobile:** React/Vite dentro do Capacitor. O `useChat` controla uma única requisição ativa; o `useRecorder` controla a captura e o endpoint de fala.
- **Voice no iPhone:** WebView → plugin Capacitor → `SFSpeechRecognizer`. O texto final retorna ao mesmo fluxo do chat local. O TTS usa a síntese do navegador e o microfone permanece desligado enquanto o Aether fala.
- **Conversation Engine mobile:** `AetherLocalRuntime` serializa a inferência em uma fila nativa e usa o `sessionId` para ler histórico.
- **LLM mobile:** llama.cpp com Qwen 7B local, contexto limpo antes de cada geração e apenas uma inferência válida por vez.
- **Banco mobile:** SQLite nativo com sessões, mensagens e memórias. Memórias agora possuem `scope` e `session_id`.
- **Backend desktop/web:** Flask monta contexto com perfil/Core Memory global, working memory/histórico/resumo da sessão, RAG filtrado por sessão e Ollama.
- **Cache:** não existe response/semantic cache de respostas no iPhone. No backend, `ingestion_cache` serve apenas à indexação e é removido com mensagens/documentos da sessão.

## Causas encontradas e correções

### Isolamento de chats

- **Causa real no iPhone:** toda mensagem não trivial virava registro na tabela global `memories`; o Prompt Builder reinjetava todos esses registros em qualquer chat. Excluir a sessão removia mensagens, mas não essas memórias.
- **Causa real no backend:** memórias derivadas tinham `session_id`, mas não tinham escopo explícito; a FK `ON DELETE SET NULL` podia preservar contexto conversacional como se fosse global.
- **Correção:** `global`, `conversation` e `detached` passam a ser persistidos. O prompt recebe apenas globais + memórias da sessão atual. Excluir chat apaga memórias conversacionais, mensagens, resumos, documentos/chunks e cache de ingestão associados, preservando perfil/Core Memory global.
- **Migração iOS:** fatos/Core antigos com importância compatível permanecem globais; tópicos automáticos antigos sem sessão recuperável ficam `detached` (visíveis na memória, nunca injetados no prompt).

### Captura que perdia o início

- **Causa real:** `chunksRef` e flags de emissão eram compartilhados entre gravações; `onstop` assíncrono de uma captura podia ler/resetar o buffer da seguinte.
- **Correção:** cada gravação fecha sobre seu próprio array de chunks e seu `recording_id`. Uma nova captura fica bloqueada até o `onstop` finalizar. O Blob só é criado depois do último `dataavailable`; o buffer só é liberado depois do envio.

### Voice cortando pausas e concorrência

- **Causa real:** encerramento dependia de um timestamp/limiar simples e callbacks nativos não tinham identidade. Resultado antigo podia alterar estado atual.
- **Correção:** máquina `waiting → speech-candidate → speaking → possible-pause → complete`, com debounce de ativação, duração mínima e silêncio contínuo. React, Capacitor e Swift validam `recording_id`; callbacks obsoletos são ignorados.
- **Barge-in:** o microfone não fica aberto durante TTS, eliminando feedback Aether→microfone. A interrupção é explícita pelo núcleo; primeiro invalida geração/TTS e depois abre uma nova captura.

### Geração concorrente

- Cada geração possui `generation_id` e `session_id`.
- Troca/exclusão de chat invalida a operação anterior.
- Tokens e resultados atrasados são descartados no React e no Swift.
- Uma resposta cancelada não é persistida no SQLite.

## Instrumentação adicionada

Logs estruturados usam o prefixo `[AetherPerf]`:

- `voice_capture`: duração, bytes, chunks, caracteres reconhecidos e ID.
- `llm_generation`: modelo, prompt, histórico, memórias, tokens, load, TTFT, geração, tokens/s, threads, CPU, RAM e pico observado, estado térmico.
- `tts`: provedor, caracteres e duração.
- `ui_health` a cada 30 s no iPhone: atraso do event loop, renders React, long tasks e heap JS quando o WebKit disponibiliza.

Esses dados são diagnóstico; não alteram amostragem, quantização ou qualidade do modelo.

## Profiling no iPhone

1. Conecte o iPhone, abra `front-end/ios/App/App.xcodeproj` e execute o app em modo Debug.
2. Em **Product → Profile**, use:
   - **Time Profiler** para CPU e funções quentes;
   - **Allocations** e **Leaks** para crescimento de RAM;
   - **Energy Log** para energia/temperatura;
   - **Metal System Trace** para offload GPU/Metal do llama.cpp;
   - **Network** apenas durante download do GGUF.
3. Faça uma captura fria (primeira geração/model load) e outra quente (modelo já carregado).
4. Marque 20 mensagens, 10 ciclos de voz, troca/exclusão de cinco chats e uma resposta longa.
5. Compare `generation_id` dos logs com os intervalos no Instruments. RAM deve estabilizar após aquecimento; tokens/s não devem degradar continuamente.

## Testes

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/aether_pycache ambiente/bin/python -m unittest discover -s tests

cd ../front-end
npm run test:mobile
npm run build
```

A suíte cobre isolamento Chat A/Chat B, exclusão, preservação de fato global, 20 mensagens, ruído, pausa natural e invalidação de operações em 20 ciclos. No aparelho, ainda são necessários testes físicos de microfone, TTS, carga térmica e Instruments porque simulador/CI não reproduzem acústica nem temperatura reais.
