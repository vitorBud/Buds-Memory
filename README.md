# 🎙️Assistente-de-Bate-Papo (Bypass Smart App Control)

Um assistente de voz interativo que combina reconhecimento de fala, processamento de linguagem natural por meio de modelos locais (LLM) e síntese de voz offline em português.

Esta versão foi adaptada para **contornar as restrições do Windows 11 Smart App Control**, garantindo que o projeto execute perfeitamente sem necessidade de desativar recursos de segurança do sistema.

---

## 🧠 Como funciona a arquitetura

O projeto combina três componentes principais:

```
🎤 Microfone
    │
    ▼
🌐 STT — Google Web Speech API (fala → texto)
    │   (Contorna bloqueio de DLLs do Smart App Control)
    ▼
🤖 LLM — Ollama / LLaMA 3.1 (texto → resposta do assistente)
    │   (Processamento local via HTTP)
    ▼
🔈 TTS — Piper Local (resposta → áudio sintetizado em português)
    │   (Executável nativo, 100% offline)
    ▼
🔊 Alto-falante
```

| Componente | Tecnologia | Tipo | Descrição |
|---|---|---|---|
| **STT** | [SpeechRecognition](https://github.com/Uberi/speech_recognition) (Google API) | Híbrido | Transcreve sua fala em texto de forma gratuita e sem necessidade de chaves de API. |
| **LLM** | [Ollama](https://ollama.com) + LLaMA 3.1 | 100% Local | Processador inteligente que gera as respostas sarcásticas do assistente. |
| **TTS** | [Piper TTS](https://github.com/rhasspy/piper) | 100% Local | Converte as respostas de texto para áudio utilizando o modelo de voz neural `pt_BR-faber-medium`. |

---

## 📁 Estrutura do Projeto

```
Local-TTS/
└── Back-end/
    ├── agenty.py               # Script principal (assistente de voz)
    ├── requirements.txt        # Dependências do Python atualizadas
    ├── config.json             # Configurações de som salvas (gerado no 1º uso)
    ├── piper/                  # Executável do Piper TTS
    │   ├── piper.exe
    │   └── ...
    ├── voz/                    # Modelo de voz em português brasileiro
    │   ├── pt_BR-faber-medium.onnx
    │   └── pt_BR-faber-medium.onnx.json
    └── out/                    # Arquivos de áudio gerados durante o uso
        ├── mic.wav             # Gravação capturada pelo microfone
        └── reply.wav           # Resposta falada gerada pelo Piper
```

---

## ⚙️ Pré-requisitos

### 1. Python 3.10+
Certifique-se de ter o Python instalado. Baixe em: https://www.python.org/downloads/

### 2. Ollama (servidor de IA local)
1. Instale o Ollama de forma oficial através de: https://ollama.com
2. Baixe o modelo LLaMA 3.1 rodando o comando no terminal:
   ```bash
   ollama run llama3.1
   ```
> O Ollama precisa estar ativo em segundo plano antes de iniciar o assistente.

---

## 🚀 Instalação e Execução

### 1. Clone o repositório
```bash
git clone https://github.com/flokill751/Local-TTS.git
cd Local-TTS
```

### 2. Configure o ambiente virtual e instale as dependências
Navegue até a pasta `Back-end` e execute os comandos abaixo para criar seu ambiente virtual e instalar as bibliotecas necessárias:

```powershell
cd Back-end

# Cria o ambiente virtual
python -m venv ambiente

# Ativa o ambiente virtual
.\ambiente\Scripts\Activate.ps1

# Instala as dependências (usa o módulo python para contornar bloqueios do pip)
python -m pip install -r requirements.txt
```

### 3. Rode o assistente de voz
Com o ambiente virtual ativado e o Ollama rodando em outro terminal, execute o script:
```powershell
python agenty.py
```

---

## 🔊 Configurando Dispositivos de Áudio (1º Uso)

Na primeira execução do script `agenty.py`, o programa detectará e exibirá uma lista de todos os dispositivos de som conectados à sua máquina.

1. **Escolha o microfone:** Digite o número correspondente ao microfone que você deseja usar.
2. **Escolha a saída de som:** Digite o número correspondente aos seus fones ou alto-falantes. 
   - *Dica:* A opção `Mapeador de som da Microsoft - Output` (geralmente número `3`) é recomendada, pois ela segue automaticamente o dispositivo de som definido como padrão na barra de tarefas do Windows.
3. Essas seleções serão armazenadas em `config.json`. 

> 💡 **Para redefinir o áudio:** Se desejar mudar de microfone ou fone de ouvido no futuro, basta deletar o arquivo `config.json` gerado na pasta `Back-end` e executar o assistente novamente para reconfigurar.
