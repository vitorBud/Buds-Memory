import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BrainCircuit,
  Check,
  Database,
  FileCode2,
  ListChecks,
  MessageSquare,
  Mic2,
  Pencil,
  Settings as SettingsIcon,
  Upload,
  X,
  House,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { StatusPanel } from './components/StatusPanel'
import { BrainMap } from './components/BrainMap'
import { BootScreen } from './components/BootScreen'
import type { SystemHealth } from './components/BootScreen'
import { NetworkStatus } from './components/NetworkStatus'
import { HomeBrain } from './components/HomeBrain'
import { VoiceMode } from './components/VoiceMode'
import type { VoiceSilenceMode } from './components/VoiceMode'
import { KnowledgeImportPanel } from './components/panels/KnowledgeImportPanel'
import { MemoryPanel } from './components/panels/MemoryPanel'
import { FilesPanel } from './components/panels/FilesPanel'
import { SummaryPanel } from './components/panels/SummaryPanel'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { useHealthPolling } from './hooks/useHealthPolling'
import { getSessions, createSession, deleteSession, getSessionMessages, getBackendConfig, updateSessionTitle, getSessionKnowledge, importKnowledge, getSyncStatus, runSync, pullCloudChats, getCognitiveMemories, getKnowledgeGraph } from './services/api'
import type { AiState, Session, ActivityItem, InterfaceSettings, SyncStatus, CognitiveMemory, KnowledgeGraph, KnowledgeSource } from './types'
import { formatSessionDate } from './utils/formatters'

const SETTINGS_KEY = 'nexus-interface-settings'
const DESKTOP_THEME_BOOT_KEY = 'nexus-desktop-theme-boot-v1'
const VOICE_URI_KEY = 'nexus-voice-uri-v1'
const VOICE_SILENCE_MODE_KEY = 'nexus-voice-silence-mode-v1'
const FALLBACK_MODEL = 'qwen2.5-coder:3b'
const DEFAULT_MODELS = [FALLBACK_MODEL, 'qwen2.5-coder:7b', 'qwen2.5-coder:14b']
type RailTab = 'memory' | 'files' | 'summary'
type AppView = 'home' | 'chat' | 'voice' | 'obsidian'

const DEFAULT_SETTINGS: InterfaceSettings = {
  theme: 'silver',
  density: 'compact',
  showInsights: true,
  showBrainMap: true,
  showQuickPrompts: true,
  autoPlayAudio: true,
  webSearchEnabled: false,
  accentColor: 'silver',
}

const OFFICIAL_THEMES = ['black', 'gold', 'silver'] as const
const VOICE_SILENCE_CONFIG: Record<VoiceSilenceMode, {
  silenceSeconds: number
  speechThreshold: number
  noSpeechTimeoutSeconds: number
}> = {
  fast: { silenceSeconds: 0.55, speechThreshold: 0.055, noSpeechTimeoutSeconds: 5 },
  balanced: { silenceSeconds: 0.78, speechThreshold: 0.06, noSpeechTimeoutSeconds: 7 },
  patient: { silenceSeconds: 1.18, speechThreshold: 0.052, noSpeechTimeoutSeconds: 10 },
}

function isDesktopApp() {
  return Boolean((window as unknown as { nexus?: { isDesktop?: boolean } }).nexus?.isDesktop)
}

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 760px)').matches
}

function getInitialSettings(): InterfaceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
    const shouldApplyDesktopDefault = isDesktopApp() && !localStorage.getItem(DESKTOP_THEME_BOOT_KEY)

    if (shouldApplyDesktopDefault) {
      parsed.theme = 'black'
      parsed.accentColor = 'black'
      localStorage.setItem(DESKTOP_THEME_BOOT_KEY, '1')
    }

    if (parsed.theme === 'light' || parsed.theme === 'white') parsed.theme = 'silver'
    if (parsed.theme === 'dark') parsed.theme = parsed.accentColor === 'amber' ? 'gold' : 'black'
    if (parsed.accentColor === 'white') parsed.accentColor = 'silver'
    if (!OFFICIAL_THEMES.includes(parsed.theme)) parsed.theme = DEFAULT_SETTINGS.theme
    if (!OFFICIAL_THEMES.includes(parsed.accentColor)) parsed.accentColor = parsed.theme
    return parsed
  } catch {
    return DEFAULT_SETTINGS
  }
}

function getInitialVoiceSilenceMode(): VoiceSilenceMode {
  const saved = localStorage.getItem(VOICE_SILENCE_MODE_KEY)
  return saved === 'fast' || saved === 'patient' || saved === 'balanced' ? saved : 'balanced'
}


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
  const [focusMode, setFocusMode] = useState(() => isMobileViewport())
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
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem(VOICE_URI_KEY) || '')
  const [voiceSilenceMode, setVoiceSilenceMode] = useState<VoiceSilenceMode>(getInitialVoiceSilenceMode)

  const handleBootDone = useCallback((h: SystemHealth) => {
    setSystemHealth(h)
    setBootDone(true)
    if (!['#chat', '#voice', '#obsidian'].includes(window.location.hash)) {
      setActiveView('home')
    }
  }, [])

  const [activeView, setActiveView] = useState<AppView>(() => {
    if (window.location.hash === '#chat') return 'chat'
    if (window.location.hash === '#voice') return 'voice'
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

  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' } | null>(null)

  const showToast = useCallback((message: string, type: 'info' | 'success' = 'info') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      setToast(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [toast])

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
        getCognitiveMemories(80),
        getKnowledgeGraph(120),
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

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model)
    localStorage.setItem('nexus_selected_model', model)
    pushActivity(`IA alterada para: ${model}`, 'violet')

    const friendlyNames: Record<string, string> = {
      'qwen2.5-coder:3b': 'IA Modo Rápido (3B)',
      'qwen2.5-coder:7b': 'IA Modo Padrão (7B)',
      'qwen2.5-coder:14b': 'IA Modo Inteligente (14B)',
    }
    const label = friendlyNames[model] || model
    showToast(`Modelo alterado para ${label}`, 'success')
  }, [pushActivity, showToast])

  const { messages, isProcessing, availableVoices, sendText, sendAudio, stopOutput, clearMessages, loadMessages } = useChat({
    sessionId: currentSessionId,
    selectedModel,
    webSearchEnabled: settings.webSearchEnabled,
    selectedVoiceURI,
    onNeedSession: ensureSession,
    onStateChange: setAiState,
    onLatency: (ms) => setLatency(ms + 'ms'),
    onMsgCountChange: setMsgCount,
    onSessionUpdate: handleSessionUpdate,
    autoPlayAudio: settings.autoPlayAudio,
  })

  const voiceRecorderConfig = VOICE_SILENCE_CONFIG[voiceSilenceMode]

  const { isRecording, seconds, volume: micVolume, toggle: toggleMic, cancel: cancelRecording } = useRecorder({
    onStop: async (blob) => {
      pushActivity('Audio gravado e enviado para STT', 'amber')
      await sendAudio(blob)
      pushActivity('Resposta gerada pelo LLM', 'violet')
    },
    onStateChange: setAiState,
    autoStopOnSilence: activeView === 'voice',
    silenceSeconds: activeView === 'voice' ? voiceRecorderConfig.silenceSeconds : 1.15,
    speechThreshold: activeView === 'voice' ? voiceRecorderConfig.speechThreshold : 0.075,
    maxSeconds: activeView === 'voice' ? 45 : 30,
    noSpeechTimeoutSeconds: activeView === 'voice' ? voiceRecorderConfig.noSpeechTimeoutSeconds : 10,
  })

  const handleVoiceChange = useCallback((voiceURI: string) => {
    setSelectedVoiceURI(voiceURI)
    if (voiceURI) localStorage.setItem(VOICE_URI_KEY, voiceURI)
    else localStorage.removeItem(VOICE_URI_KEY)
  }, [])

  const handleVoiceSilenceModeChange = useCallback((mode: VoiceSilenceMode) => {
    setVoiceSilenceMode(mode)
    localStorage.setItem(VOICE_SILENCE_MODE_KEY, mode)
  }, [])

  const loadSessionData = useCallback(async (session: Session, announce = true) => {
    stopOutput() // aborta fluxo anterior antes de mudar
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
  }, [clearMessages, loadMessages, pushActivity, stopOutput])

  useEffect(() => {
    if (!bootDone) return
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

    window.queueMicrotask(() => {
      void refreshSyncStatus()
      void refreshCognitiveBrain()
    })
    getBackendConfig()
      .then(config => {
        if (cancelled) return
        const models = config.models?.length ? config.models : DEFAULT_MODELS
        setAvailableModels(models)

        const savedModel = localStorage.getItem('nexus_selected_model')
        if (savedModel && models.includes(savedModel)) {
          setSelectedModel(savedModel)
        } else {
          setSelectedModel(models.includes(config.model) ? config.model : models[0] || FALLBACK_MODEL)
        }

        setGoogleSearchAvailable(Boolean(config.google_search_available))
      })
      .catch(console.error)

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]) // carrega dados depois que login/local foi liberado

  useEffect(() => {
    if (settingsOpen) {
      window.queueMicrotask(() => void refreshSyncStatus())
    }
  }, [settingsOpen, refreshSyncStatus])

  // Polling inteligente: backoff exponencial em falhas + pausa quando aba oculta
  useHealthPolling({
    enabled: bootDone,
    onHealthChange: setSystemHealth,
  })

  useEffect(() => {
    const target = window.location.hash
    window.queueMicrotask(() => {
      if (target === '#chat') setActiveView('chat')
      if (target === '#voice') setActiveView('voice')
      if (target === '#obsidian') setActiveView('obsidian')
    })
  }, [])

  useEffect(() => {
    const clamp = (value: number) => Math.min(1, Math.max(0, value))
    let frame = 0

    const updateScrollProgress = () => {
      frame = 0
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

    const scheduleScrollProgress = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateScrollProgress)
    }

    updateScrollProgress()
    window.addEventListener('scroll', scheduleScrollProgress, { passive: true })
    window.addEventListener('resize', scheduleScrollProgress)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleScrollProgress)
      window.removeEventListener('resize', scheduleScrollProgress)
    }
  }, [activeView])

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
    if (isMobileViewport()) setFocusMode(true)
    pushActivity('Nova conversa iniciada', 'cyan')
  }

  const handleSelectSession = async (session: Session) => {
    try {
      await loadSessionData(session)
      if (isMobileViewport()) setFocusMode(true)
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
      const loadedSessions = await getSessions()
      setSessions(loadedSessions)
      pushActivity(`Sync Supabase: ${result.uploaded} enviados, ${result.pulled ?? 0} puxados`, 'emerald')
    } catch (err) {
      pushActivity('Falha no sync Supabase', 'rose')
      alert(err instanceof Error ? err.message : 'Falha ao sincronizar Supabase.')
      void refreshSyncStatus()
    } finally {
      setIsSyncing(false)
    }
  }, [pushActivity, refreshSyncStatus])

  const handlePullCloudChats = useCallback(async () => {
    setIsSyncing(true)
    try {
      const result = await pullCloudChats()
      setSyncStatus(result.status)
      const loadedSessions = await getSessions()
      setSessions(loadedSessions)
      pushActivity(`Chats baixados da nuvem: ${result.pulled ?? 0}`, 'emerald')
    } catch (err) {
      pushActivity('Falha ao baixar chats da nuvem', 'rose')
      alert(err instanceof Error ? err.message : 'Falha ao baixar chats da nuvem.')
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
    if (isMobileViewport()) setFocusMode(true)
    setChatRevealActive(true)
    window.history.replaceState(null, '', '#chat')
    window.scrollTo({ top: 0 })
    window.setTimeout(() => setChatRevealActive(false), 1900)
  }

  const handleOpenVoice = () => {
    setSettings(prev => prev.autoPlayAudio ? prev : { ...prev, autoPlayAudio: true })
    setActiveView('voice')
    window.history.replaceState(null, '', '#voice')
    window.scrollTo({ top: 0 })
  }

  const handleExitVoice = () => {
    cancelRecording()
    stopOutput()
    setActiveView('chat')
    if (isMobileViewport()) setFocusMode(true)
    window.history.replaceState(null, '', '#chat')
    window.scrollTo({ top: 0 })
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
      <button type="button" className={activeView === 'voice' ? 'is-active' : ''} onClick={handleOpenVoice}>
        <Mic2 size={14} />
        <span>Voz</span>
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

  return (
    <div className="scroll-experience" ref={pageRef}>
      <NetworkStatus />

      <div className="network-status-container">
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="network-status-toast online model-change-toast"
            >
              <div className="network-status-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
                <BrainCircuit size={18} />
              </div>
              <div className="network-status-text">
                <strong>Modelo Alterado</strong>
                <span>{toast.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Tela de boot — aparece até todos os serviços serem verificados */}
      {!bootDone && <BootScreen onDone={handleBootDone} />}

      {renderViewNav('floating')}


      <AnimatePresence mode="wait" initial={false}>
        {activeView === 'home' && (
          <motion.section
            key="home"
            className="home-landing"
            id="inicio"
            aria-label="Tela inicial Nexus IA"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="home-content-column">
              <div className="home-brand-copy">
                <span>Nexus IA</span>
                <h1>Assistente local inteligente</h1>
              </div>
              
              <div className="home-brand-mark" aria-hidden="true">
                <HomeBrain
                  theme={settings.theme}
                  aiState={aiState}
                  memoryCount={cognitiveMemories.length}
                />
              </div>

              <div className="home-brand-copy">
                <p>Chat, memória Obsidian e configurações em uma experiência compacta e local.</p>
              </div>
              
              <div className="home-status-grid" aria-label="Estado do sistema">
                <div>
                  <small>Modelo</small>
                  <strong>{selectedModel}</strong>
                </div>
                <div>
                  <small>Busca</small>
                  <strong>{googleSearchAvailable ? 'Google pronto' : 'Offline'}</strong>
                </div>
                <div>
                  <small>Memórias</small>
                  <strong>{cognitiveMemories.length}</strong>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {activeView === 'chat' && (
          <motion.section
            key="chat"
            className={`chat-scroll-scene ${chatRevealActive ? 'is-revealing' : ''}`}
            id="chat"
            ref={chatSceneRef}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={`app-layout theme-${settings.theme} density-${settings.density}`}>
              <div className={`app-shell ${focusMode ? 'is-focus-mode' : ''}`}>
              {!focusMode && (
                <>
                  <button
                    type="button"
                    className="mobile-sidebar-scrim"
                    aria-label="Fechar histórico"
                    onClick={() => setFocusMode(true)}
                  />
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
                </>
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
                    systemHealth={systemHealth}
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
                      onModelChange={handleModelChange}
                      showQuickPrompts={false}
                      showModelSelect={false}
                      showMeta={false}
                      density="compact"
                    />
                  </div>
                </section>
              </main>
            </div>
            </div>
          </motion.section>
        )}

        {activeView === 'voice' && (
          <motion.div
            key="voice"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            style={{ minHeight: '100vh' }}
          >
            <VoiceMode
              aiState={aiState}
              theme={settings.theme}
              isRecording={isRecording}
              recSeconds={seconds}
              micVolume={micVolume}
              isProcessing={isProcessing}
              availableVoices={availableVoices}
              selectedVoiceURI={selectedVoiceURI}
              silenceMode={voiceSilenceMode}
              onMicToggle={toggleMic}
              onStopOutput={stopOutput}
              onVoiceChange={handleVoiceChange}
              onSilenceModeChange={handleVoiceSilenceModeChange}
              onExit={handleExitVoice}
            />
          </motion.div>
        )}

        {activeView === 'obsidian' && (
          <motion.section
            key="obsidian"
            className="obsidian-scroll-scene"
            id="obsidian"
            ref={obsidianSceneRef}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
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
                  onRefresh={refreshCognitiveBrain}
                />
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {settingsOpen && (
        <section className="settings-page-shell" aria-label="Configurações do Nexus IA">
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
            authMode={systemHealth?.authMode}
            authEmail={systemHealth?.userEmail}
            settings={settings}
            onModelChange={handleModelChange}
            onSyncNow={handleSyncNow}
            onPullCloudChats={handlePullCloudChats}
            onSettingChange={updateSetting}
            onClose={() => setSettingsOpen(false)}
            presentation="page"
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
        </section>
      )}
    </div>
  )
}
