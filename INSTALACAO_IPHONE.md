# Aether Memory no iPhone

O aplicativo iOS reaproveita a interface React/Tailwind pelo Capacitor, mas o
chat principal agora funciona de forma nativa e local no aparelho. Ele usa o
mesmo `Qwen2.5-Coder 7B Instruct` escolhido no Mac, quantizado em Q4_K_M, com
aceleração Metal pelo `llama.cpp`.

Conversas, sessões e memórias básicas ficam em um SQLite próprio do iPhone. O
chat não depende do Flask, do Ollama, do token remoto nem de o Mac estar ligado.
O backend do Mac continua intacto para o aplicativo desktop e para recursos que
ainda não foram portados, como importação completa de documentos, voz offline,
RAG avançado, backup e indexação de codebase.

## Requisitos

- iPhone com iOS 16.4 ou mais recente;
- aproximadamente 4,7 GB para o modelo e pelo menos 2 GB adicionais durante o
  download;
- Xcode completo e uma conta Apple configurada para instalar pelo cabo;
- internet apenas para o primeiro download do modelo no iPhone.

Com uma conta Apple gratuita, a assinatura de desenvolvimento precisa ser
renovada periodicamente. O Apple Developer Program permite distribuições mais
duradouras.

## Preparar e instalar pelo cabo

Conecte o iPhone, autorize `Confiar` e deixe o Modo de Desenvolvedor ligado.
Depois execute:

```bash
cd front-end
npm install
npm run ios:open
```

O comando `ios:open` baixa e valida o XCFramework oficial do `llama.cpp`, gera o
frontend e sincroniza o projeto iOS. No Xcode:

1. selecione o projeto `App` e a sua conta em `Signing & Capabilities > Team`;
2. mantenha o bundle ID `com.vitor.aethermemory`;
3. selecione o iPhone conectado como destino;
4. pressione `Run`.

O Xcode substitui a instalação anterior usando o mesmo bundle ID. Não apague o
app se quiser preservar o banco e o modelo já baixado.

## Primeira abertura e modelo 7B

Na primeira abertura, o Aether mostra o estado do armazenamento e solicita o
download do modelo oficial de aproximadamente 4,7 GB. O download apresenta o
progresso e só conclui a instalação depois de validar o SHA-256 do arquivo.

Depois disso, o chat funciona offline. O modelo é mantido fora do repositório e
fora do pacote Git; cada aparelho o baixa para o armazenamento privado do app.

## Temperatura e bateria

O modelo continua sendo 7B; ele não é substituído silenciosamente por um 3B.
Para controlar aquecimento, o runtime reduz threads e o tamanho máximo da
resposta no Modo de Pouca Energia ou quando o iPhone fica morno. Em estado
térmico sério, a geração é pausada com uma mensagem clara. Em estado crítico,
o modelo também é descarregado da memória. Ao normalizar a temperatura, basta
enviar novamente.

Esses ajustes alteram velocidade e extensão da resposta, não os pesos nem a
capacidade de raciocínio do modelo 7B.

## Proteção contra pouco espaço

- abaixo de 3 GB livres, o app exibe um alerta preventivo;
- abaixo de 1,5 GB livres, o SQLite não é aberto nem recebe gravações;
- o download do modelo só começa se houver espaço para o arquivo e mais 2 GB de
  margem;
- erros `SQLITE_FULL` são capturados e apresentados sem recriar nem apagar o
  banco.

Essas verificações usam a capacidade disponível informada pelo próprio iOS e
preservam os dados existentes.

## Atualizar o app

```bash
cd front-end
npm run ios:sync   # runtime nativo + build React + sincronização
npm run ios:open   # faz o mesmo e abre o Xcode
npm run ios:run    # faz o mesmo e seleciona um aparelho para executar
npm run ios:doctor # diagnóstico do ambiente iOS
```

O XCFramework é baixado de forma reproduzível pelo script
`scripts/setup-ios-llama.sh`; versão e SHA-256 ficam fixados no projeto. A pasta
binária `AetherNativeRuntime/Vendor` é ignorada pelo Git.

## Privacidade

- modelo, mensagens, sessões e memórias ficam no armazenamento privado do app;
- o chat local não envia prompt, histórico ou token ao Mac;
- o acesso remoto autenticado do projeto continua disponível no frontend web,
  mas não é necessário para o modo nativo do iPhone;
- o manifesto de privacidade declara a consulta de espaço em disco usada para
  proteção do modelo e do banco.
