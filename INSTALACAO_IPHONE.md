# Buds Memory no iPhone

O aplicativo iOS compartilha a interface React/Tailwind pelo Capacitor, mas o
chat principal é nativo e local. Ele usa **Qwen3.5 4B Instruct Q4_K_M** com
`llama.cpp` e aceleração Metal. Não depende do Flask, do Ollama, de token remoto
nem de o Mac permanecer ligado.

Conversas, pastas, memórias, Focus, lugares e trajetos ficam no SQLite privado
do iPhone. O mapa-base usa internet quando a região ainda não está no cache; os
dados de localização, contexto e trajetos continuam locais.

## O que funciona nativamente

- chat local com Qwen3.5 4B e contexto de 4096 tokens;
- sessões, pastas, mensagens e memórias isoladas por conversa;
- anexo de PDF/TXT na conversa, com extração e busca local de trechos;
- Buds Focus, Inbox e Timeline;
- Buds Map, lugares conhecidos, geofencing de baixo consumo, contexto
  semântico, gravação e visualização de trajetos;
- STT on-device com `SFSpeechRecognizer`;
- TTS local Kokoro 82M, voz feminina `pf_dora`, via Sherpa-ONNX;
- Voice Mode em sessão própria: toque no núcleo para ouvir; durante a fala,
  outro toque interrompe imediatamente e abre uma nova captura;
- Buds Local Sync com um Mac pareado na mesma rede.

Importação por URL, RAG semântico avançado, codebase e backup JSON completo
continuam no backend desktop. No iPhone, PDFs com texto selecionável são
extraídos localmente por PDFKit; documentos formados apenas por imagens ainda
precisam de OCR. O Local Sync leva Focus nos dois sentidos e envia
chats, pastas e memórias somente do iPhone para o Mac.

## Requisitos

- iPhone com iOS 16.4 ou mais recente;
- aproximadamente **2,71 GB decimais (2,52 GiB)** para o modelo;
- cerca de **4,86 GB livres (4,52 GiB)** antes de iniciar o download, pois o app
  exige o tamanho do GGUF mais 2 GiB de margem;
- Xcode completo e uma conta Apple configurada;
- internet para preparar dependências no Mac e baixar o modelo no primeiro uso.

Com uma conta Apple gratuita, a assinatura de desenvolvimento precisa ser
renovada periodicamente. O Apple Developer Program permite distribuições mais
duradouras.

## Preparar e instalar pelo cabo

1. Conecte o iPhone, desbloqueie-o e autorize **Confiar**.
2. Ative o Modo de Desenvolvedor no iPhone.
3. No Mac, execute:

```bash
cd front-end
npm install
npm run ios:open
```

`ios:open` prepara versões fixadas de `llama.cpp` e do runtime de voz,
compila o frontend, sincroniza os assets e abre o Xcode.

No Xcode:

1. selecione o projeto `App` e sua conta em
   `Signing & Capabilities > Team`;
2. **mantenha o bundle ID existente `com.vitor.aethermemory`**;
3. selecione o iPhone conectado como destino;
4. pressione **Run**.

O bundle ID é legado de propósito: ele permite atualizar a instalação já
existente sem perder o container que guarda o modelo, o banco, chats e memórias.
Não o renomeie e não apague o app se quiser preservar esses dados.

Se o iPhone disser que o desenvolvedor não é confiável, abra
`Ajustes > Geral > VPN e Gerenciamento de Dispositivo`, selecione o certificado
da sua conta e toque em **Confiar**.

## Primeira abertura e modelo 4B

Na primeira abertura, o Buds verifica o armazenamento e oferece o download do
arquivo `qwen3.5-4b-instruct-Q4_K_M.gguf`. O progresso é exibido e a instalação
só termina depois de validar tamanho e SHA-256.

Após a instalação, o chat funciona offline. O GGUF fica fora do Git e do pacote
inicial do app, no armazenamento privado do iPhone.

## Temperatura, bateria e memória

O runtime ajusta threads e extensão máxima da resposta em Modo de Pouca Energia
ou quando o iPhone aquece. Em estado térmico sério, a geração é pausada; em
estado crítico, o modelo pode ser descarregado da RAM. Isso altera velocidade e
tamanho da resposta, não substitui o Qwen3.5 4B por outro modelo.

Localização usa geofencing e mudanças significativas sempre que possível. GPS
preciso é reservado ao mapa aberto ou à gravação de trajeto. O modelo não fica
monitorando sensores em segundo plano.

## Proteção contra pouco espaço

- abaixo de 3 GiB livres, o app mostra um alerta preventivo;
- abaixo de 1,5 GB livres, o SQLite não é aberto para novas gravações;
- o download exige o tamanho do modelo mais 2 GiB de margem;
- erros `SQLITE_FULL` são apresentados sem recriar ou apagar o banco.

Em `Configurações > Armazenamento` é possível revisar o uso local e apagar
itens compatíveis de forma explícita.

## Buds Local Sync

1. Deixe Mac e iPhone na mesma rede.
2. No Mac, abra `Configurações > Local Sync`, gere o código e torne o Mac
   visível.
3. No iPhone, abra a mesma seção, localize o Mac e informe o código de seis
   dígitos.
4. Depois de pareado, use **Sincronizar agora**.

O pareamento usa Bonjour apenas durante uma janela curta e armazena uma
credencial própria. Ele não usa o token do acesso web remoto.

## Atualizar o app

```bash
cd front-end
npm run ios:sync   # prepara runtimes, compila React e sincroniza o Capacitor
npm run ios:open   # faz o sync e abre o Xcode
npm run ios:run    # faz o sync e permite selecionar o aparelho
npm run ios:doctor # diagnostica o ambiente iOS
```

Depois de `ios:open`, selecione o iPhone e pressione **Run** novamente. O Xcode
substitui a versão anterior e mantém o container quando o bundle ID não mudou.

Os scripts `setup-ios-llama.sh` e `setup-ios-voice.sh` fixam versões e hashes.
Os binários em `BudsNativeRuntime/Vendor`, o GGUF e os recursos de voz baixados
são gerados localmente e ignorados pelo Git.

## Privacidade

- modelo, mensagens, sessões, memórias e localização ficam no aparelho;
- o Qwen recebe apenas o contexto local necessário à conversa;
- o chat nativo não envia prompt ou histórico ao Mac;
- somente uma sincronização manual envia os domínios descritos ao Mac pareado;
- o modo web remoto autenticado é opcional e separado do aplicativo nativo.
