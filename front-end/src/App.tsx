import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react'
import {
  Check,
  ChevronDown,
  Database,
  FileCode2,
  ListChecks,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { StatusPanel } from './components/StatusPanel'
import { ParticleNetwork } from './components/ParticleNetwork'
import { AiOrb } from './components/AiOrb'
import { BrainMap } from './components/BrainMap'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { getSessions, createSession, deleteSession, getSessionMessages, getBackendConfig, updateSessionTitle } from './services/api'
import type { AiState, Session, ActivityItem, InterfaceSettings, Message } from './types'
import { formatSessionDate } from './utils/formatters'

const SETTINGS_KEY = 'nexus-interface-settings'
const FALLBACK_MODEL = 'qwen2.5-coder:7b'
const DEFAULT_MODELS = ['qwen2.5-coder:3b', FALLBACK_MODEL, 'qwen2.5-coder:14b']
type RailTab = 'memory' | 'files' | 'summary'

const DEFAULT_SETTINGS: InterfaceSettings = {
  theme: 'dark',
  density: 'compact',
  showInsights: true,
  showBrainMap: true,
  showQuickPrompts: true,
  autoPlayAudio: true,
  webSearchEnabled: false,
}

function getInitialSettings(): InterfaceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'por', 'mais', 'menos', 'isso', 'esse',
  'essa', 'aqui', 'voce', 'você', 'esta', 'está', 'ser', 'ter', 'das', 'dos',
  'nas', 'nos', 'sim', 'não', 'nao', 'meu', 'minha', 'seu', 'sua', 'ele',
  'ela', 'tem', 'vai', 'fazer', 'sobre', 'apenas', 'agora', 'entao', 'então',
  'quando', 'onde', 'porque', 'qual', 'quais', 'cada', 'todo', 'toda',
])

function normalizeText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
}

function getConversationConcepts(messages: Message[]) {
  const counts = new Map<string, number>()

  messages.forEach(message => {
    if (message.text === '__thinking__') return
    normalizeText(message.text)
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word) && !word.includes('/'))
      .forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1))
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
}

function getDetectedFiles(messages: Message[]) {
  const fileRegex = /(?:[\w.-]+\/)*[\w.-]+\.(?:js|jsx|ts|tsx|py|json|css|html|md|sql|env|yml|yaml)/gi
  const files = new Map<string, number>()

  messages.forEach(message => {
    const matches = message.text.match(fileRegex) ?? []
    matches.forEach(match => files.set(match, (files.get(match) ?? 0) + 1))
  })

  return [...files.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
}

function getFirstUserMessage(messages: Message[]) {
  return messages.find(message => message.sender === 'user' && message.text !== '__thinking__')?.text ?? ''
}

// Painel lateral que resume conceitos recentes e memória curta da conversa.
function MemoryPanel({ messages }: { messages: Message[] }) {
  const concepts = getConversationConcepts(messages)
  const recent = messages.filter(message => message.text !== '__thinking__').slice(-5)

  return (
    <div className="rail-panel memory-panel">
      <div className="rail-panel-head">
        <span className="eyebrow">Memória ativa</span>
        <strong>{messages.length} registros</strong>
      </div>
      <div className="memory-stack">
        {concepts.length ? concepts.map(([label, count]) => (
          <div key={label} className="memory-chip">
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Sem conceitos capturados ainda.</div>
        )}
      </div>
      <div className="rail-list">
        {recent.map((message, index) => (
          <div key={`${message.sender}-${message.created_at ?? index}`} className="rail-list-item">
            <span>{message.sender === 'user' ? 'Usuário' : 'IA'}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Painel lateral que identifica arquivos, linguagens e sinais técnicos citados no chat.
function FilesPanel({ messages }: { messages: Message[] }) {
  const files = getDetectedFiles(messages)
  const codeMentions = getConversationConcepts(messages)
    .filter(([label]) => ['javascript', 'python', 'react', 'flask', 'erro', 'funcao', 'codigo', 'backend', 'frontend'].includes(label))

  return (
    <div className="rail-panel files-panel">
      <div className="rail-panel-head">
        <span className="eyebrow">Arquivos citados</span>
        <strong>{files.length} itens</strong>
      </div>
      <div className="rail-list">
        {files.length ? files.map(([file, count]) => (
          <div key={file} className="file-reference">
            <FileCode2 size={14} />
            <span>{file}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Nenhum arquivo citado nesta conversa.</div>
        )}
      </div>
      <div className="rail-panel-head compact">
        <span className="eyebrow">Sinais técnicos</span>
        <strong>{codeMentions.length}</strong>
      </div>
      <div className="memory-stack">
        {codeMentions.length ? codeMentions.map(([label, count]) => (
          <div key={label} className="memory-chip">
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Sem sinais técnicos detectados.</div>
        )}
      </div>
    </div>
  )
}

// Painel lateral que mostra uma visão compacta do estado atual da conversa.
function SummaryPanel({
  messages,
  aiState,
  latency,
  msgCount,
  selectedModel,
}: {
  messages: Message[]
  aiState: AiState
  latency: string
  msgCount: number
  selectedModel: string
}) {
  const firstQuestion = getFirstUserMessage(messages)
  const concepts = getConversationConcepts(messages).slice(0, 5)
  const questions = messages.filter(message => message.sender === 'user' && message.text.includes('?')).length

  return (
    <div className="rail-panel summary-panel">
      <div className="rail-panel-head">
        <span className="eyebrow">Resumo</span>
        <strong>{messages.length ? 'Conversa ativa' : 'Aguardando'}</strong>
      </div>
      <div className="summary-block">
        <span>Objetivo provável</span>
        <p>{firstQuestion || 'Nenhuma pergunta enviada ainda.'}</p>
      </div>
      <div className="brain-stats">
        <div>
          <span>Estado</span>
          <strong>{aiState}</strong>
        </div>
        <div>
          <span>Latência</span>
          <strong>{latency || '--'}</strong>
        </div>
        <div>
          <span>Mensagens</span>
          <strong>{msgCount}</strong>
        </div>
      </div>
      <div className="summary-block">
        <span>Assuntos</span>
        <p>{concepts.length ? concepts.map(([label]) => label).join(', ') : 'Sem assuntos suficientes.'}</p>
      </div>
      <div className="summary-block">
        <span>Sistema</span>
        <p>{selectedModel} · {questions} pergunta(s) detectada(s)</p>
      </div>
    </div>
  )
}

// Componente principal que conecta histórico, chat, configurações, voz e visualização Obsidian.
export default function App() {
  const pageRef = useRef<HTMLDivElement>(null)
  const chatSceneRef = useRef<HTMLElement>(null)
  const obsidianSceneRef = useRef<HTMLElement>(null)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [currentSessionCreatedAt, setCurrentSessionCreatedAt] = useState<string | null>(null)
  const [latency, setLatency] = useState('')
  const [msgCount, setMsgCount] = useState(0)
  const [, setActivityItems] = useState<ActivityItem[]>([])
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL)
  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS)
  const [googleSearchAvailable, setGoogleSearchAvailable] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<InterfaceSettings>(getInitialSettings)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [railTab, setRailTab] = useState<RailTab>('memory')
  const [showScrollHint, setShowScrollHint] = useState(true)

  useEffect(() => {
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.density = 'compact'
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const formatUptime = () => {
    const h = Math.floor(uptimeSeconds / 3600)
    const m = Math.floor((uptimeSeconds % 3600) / 60)
    const s = uptimeSeconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const pushActivity = useCallback((label: string, color: ActivityItem['color'] = 'cyan') => {
    const item: ActivityItem = { id: Date.now().toString(), label, time: 'agora', color }
    setActivityItems(prev => [item, ...prev].slice(0, 8))
  }, [])

  const updateSetting = <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const ensureSession = useCallback(async (): Promise<string> => {
    if (currentSessionId) return currentSessionId
    const session = await createSession()
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    setSessions(prev => [session, ...prev])
    pushActivity('Nova sessão criada', 'emerald')
    return session.id
  }, [currentSessionId, pushActivity])

  const handleSessionUpdate = useCallback((session: Session) => {
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setSessions(prev => prev.map(item => (
      item.id === session.id ? { ...item, ...session } : item
    )))
    pushActivity('Título criado pela primeira pergunta', 'emerald')
  }, [pushActivity])

  const { messages, isProcessing, sendText, sendAudio, stopOutput, clearMessages, loadMessages } = useChat({
    sessionId: currentSessionId,
    selectedModel,
    webSearchEnabled: settings.webSearchEnabled,
    onNeedSession: ensureSession,
    onStateChange: setAiState,
    onLatency: (ms) => setLatency(ms + 'ms'),
    onMsgCountChange: setMsgCount,
    onSessionUpdate: handleSessionUpdate,
    autoPlayAudio: settings.autoPlayAudio,
  })

  const { isRecording, seconds, toggle: toggleMic } = useRecorder({
    onStop: async (blob) => {
      pushActivity('Audio gravado e enviado para STT', 'amber')
      await sendAudio(blob)
      pushActivity('Resposta gerada pelo LLM', 'violet')
    },
    onStateChange: setAiState,
  })

  useEffect(() => {
    getSessions().then(setSessions).catch(console.error)
    getBackendConfig()
      .then(config => {
        const models = config.models?.length ? config.models : DEFAULT_MODELS
        setAvailableModels(models)
        setSelectedModel(models.includes(config.model) ? config.model : models[0] || FALLBACK_MODEL)
        setGoogleSearchAvailable(Boolean(config.google_search_available))
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    const clamp = (value: number) => Math.min(1, Math.max(0, value))

    const updateScrollProgress = () => {
      const viewport = window.innerHeight || 1
      const chatRect = chatSceneRef.current?.getBoundingClientRect()
      const obsidianRect = obsidianSceneRef.current?.getBoundingClientRect()

      if (chatRect && pageRef.current) {
        const progress = clamp((viewport - chatRect.top) / (viewport + chatRect.height))
        pageRef.current.style.setProperty('--chat-scroll', progress.toFixed(4))
        setShowScrollHint(progress < 0.72)
      }

      if (obsidianRect && obsidianSceneRef.current) {
        const progress = clamp((viewport - obsidianRect.top) / (viewport + obsidianRect.height))
        obsidianSceneRef.current.style.setProperty('--obsidian-scroll', progress.toFixed(4))
      }
    }

    updateScrollProgress()
    window.addEventListener('scroll', updateScrollProgress, { passive: true })
    window.addEventListener('resize', updateScrollProgress)

    return () => {
      window.removeEventListener('scroll', updateScrollProgress)
      window.removeEventListener('resize', updateScrollProgress)
    }
  }, [])

  const handleNewChat = async () => {
    const session = await createSession()
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    clearMessages()
    setMsgCount(0)
    setLatency('')
    setSessions(prev => [session, ...prev])
    pushActivity('Nova conversa iniciada', 'cyan')
  }

  const handleSelectSession = async (session: Session) => {
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    clearMessages()
    try {
      const msgs = await getSessionMessages(session.id)
      loadMessages(msgs)
      pushActivity(`Conversa carregada: ${session.title}`, 'violet')
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Deletar esta conversa?')) return
    await deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (currentSessionId === id) {
      setCurrentSessionId(null)
      setCurrentSessionTitle(null)
      setCurrentSessionCreatedAt(null)
      setDraftTitle('')
      setIsEditingTitle(false)
      clearMessages()
    }
    pushActivity('Conversa deletada', 'rose')
  }

  const handleSendText = async (text: string) => {
    pushActivity(`Mensagem enviada: "${text.slice(0, 30)}..."`, 'cyan')
    await sendText(text)
    pushActivity('Resposta da IA recebida', 'violet')
  }

  const handleEditCurrentTitle = () => {
    if (!currentSessionId) return
    setDraftTitle(currentSessionTitle || '')
    setIsEditingTitle(true)
  }

  const handleSaveCurrentTitle = async () => {
    if (!currentSessionId) return
    const title = draftTitle.trim()
    if (!title) return

    const updated = await updateSessionTitle(currentSessionId, title)
    setCurrentSessionTitle(updated.title)
    setCurrentSessionCreatedAt(updated.created_at)
    setSessions(prev => prev.map(session => (
      session.id === currentSessionId ? { ...session, ...updated } : session
    )))
    setIsEditingTitle(false)
    pushActivity('Título da conversa atualizado', 'emerald')
  }

  const handleDeleteCurrentChat = async () => {
    if (!currentSessionId) return
    await handleDeleteSession(currentSessionId)
  }

  const handleSmoothScrollToObsidian = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    obsidianSceneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasMessages = messages.length > 0
  const railTabs: Array<{ id: RailTab; label: string; icon: typeof Database }> = [
    { id: 'memory', label: 'Memória', icon: Database },
    { id: 'files', label: 'Arquivos', icon: FileCode2 },
    { id: 'summary', label: 'Resumo', icon: ListChecks },
  ]

  return (
    <div className="scroll-experience" ref={pageRef}>
      <section className="chat-scroll-scene" ref={chatSceneRef}>
        <div className={`app-shell ${focusMode ? 'is-focus-mode' : ''}`}>
          {!focusMode && (
            <Sidebar
              sessions={sessions}
              currentSessionId={currentSessionId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onNewChat={handleNewChat}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
              systemUptime={formatUptime()}
            />
          )}

          <main className="workspace">
            <TopBar
              aiState={aiState}
              sessionTitle={currentSessionTitle}
              latency={latency}
              historyHidden={focusMode}
              onToggleHistory={() => setFocusMode(value => !value)}
              settingsOpen={settingsOpen}
              onToggleSettings={() => setSettingsOpen(v => !v)}
              canStopOutput={isProcessing || aiState === 'speaking'}
              onStopOutput={stopOutput}
            />

            <section className="content-grid">
              <div className="chat-panel">
                <div className="chat-session-bar">
                  <div className="chat-title-editor">
                    {isEditingTitle ? (
                      <input
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleSaveCurrentTitle()
                          if (event.key === 'Escape') setIsEditingTitle(false)
                        }}
                        autoFocus
                        placeholder="Título da conversa"
                      />
                    ) : (
                      <strong>{currentSessionTitle || 'Nova conversa'}</strong>
                    )}
                    <span>
                      {currentSessionCreatedAt
                        ? formatSessionDate(currentSessionCreatedAt)
                        : currentSessionId ? 'Sessão ativa' : 'Nenhuma sessão salva'}
                    </span>
                  </div>

                  <div className="chat-session-actions">
                    {isEditingTitle ? (
                      <>
                        <button type="button" onClick={handleSaveCurrentTitle} disabled={!draftTitle.trim()} title="Salvar título">
                          <Check size={15} />
                        </button>
                        <button type="button" onClick={() => setIsEditingTitle(false)} title="Cancelar edição">
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={handleEditCurrentTitle} disabled={!currentSessionId} title="Editar título">
                        <Pencil size={15} />
                      </button>
                    )}
                    <button type="button" onClick={handleDeleteCurrentChat} disabled={!currentSessionId} title="Remover conversa atual">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {!hasMessages ? (
                  <div className="empty-state">
                    <div className="orb-station">
                      <ParticleNetwork count={28} maxDist={76} />
                      <div className="orb-layer">
                        <AiOrb state={aiState} size={96} />
                      </div>
                    </div>
                    <div>
                      <span className="eyebrow">Pronto para operar</span>
                      <h2>Como posso ajudar hoje?</h2>
                      <p>Envie uma pergunta, cole um erro ou peça uma análise do seu código.</p>
                      <a className="scroll-note" href="#obsidian" onClick={handleSmoothScrollToObsidian}>
                        <ChevronDown size={15} />
                        <span>Esta página continua: role para o cérebro IA</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <ChatWindow messages={messages} />
                )}

                <ChatInput
                  onSend={handleSendText}
                  isProcessing={isProcessing}
                  isRecording={isRecording}
                  recSeconds={seconds}
                  onMicToggle={toggleMic}
                  selectedModel={selectedModel}
                  models={availableModels}
                  onModelChange={setSelectedModel}
                  showQuickPrompts={settings.showQuickPrompts}
                  density="compact"
                />
              </div>

            </section>
          </main>
        </div>

        <a
          className={`scroll-cue ${showScrollHint ? '' : 'is-hidden'}`}
          href="#obsidian"
          onClick={handleSmoothScrollToObsidian}
          aria-label="Rolar suavemente para a seção Obsidian"
        >
          <span>Role para ver o cérebro IA</span>
          <small>2ª seção</small>
          <ChevronDown size={18} />
        </a>
      </section>

      <section className="obsidian-scroll-scene" id="obsidian" ref={obsidianSceneRef}>
        <div className="obsidian-sticky-stage">
          <div className="obsidian-copy-panel">
            <span className="eyebrow">Obsidian neural</span>
            <h2>Cérebro IA</h2>
            <p>
              Rede viva da conversa: memória, contexto, código e resposta conectados em tempo real.
            </p>
            <div className="obsidian-progress-meter">
              <span />
            </div>
          </div>

          <div className="obsidian-stage-graph">
            <BrainMap messages={messages} />
          </div>
        </div>
      </section>

      {settingsOpen && (
        <>
          <button
            className="settings-backdrop"
            type="button"
            aria-label="Fechar configurações"
            onClick={() => setSettingsOpen(false)}
          />
          <StatusPanel
            aiState={aiState}
            sessionId={currentSessionId}
            msgCount={msgCount}
            latency={latency}
            model={selectedModel}
            googleSearchAvailable={googleSearchAvailable}
            settings={settings}
            onSettingChange={updateSetting}
            onClose={() => setSettingsOpen(false)}
          >
            <div className="panel-block settings-insights-block">
              <div className="panel-heading">
                <span>Contexto da conversa</span>
                <ListChecks size={15} />
              </div>
              <div className="rail-tabs settings-rail-tabs" role="tablist" aria-label="Contexto da conversa">
                {railTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={railTab === id ? 'is-active' : ''}
                    onClick={() => setRailTab(id)}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {railTab === 'memory' && <MemoryPanel messages={messages} />}
              {railTab === 'files' && <FilesPanel messages={messages} />}
              {railTab === 'summary' && (
                <SummaryPanel
                  messages={messages}
                  aiState={aiState}
                  latency={latency}
                  msgCount={msgCount}
                  selectedModel={selectedModel}
                />
              )}
            </div>
          </StatusPanel>
        </>
      )}
    </div>
  )
}
