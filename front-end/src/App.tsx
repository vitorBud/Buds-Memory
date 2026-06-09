import { useState, useEffect, useCallback, useRef, type PointerEvent } from 'react'
import {
  BrainCircuit,
  Check,
  Database,
  FileCode2,
  ListChecks,
  MessageSquare,
  Pencil,
  Settings as SettingsIcon,
  Upload,
  X,
  House,
} from 'lucide-react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { StatusPanel } from './components/StatusPanel'
import { BrainMap } from './components/BrainMap'
import { JarvisCore } from './components/JarvisCore'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { getSessions, createSession, deleteSession, getSessionMessages, getBackendConfig, updateSessionTitle, getSessionKnowledge, importKnowledge, getSyncStatus, runSync, getCognitiveMemories, getKnowledgeGraph } from './services/api'
import type { AiState, Session, ActivityItem, InterfaceSettings, Message, KnowledgeSource, SyncStatus, CognitiveMemory, KnowledgeGraph } from './types'
import { formatSessionDate } from './utils/formatters'

const SETTINGS_KEY = 'nexus-interface-settings'
const FALLBACK_MODEL = 'qwen2.5-coder:7b'
const DEFAULT_MODELS = ['qwen2.5-coder:3b', FALLBACK_MODEL, 'qwen2.5-coder:14b']
type RailTab = 'memory' | 'files' | 'summary'
type AppView = 'home' | 'chat' | 'obsidian'

const DEFAULT_SETTINGS: InterfaceSettings = {
  theme: 'white',
  density: 'compact',
  showInsights: true,
  showBrainMap: true,
  showQuickPrompts: true,
  autoPlayAudio: true,
  webSearchEnabled: false,
  accentColor: 'white',
}

const OFFICIAL_THEMES = ['white', 'black', 'gold', 'silver'] as const

function getInitialSettings(): InterfaceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
    if (parsed.theme === 'light') parsed.theme = 'white'
    if (parsed.theme === 'dark') parsed.theme = parsed.accentColor === 'amber' ? 'gold' : 'black'
    if (!OFFICIAL_THEMES.includes(parsed.theme)) parsed.theme = DEFAULT_SETTINGS.theme
    if (!OFFICIAL_THEMES.includes(parsed.accentColor)) parsed.accentColor = parsed.theme
    return parsed
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

function KnowledgeImportPanel({
  sources,
  value,
  isImporting,
  onValueChange,
  onImportText,
  onImportFile,
}: {
  sources: KnowledgeSource[]
  value: string
  isImporting: boolean
  onValueChange: (value: string) => void
  onImportText: () => void
  onImportFile: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="knowledge-import-panel">
      <div className="knowledge-import-main">
        <button
          type="button"
          className="knowledge-file-button"
          onClick={() => fileRef.current?.click()}
          disabled={isImporting}
          title="Importar PDF, TXT ou Markdown"
        >
          <Upload size={14} />
          <span>Importar</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportFile(file)
          }}
        />
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onImportText()
          }}
          placeholder="Cole uma URL, pesquisa ou texto para a IA aprender"
          disabled={isImporting}
        />
        <button type="button" onClick={onImportText} disabled={isImporting || !value.trim()}>
          {isImporting ? 'Lendo...' : 'Aprender'}
        </button>
      </div>
      <div className="knowledge-learned-row">
        <span>Aprendido</span>
        {sources.length ? sources.slice(0, 3).map(source => (
          <strong key={source.id} title={source.summary}>
            {source.title}
          </strong>
        )) : (
          <em>Nenhum material importado ainda</em>
        )}
      </div>
    </div>
  )
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
  const didAutoLoadSessionRef = useRef(false)
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
  const [chatRevealActive, setChatRevealActive] = useState(false)
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([])
  const [knowledgeInput, setKnowledgeInput] = useState('')
  const [isImportingKnowledge, setIsImportingKnowledge] = useState(false)
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [cognitiveMemories, setCognitiveMemories] = useState<CognitiveMemory[]>([])
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null)
  const [activeView, setActiveView] = useState<AppView>(() => {
    if (window.location.hash === '#chat') return 'chat'
    if (window.location.hash === '#obsidian') return 'obsidian'
    return 'home'
  })

  useEffect(() => {
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.accent = settings.theme
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

  const refreshSyncStatus = useCallback(async () => {
    try {
      const status = await getSyncStatus()
      setSyncStatus(status)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const refreshCognitiveBrain = useCallback(async () => {
    try {
      const [memories, graph] = await Promise.all([
        getCognitiveMemories(220),
        getKnowledgeGraph(260),
      ])
      setCognitiveMemories(memories)
      setKnowledgeGraph(graph)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const updateSetting = <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'theme') next.accentColor = value as InterfaceSettings['accentColor']
      return next
    })
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

  const loadSessionData = useCallback(async (session: Session, announce = true) => {
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    clearMessages()

    const msgs = await getSessionMessages(session.id)
    const sources = await getSessionKnowledge(session.id)
    loadMessages(msgs)
    setKnowledgeSources(sources)
    if (announce) pushActivity(`Conversa carregada: ${session.title}`, 'violet')
  }, [clearMessages, loadMessages, pushActivity])

  useEffect(() => {
    let cancelled = false

    getSessions()
      .then(async loadedSessions => {
        if (cancelled) return
        setSessions(loadedSessions)
        const latestSession = loadedSessions[0]
        if (latestSession && !didAutoLoadSessionRef.current) {
          didAutoLoadSessionRef.current = true
          await loadSessionData(latestSession, false)
        }
      })
      .catch(console.error)

    refreshSyncStatus()
    refreshCognitiveBrain()
    getBackendConfig()
      .then(config => {
        if (cancelled) return
        const models = config.models?.length ? config.models : DEFAULT_MODELS
        setAvailableModels(models)
        setSelectedModel(models.includes(config.model) ? config.model : models[0] || FALLBACK_MODEL)
        setGoogleSearchAvailable(Boolean(config.google_search_available))
      })
      .catch(console.error)

    return () => {
      cancelled = true
    }
  }, [loadSessionData, refreshCognitiveBrain, refreshSyncStatus])

  useEffect(() => {
    if (settingsOpen) refreshSyncStatus()
  }, [settingsOpen, refreshSyncStatus])

  useEffect(() => {
    const target = window.location.hash
    if (target === '#chat') setActiveView('chat')
    if (target === '#obsidian') setActiveView('obsidian')
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
    setKnowledgeSources([])
    setKnowledgeInput('')
    clearMessages()
    setMsgCount(0)
    setLatency('')
    setSessions(prev => [session, ...prev])
    pushActivity('Nova conversa iniciada', 'cyan')
  }

  const handleSelectSession = async (session: Session) => {
    try {
      await loadSessionData(session)
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
      setKnowledgeSources([])
      setKnowledgeInput('')
      clearMessages()
    }
    pushActivity('Conversa deletada', 'rose')
  }

  const handleSendText = async (text: string) => {
    pushActivity(`Mensagem enviada: "${text.slice(0, 30)}..."`, 'cyan')
    await sendText(text)
    pushActivity('Resposta da IA recebida', 'violet')
    window.setTimeout(() => {
      void refreshCognitiveBrain()
    }, 1800)
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

  const handleImportKnowledgeFile = async (file: File) => {
    setIsImportingKnowledge(true)
    try {
      const sessionId = await ensureSession()
      const source = await importKnowledge(sessionId, { file })
      setKnowledgeSources(prev => [source, ...prev])
      void refreshCognitiveBrain()
      pushActivity(`Conhecimento importado: ${source.title}`, 'emerald')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao importar conhecimento.')
    } finally {
      setIsImportingKnowledge(false)
    }
  }

  const handleImportKnowledgeText = async () => {
    const value = knowledgeInput.trim()
    if (!value) return

    setIsImportingKnowledge(true)
    try {
      const sessionId = await ensureSession()
      const payload = value.startsWith('http://') || value.startsWith('https://')
        ? { url: value }
        : value.length > 180
          ? { text: value }
          : { query: value }
      const source = await importKnowledge(sessionId, payload)
      setKnowledgeSources(prev => [source, ...prev])
      setKnowledgeInput('')
      void refreshCognitiveBrain()
      pushActivity(`IA aprendeu: ${source.title}`, 'emerald')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao importar conhecimento.')
    } finally {
      setIsImportingKnowledge(false)
    }
  }

  const handleSyncNow = useCallback(async () => {
    setIsSyncing(true)
    try {
      const result = await runSync()
      setSyncStatus(result.status)
      pushActivity(`Sync Supabase: ${result.uploaded} registro(s)`, 'emerald')
    } catch (err) {
      pushActivity('Falha no sync Supabase', 'rose')
      alert(err instanceof Error ? err.message : 'Falha ao sincronizar Supabase.')
      void refreshSyncStatus()
    } finally {
      setIsSyncing(false)
    }
  }, [pushActivity, refreshSyncStatus])

  const handleOpenHome = () => {
    setActiveView('home')
    window.history.replaceState(null, '', window.location.pathname)
    window.scrollTo({ top: 0 })
  }

  const handleSmoothScrollToChat = () => {
    setActiveView('chat')
    setChatRevealActive(true)
    window.history.replaceState(null, '', '#chat')
    window.scrollTo({ top: 0 })
    window.setTimeout(() => setChatRevealActive(false), 1900)
  }

  const handleOpenObsidian = () => {
    setActiveView('obsidian')
    window.history.replaceState(null, '', '#obsidian')
    window.scrollTo({ top: 0 })
  }

  const hasMessages = messages.length > 0
  const railTabs: Array<{ id: RailTab; label: string; icon: typeof Database }> = [
    { id: 'memory', label: 'Memória', icon: Database },
    { id: 'files', label: 'Arquivos', icon: FileCode2 },
    { id: 'summary', label: 'Resumo', icon: ListChecks },
  ]

  const renderViewNav = (variant: 'floating' | 'inline') => (
    <nav className={`view-nav view-nav-${variant}`} aria-label="Trocar seção">
      <button type="button" className={activeView === 'home' ? 'is-active' : ''} onClick={handleOpenHome}>
        <House size={14} />
        <span>Início</span>
      </button>
      <button type="button" className={activeView === 'chat' ? 'is-active' : ''} onClick={handleSmoothScrollToChat}>
        <MessageSquare size={14} />
        <span>Chat</span>
      </button>
      <button type="button" className={activeView === 'obsidian' ? 'is-active' : ''} onClick={handleOpenObsidian}>
        <BrainCircuit size={14} />
        <span>Obsidian</span>
      </button>
      <button type="button" onClick={() => setSettingsOpen(true)}>
        <SettingsIcon size={14} />
        <span>Config</span>
      </button>
    </nav>
  )

  const handleLandingPointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    const relativeX = (event.clientX - rect.left) / rect.width - 0.5
    const relativeY = (event.clientY - rect.top) / rect.height - 0.5
    const tiltX = relativeY * -10
    const tiltY = relativeX * 10

    event.currentTarget.style.setProperty('--mouse-x', `${x.toFixed(2)}%`)
    event.currentTarget.style.setProperty('--mouse-y', `${y.toFixed(2)}%`)
    event.currentTarget.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`)
    event.currentTarget.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`)
    event.currentTarget.style.setProperty('--parallax-x', `${(relativeX * 28).toFixed(2)}px`)
    event.currentTarget.style.setProperty('--parallax-y', `${(relativeY * 28).toFixed(2)}px`)
  }

  const handleLandingPointerLeave = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty('--mouse-x', '50%')
    event.currentTarget.style.setProperty('--mouse-y', '50%')
    event.currentTarget.style.setProperty('--tilt-x', '0deg')
    event.currentTarget.style.setProperty('--tilt-y', '0deg')
    event.currentTarget.style.setProperty('--parallax-x', '0px')
    event.currentTarget.style.setProperty('--parallax-y', '0px')
  }

  return (
    <div className="scroll-experience" ref={pageRef}>
      {renderViewNav('floating')}

      {activeView === 'home' && (
      <section
        className="jarvis-landing"
        id="inicio"
        aria-label="Tela inicial Jarvis"
        onPointerMove={handleLandingPointerMove}
        onPointerLeave={handleLandingPointerLeave}
      >
        <div className="jarvis-cursor-aura" />
        <div className="jarvis-scanline" />
        <div className="jarvis-frame">
          <div className="jarvis-brand-lockup">
            <span>Nexus IA</span>
            <strong>Assistente local inteligente</strong>
          </div>

          <div className="jarvis-visual-stage">
            <JarvisCore key={settings.theme} />
            <div className="jarvis-reticle jarvis-reticle-a" />
            <div className="jarvis-reticle jarvis-reticle-b" />
            <div className="jarvis-data-stack">
              <span>MODELO</span>
              <strong>{selectedModel}</strong>
              <span>WEB</span>
              <strong>{googleSearchAvailable ? 'PRONTO' : 'OFFLINE'}</strong>
            </div>
          </div>

        </div>
      </section>
      )}

      {activeView === 'chat' && (
      <section className={`chat-scroll-scene ${chatRevealActive ? 'is-revealing' : ''}`} id="chat" ref={chatSceneRef}>
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
                    <button
                      type="button"
                      onClick={() => setKnowledgePanelOpen(value => !value)}
                      className={knowledgePanelOpen ? 'is-active' : ''}
                      title="Importar conhecimento"
                    >
                      <Upload size={15} />
                    </button>
                  </div>
                </div>

                {knowledgePanelOpen && (
                <KnowledgeImportPanel
                  sources={knowledgeSources}
                  value={knowledgeInput}
                  isImporting={isImportingKnowledge}
                  onValueChange={setKnowledgeInput}
                  onImportText={handleImportKnowledgeText}
                  onImportFile={handleImportKnowledgeFile}
                />
                )}

                {!hasMessages ? (
                  <div className="empty-state">
                    <div>
                      <span className="eyebrow">Pronto para operar</span>
                      <h2>Como posso ajudar hoje?</h2>
                      <p>Envie uma pergunta, cole um erro ou peça uma análise do seu código.</p>
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
                  showQuickPrompts={false}
                  showModelSelect={false}
                  showMeta={false}
                  density="compact"
                />
              </div>

            </section>
          </main>
        </div>

      </section>
      )}

      {activeView === 'obsidian' && (
      <section className="obsidian-scroll-scene" id="obsidian" ref={obsidianSceneRef}>
        <div className="obsidian-sticky-stage">
          <div className="obsidian-copy-panel">
            <span className="eyebrow">Obsidian neural</span>
            <h2>Cérebro IA</h2>
            <p>
              Rede viva do que o Nexus salvou: memórias, documentos, conceitos e relações aprendidas.
            </p>
            <div className="obsidian-progress-meter">
              <span />
            </div>
          </div>

          <div className="obsidian-stage-graph">
            <BrainMap
              key={settings.theme}
              messages={messages}
              knowledgeSources={knowledgeSources}
              cognitiveMemories={cognitiveMemories}
              knowledgeGraph={knowledgeGraph}
            />
          </div>
        </div>
      </section>
      )}

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
            models={availableModels}
            googleSearchAvailable={googleSearchAvailable}
            syncStatus={syncStatus}
            isSyncing={isSyncing}
            settings={settings}
            onModelChange={setSelectedModel}
            onSyncNow={handleSyncNow}
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
