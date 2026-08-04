import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react'
import {
  BrainCircuit,
  Check,
  Database,
  FileCode2,
  ListChecks,
  MessageSquare,
  Mic2,
  Pencil,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Upload,
  X,
  House,
  Smartphone,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Transition } from 'framer-motion'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { BootScreen } from './components/BootScreen'
import type { SystemHealth } from './components/BootScreen'
import { NetworkStatus } from './components/NetworkStatus'
import type { VoiceSilenceMode } from './components/VoiceMode'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { useMobilePerformanceMonitor } from './hooks/useMobilePerformance'
import { useHealthPolling } from './hooks/useHealthPolling'
import { getSessions, createSession, deleteSession, getSessionMessages, getBackendConfig, updateSessionTitle, getSessionKnowledge, importKnowledge, getLocalBackupStatus, exportLocalMemoryBackup, importLocalMemoryBackup, clearLocalStorage, getCognitiveMemories, getKnowledgeGraph, isNativeIOSRuntime } from './services/api'
import type { AiState, BackendConfig, Session, InterfaceSettings, LocalBackupStatus, CognitiveMemory, KnowledgeGraph, KnowledgeSource } from './types'
import { formatSessionDate } from './utils/formatters'
import { getRuntimePlatform, isIOSRuntime, isWindowsRuntime } from './utils/runtime'
import { toastStyles } from './styles/notificacoes'
import { sidebarStyles } from './styles/barraLateral'
import { chatSessionStyles } from './styles/sessaoChat'
import { chatSceneStyles, chatShellStyles } from './styles/estruturaChat'
import { navigationStyles } from './styles/navegacao'
import { settingsControlStyles } from './styles/controlesConfiguracoes'
import { settingsLayoutStyles } from './styles/estruturaConfiguracoes'
import { deferredSurfaceStyles, homeLoaderStyles, homeStyles } from './styles/inicio'
import { obsidianSceneStyles } from './styles/mapaObsidian'

const HomeBrain = lazy(() => import('./components/HomeBrain').then(module => ({ default: module.HomeBrain })))
const VoiceMode = lazy(() => import('./components/VoiceMode').then(module => ({ default: module.VoiceMode })))
const BrainMap = lazy(() => import('./components/BrainMap').then(module => ({ default: module.BrainMap })))
const AcessoCelular = lazy(() => import('./components/AcessoCelular').then(module => ({ default: module.AcessoCelular })))
const StatusPanel = lazy(() => import('./components/StatusPanel').then(module => ({ default: module.StatusPanel })))
const KnowledgeImportPanel = lazy(() => import('./components/panels/KnowledgeImportPanel').then(module => ({ default: module.KnowledgeImportPanel })))
const MemoryPanel = lazy(() => import('./components/panels/MemoryPanel').then(module => ({ default: module.MemoryPanel })))
const FilesPanel = lazy(() => import('./components/panels/FilesPanel').then(module => ({ default: module.FilesPanel })))
const SummaryPanel = lazy(() => import('./components/panels/SummaryPanel').then(module => ({ default: module.SummaryPanel })))

const SETTINGS_KEY = 'aether-interface-settings'
const DESKTOP_THEME_BOOT_KEY = 'aether-desktop-theme-boot-v1'
const VOICE_URI_KEY = 'aether-voice-uri-v1'
const VOICE_SILENCE_MODE_KEY = 'aether-voice-silence-mode-v1'
const AUDIO_DEFAULT_DISABLED_KEY = 'aether-audio-default-disabled-v1'
const MOBILE_CHAT_INTRO_KEY = 'aether-mobile-chat-intro-seen-v1'

// Migração transparente: lê chaves legadas nexus-* e move para aether-* uma única vez
;(function migrateStorageKeys() {
  const migrations: [string, string][] = [
    ['nexus-interface-settings', 'aether-interface-settings'],
    ['nexus-desktop-theme-boot-v1', 'aether-desktop-theme-boot-v1'],
    ['nexus-voice-uri-v1', 'aether-voice-uri-v1'],
    ['nexus-voice-silence-mode-v1', 'aether-voice-silence-mode-v1'],
    ['nexus_selected_model', 'aether_selected_model'],
  ]
  for (const [oldKey, newKey] of migrations) {
    try {
      if (!localStorage.getItem(newKey)) {
        const legacy = localStorage.getItem(oldKey)
        if (legacy !== null) {
          localStorage.setItem(newKey, legacy)
          localStorage.removeItem(oldKey)
        }
      }
    } catch { /* localStorage indisponível */ }
  }
})()
const FALLBACK_MODEL = 'qwen2.5-coder:3b'
const DEFAULT_MODELS = [FALLBACK_MODEL, 'qwen2.5-coder:7b', 'qwen2.5-coder:14b']
type RailTab = 'memory' | 'files' | 'summary'
type AppView = 'home' | 'chat' | 'voice' | 'obsidian' | 'mobile'

function DeferredSurface({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className={deferredSurfaceStyles.root} role="status" aria-live="polite">
      <span className={deferredSurfaceStyles.pulse} />
      <p className={deferredSurfaceStyles.copy}>{label}</p>
    </div>
  )
}

function HomeBrainLoader() {
  return (
    <div className={homeLoaderStyles.root} role="status" aria-live="polite">
      <div className={homeLoaderStyles.indicator}>
        <span className={homeLoaderStyles.pulse} aria-hidden="true" />
        <strong className={homeLoaderStyles.title}>Preparando memória visual</strong>
        <small className={homeLoaderStyles.subtitle}>Só um instante</small>
      </div>
    </div>
  )
}

const DEFAULT_SETTINGS: InterfaceSettings = {
  theme: 'silver',
  density: 'compact',
  showInsights: true,
  autoPlayAudio: false,
  voiceProvider: 'browser',
  webSearchEnabled: false,
  accentColor: 'silver',
}

const OFFICIAL_THEMES = ['black', 'gold', 'silver'] as const
const VOICE_SILENCE_CONFIG: Record<VoiceSilenceMode, {
  silenceSeconds: number
  speechThreshold: number
  noSpeechTimeoutSeconds: number
}> = {
  fast: { silenceSeconds: 1.0, speechThreshold: 0.07, noSpeechTimeoutSeconds: 5 },
  balanced: { silenceSeconds: 1.45, speechThreshold: 0.065, noSpeechTimeoutSeconds: 8 },
  patient: { silenceSeconds: 2.1, speechThreshold: 0.058, noSpeechTimeoutSeconds: 12 },
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
    if (parsed.voiceProvider !== 'browser' && parsed.voiceProvider !== 'piper') {
      parsed.voiceProvider = DEFAULT_SETTINGS.voiceProvider
    }
    if (isWindowsRuntime() && parsed.voiceProvider === 'piper') {
      parsed.voiceProvider = 'browser'
    }
    // Migra instalações antigas, cujo padrão era reproduzir toda resposta.
    // A marca impede que escolhas futuras do usuário sejam sobrescritas.
    if (!localStorage.getItem(AUDIO_DEFAULT_DISABLED_KEY)) {
      parsed.autoPlayAudio = false
      localStorage.setItem(AUDIO_DEFAULT_DISABLED_KEY, '1')
    }
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
  useMobilePerformanceMonitor('app')
  const obsidianSceneRef = useRef<HTMLElement>(null)
  const obsidianFileInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sidebarCloseTimerRef = useRef<number | null>(null)
  const didAutoLoadSessionRef = useRef(false)
  const sessionLoadRequestRef = useRef(0)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [currentSessionCreatedAt, setCurrentSessionCreatedAt] = useState<string | null>(null)
  const [latency, setLatency] = useState('')
  const [msgCount, setMsgCount] = useState(0)
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL)
  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS)
  const [googleSearchAvailable, setGoogleSearchAvailable] = useState(false)
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<InterfaceSettings>(getInitialSettings)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [focusMode, setFocusMode] = useState(() => isMobileViewport())
  const [sidebarClosing, setSidebarClosing] = useState(false)
  const [railTab, setRailTab] = useState<RailTab>('memory')
  const [chatRevealActive, setChatRevealActive] = useState(false)
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([])
  const [knowledgeInput, setKnowledgeInput] = useState('')
  const [isImportingKnowledge, setIsImportingKnowledge] = useState(false)
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false)
  const [backupStatus, setLocalBackupStatus] = useState<LocalBackupStatus | null>(null)
  const [isBackupBusy, setIsBackupBusy] = useState(false)
  const [isStorageBusy, setIsStorageBusy] = useState(false)
  const [cognitiveMemories, setCognitiveMemories] = useState<CognitiveMemory[]>([])
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null)
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem(VOICE_URI_KEY) || '')
  const [voiceSilenceMode, setVoiceSilenceMode] = useState<VoiceSilenceMode>(getInitialVoiceSilenceMode)

  const [activeView, setActiveView] = useState<AppView>(() => {
    if (window.location.hash === '#chat') return 'chat'
    if (window.location.hash === '#voice') return 'voice'
    if (window.location.hash === '#obsidian') return 'obsidian'
    if (window.location.hash === '#mobile') return 'mobile'
    return 'home'
  })
  const isWindowsUi = isWindowsRuntime()
  const isIOSUi = isIOSRuntime()
  const isNativeIOS = isNativeIOSRuntime()
  const lowCostUi = isWindowsUi || isIOSUi
  const viewTransition: Transition = isWindowsUi
    ? { duration: 0 }
    : isIOSUi
      ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
      : { duration: 0.28, ease: 'easeOut' }
  const viewMotionProps = isWindowsUi
    ? {
        initial: { opacity: 1, scale: 1 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 1, scale: 1 },
        transition: viewTransition,
      }
    : isIOSUi
      ? {
          initial: { opacity: 0, x: 10 },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -8 },
          transition: viewTransition,
        }
      : {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 1.02 },
        transition: viewTransition,
      }

  const handleBootDone = useCallback((h: SystemHealth) => {
    setSystemHealth(h)
    setBootDone(true)
    if (!['#chat', '#voice', '#obsidian', '#mobile'].includes(window.location.hash)) {
      setActiveView('home')
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'chat' || focusMode) return
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [activeView, focusMode])

  useEffect(() => () => {
    if (sidebarCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarCloseTimerRef.current)
    }
  }, [])

  const openSidebar = useCallback(() => {
    if (sidebarCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarCloseTimerRef.current)
      sidebarCloseTimerRef.current = null
    }
    setSidebarClosing(false)
    setFocusMode(false)
  }, [])

  const closeSidebar = useCallback(() => {
    if (!isMobileViewport()) {
      setFocusMode(true)
      return
    }
    if (focusMode || sidebarClosing) return
    setSidebarClosing(true)
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setFocusMode(true)
      setSidebarClosing(false)
      sidebarCloseTimerRef.current = null
    }, 220)
  }, [focusMode, sidebarClosing])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.accent = settings.theme
    document.documentElement.dataset.density = 'compact'
    document.documentElement.dataset.platform = getRuntimePlatform()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const formatUptime = () => {
    const h = Math.floor(uptimeSeconds / 3600)
    const m = Math.floor((uptimeSeconds % 3600) / 60)
    const s = uptimeSeconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

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

  const refreshLocalBackupStatus = useCallback(async () => {
    try {
      const status = await getLocalBackupStatus()
      setLocalBackupStatus(status)
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
    return session.id
  }, [currentSessionId])

  const handleSessionUpdate = useCallback((session: Session) => {
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setSessions(prev => prev.map(item => (
      item.id === session.id ? { ...item, ...session } : item
    )))
  }, [])

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model)
    localStorage.setItem('aether_selected_model', model)
    const friendlyNames: Record<string, string> = {
      'qwen2.5-coder:3b': 'IA Modo Rápido (3B)',
      'qwen2.5-coder:7b': 'IA Modo Padrão (7B)',
      'qwen2.5-coder:14b': 'IA Modo Inteligente (14B)',
    }
    const label = friendlyNames[model] || model
    showToast(`Modelo alterado para ${label}`, 'success')
  }, [showToast])

  const { messages, isProcessing, availableVoices, sendText, sendAudio, stopOutput, clearMessages, loadMessages } = useChat({
    sessionId: currentSessionId,
    selectedModel,
    webSearchEnabled: settings.webSearchEnabled,
    selectedVoiceURI,
    voiceProvider: settings.voiceProvider,
    onNeedSession: ensureSession,
    onStateChange: setAiState,
    onLatency: (ms) => setLatency(ms + 'ms'),
    onMsgCountChange: setMsgCount,
    onSessionUpdate: handleSessionUpdate,
    autoPlayAudio: activeView === 'voice' || settings.autoPlayAudio,
  })

  const voiceRecorderConfig = VOICE_SILENCE_CONFIG[voiceSilenceMode]

  const { isRecording, seconds, volume: micVolume, toggle: toggleMic, cancel: cancelRecording } = useRecorder({
    onStop: async (blob) => {
      await sendAudio(blob)
    },
    onTranscript: (text) => {
      void sendText(text)
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

  const loadSessionData = useCallback(async (session: Session) => {
    const requestId = ++sessionLoadRequestRef.current
    stopOutput() // aborta fluxo anterior antes de mudar
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    clearMessages()

    const [msgs, sources] = await Promise.all([
      getSessionMessages(session.id),
      getSessionKnowledge(session.id),
    ])
    if (sessionLoadRequestRef.current !== requestId) return false

    loadMessages(msgs)
    setKnowledgeSources(sources)
    return true
  }, [clearMessages, loadMessages, stopOutput])

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
          await loadSessionData(latestSession)
        }
      })
      .catch(console.error)

    window.queueMicrotask(() => {
      void refreshLocalBackupStatus()
      void refreshCognitiveBrain()
    })
    getBackendConfig()
      .then(config => {
        if (cancelled) return
        const models = config.models?.length ? config.models : DEFAULT_MODELS
        setAvailableModels(models)

        const savedModel = localStorage.getItem('aether_selected_model')
        if (savedModel && models.includes(savedModel)) {
          setSelectedModel(savedModel)
        } else {
          setSelectedModel(models.includes(config.model) ? config.model : models[0] || FALLBACK_MODEL)
        }

        setGoogleSearchAvailable(Boolean(config.google_search_available))
        setBackendConfig(config)
      })
      .catch(console.error)

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]) // carrega dados depois que login/local foi liberado

  useEffect(() => {
    if (settingsOpen) {
      window.queueMicrotask(() => void refreshLocalBackupStatus())
    }
  }, [settingsOpen, refreshLocalBackupStatus])

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
      if (target === '#mobile') setActiveView('mobile')
    })
  }, [])

  useEffect(() => {
    if (activeView !== 'obsidian') return

    const clamp = (value: number) => Math.min(1, Math.max(0, value))
    let frame = 0

    const updateScrollProgress = () => {
      frame = 0
      const viewport = window.innerHeight || 1
      const obsidianRect = obsidianSceneRef.current?.getBoundingClientRect()

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
    const requestId = ++sessionLoadRequestRef.current
    const session = await createSession()
    if (sessionLoadRequestRef.current !== requestId) return

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
    if (isMobileViewport()) closeSidebar()
  }

  const handleSelectSession = async (session: Session) => {
    try {
      const loaded = await loadSessionData(session)
      if (loaded && isMobileViewport()) closeSidebar()
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Deletar esta conversa?')) return
    await deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (currentSessionId === id) {
      sessionLoadRequestRef.current += 1
      setCurrentSessionId(null)
      setCurrentSessionTitle(null)
      setCurrentSessionCreatedAt(null)
      setDraftTitle('')
      setIsEditingTitle(false)
      setKnowledgeSources([])
      setKnowledgeInput('')
      clearMessages()
    }
  }

  const handleSendText = async (text: string) => {
    await sendText(text)
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

    titleInputRef.current?.blur()
    const updated = await updateSessionTitle(currentSessionId, title)
    setCurrentSessionTitle(updated.title)
    setCurrentSessionCreatedAt(updated.created_at)
    setSessions(prev => prev.map(session => (
      session.id === currentSessionId ? { ...session, ...updated } : session
    )))
    setIsEditingTitle(false)
  }

  const handleCancelTitleEdit = () => {
    titleInputRef.current?.blur()
    setDraftTitle(currentSessionTitle || '')
    setIsEditingTitle(false)
  }

  const handleImportKnowledgeFile = async (file: File) => {
    setIsImportingKnowledge(true)
    try {
      const sessionId = await ensureSession()
      const source = await importKnowledge(sessionId, { file })
      if (!isNativeIOS) setKnowledgeSources(prev => [source, ...prev])
      void refreshCognitiveBrain()
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
      if (!isNativeIOS) setKnowledgeSources(prev => [source, ...prev])
      setKnowledgeInput('')
      void refreshCognitiveBrain()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao importar conhecimento.')
    } finally {
      setIsImportingKnowledge(false)
    }
  }

  const handleExportMemoryBackup = useCallback(async () => {
    setIsBackupBusy(true)
    try {
      await exportLocalMemoryBackup()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao baixar backup local.')
    } finally {
      setIsBackupBusy(false)
    }
  }, [])

  const handleImportMemoryBackup = useCallback(async (file: File) => {
    setIsBackupBusy(true)
    try {
      await importLocalMemoryBackup(file)
      await refreshLocalBackupStatus()
      await refreshCognitiveBrain()
      const loadedSessions = await getSessions()
      setSessions(loadedSessions)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao importar backup local.')
    } finally {
      setIsBackupBusy(false)
    }
  }, [refreshCognitiveBrain, refreshLocalBackupStatus])

  const handleClearLocalStorage = useCallback(async (confirmation: string) => {
    setIsStorageBusy(true)
    try {
      cancelRecording()
      stopOutput()
      await clearLocalStorage(confirmation)
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao apagar os dados locais.')
      setIsStorageBusy(false)
    }
  }, [cancelRecording, stopOutput])

  const handleOpenHome = () => {
    setSettingsOpen(false)
    setActiveView('home')
    window.history.replaceState(null, '', window.location.pathname)
    window.scrollTo({ top: 0 })
  }

  const handleSmoothScrollToChat = () => {
    setSettingsOpen(false)
    setActiveView('chat')
    if (isMobileViewport()) {
      try {
        const hasSeenMobileChat = localStorage.getItem(MOBILE_CHAT_INTRO_KEY) === '1'
        setFocusMode(hasSeenMobileChat)
        if (!hasSeenMobileChat) localStorage.setItem(MOBILE_CHAT_INTRO_KEY, '1')
      } catch {
        // Sem localStorage, prioriza descobrir a criação de chats nesta entrada.
        setFocusMode(false)
      }
    }
    setChatRevealActive(!isIOSUi)
    window.history.replaceState(null, '', '#chat')
    window.scrollTo({ top: 0 })
    if (!isIOSUi) window.setTimeout(() => setChatRevealActive(false), 1900)
  }

  const handleOpenVoice = () => {
    setSettingsOpen(false)
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
    setSettingsOpen(false)
    setActiveView('obsidian')
    window.history.replaceState(null, '', '#obsidian')
    window.scrollTo({ top: 0 })
  }

  const handleOpenMobile = () => {
    setSettingsOpen(false)
    setActiveView('mobile')
    window.history.replaceState(null, '', '#mobile')
    window.scrollTo({ top: 0 })
  }

  const hasMessages = messages.length > 0
  const railTabs: Array<{ id: RailTab; label: string; icon: typeof Database }> = [
    { id: 'memory', label: 'Memória', icon: Database },
    { id: 'files', label: 'Arquivos', icon: FileCode2 },
    { id: 'summary', label: 'Resumo', icon: ListChecks },
  ]

  const renderViewNav = () => (
    <nav className={`view-nav view-nav-floating ${navigationStyles.nav} ${navigationStyles.floating}`} aria-label="Trocar seção">
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'home' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenHome} aria-current={!settingsOpen && activeView === 'home' ? 'page' : undefined}>
        <House size={14} />
        <span>Início</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'chat' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleSmoothScrollToChat} aria-current={!settingsOpen && activeView === 'chat' ? 'page' : undefined}>
        <MessageSquare size={14} />
        <span>Chat</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'voice' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenVoice} aria-current={!settingsOpen && activeView === 'voice' ? 'page' : undefined}>
        <Mic2 size={14} />
        <span>Voz</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'obsidian' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenObsidian} aria-current={!settingsOpen && activeView === 'obsidian' ? 'page' : undefined}>
        <BrainCircuit size={14} />
        <span>Obsidian</span>
      </button>
      <button
        type="button"
        className={`${navigationStyles.button} ${navigationStyles.desktopOnly} ${!settingsOpen && activeView === 'mobile' ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={handleOpenMobile}
        aria-current={!settingsOpen && activeView === 'mobile' ? 'page' : undefined}
      >
        <Smartphone size={14} />
        <span>Celular</span>
      </button>
      <button
        type="button"
        className={`${navigationStyles.button} ${settingsOpen ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={() => setSettingsOpen(true)}
        aria-current={settingsOpen ? 'page' : undefined}
      >
        <SettingsIcon size={14} />
        <span>Config</span>
      </button>
    </nav>
  )

  return (
    <div className={`scroll-experience ${navigationStyles.experience}`}>
      <NetworkStatus />

      <div className={`network-status-container ${toastStyles.container}`}>
          <AnimatePresence initial={false}>
          {toast && (
            <motion.div
              initial={isIOSUi ? { opacity: 0, y: -8 } : { opacity: 0, y: -20, scale: 0.95 }}
              animate={isIOSUi ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={isIOSUi ? { opacity: 0, y: -8 } : { opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: isIOSUi ? 0.16 : 0.2, ease: 'easeOut' }}
              className={`network-status-toast online model-change-toast ${toastStyles.base} ${toastStyles.model}`}
            >
              <div className={`network-status-icon ${toastStyles.icon} ${toastStyles.modelIcon}`}>
                <BrainCircuit size={18} />
              </div>
              <div className={`network-status-text ${toastStyles.text}`}>
                <strong>Modelo Alterado</strong>
                <span>{toast.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Tela de boot — aparece até todos os serviços serem verificados */}
      {!bootDone && <BootScreen onDone={handleBootDone} />}

      {renderViewNav()}


      <AnimatePresence mode={lowCostUi ? 'sync' : 'wait'} initial={false}>
        {activeView === 'home' && (
          <motion.section
            key="home"
            className={`home-landing ${homeStyles.landing}`}
            id="inicio"
            aria-label="Tela inicial Aether Memory"
            {...viewMotionProps}
          >
            <div className={homeStyles.content}>
              <div className={homeStyles.hero}>
                <div className={homeStyles.brandCopy}>
                  <span className={homeStyles.eyebrow}>Assistente local inteligente</span>
                  <h1 className={homeStyles.title}>Aether Memory</h1>
                </div>

                <div className={`${homeStyles.brandCopy} ${homeStyles.subcopy}`}>
                  <p className={homeStyles.subtitle}>Chat, memória Obsidian e configurações em uma experiência compacta e local.</p>
                </div>

                <div className={homeStyles.brandMark}>
                  <Suspense fallback={<HomeBrainLoader />}>
                    <HomeBrain
                      theme={settings.theme}
                      aiState={aiState}
                      memoryCount={cognitiveMemories.length}
                    />
                  </Suspense>
                </div>

                <div className={homeStyles.scrollIndicator} aria-hidden="true">
                  <span className={homeStyles.scrollGlyph} />
                  <small className={homeStyles.scrollCopy}>role para baixo</small>
                </div>
              </div>

              <div className={homeStyles.info}>
                <div className={homeStyles.projectCard} aria-label="O que é o Aether Memory">
                  <div className={homeStyles.projectCopy}>
                    <span className={homeStyles.projectEyebrow}>Por que ele existe</span>
                    <h2 className={homeStyles.projectTitle}>Uma IA local com memória própria, não apenas um modelo rodando.</h2>
                    <p className={homeStyles.projectDescription}>
                      O Aether Memory usa o Ollama como motor de inteligência, mas adiciona uma camada
                      pessoal em volta dele: histórico, memórias, PDFs, busca, codebase, Obsidian visual
                      e backup portátil. O modelo responde; o Aether lembra, organiza e conecta.
                    </p>
                  </div>
                  <div className={homeStyles.projectPoints}>
                    <div className={homeStyles.projectPoint}>
                      <BrainCircuit className={homeStyles.projectPointIcon} />
                      <strong className={homeStyles.projectPointTitle}>Cérebro persistente</strong>
                      <small className={homeStyles.projectPointCopy}>Transforma conversas e arquivos em memórias consultáveis.</small>
                    </div>
                    <div className={homeStyles.projectPoint}>
                      <Database className={homeStyles.projectPointIcon} />
                      <strong className={homeStyles.projectPointTitle}>Local-first</strong>
                      <small className={homeStyles.projectPointCopy}>Funciona no seu computador, salva em SQLite e exporta a memória quando você quiser.</small>
                    </div>
                    <div className={homeStyles.projectPoint}>
                      <Check className={homeStyles.projectPointIcon} />
                      <strong className={homeStyles.projectPointTitle}>Contexto real</strong>
                      <small className={homeStyles.projectPointCopy}>Usa RAG, perfil e documentos para responder sobre o que você ensinou.</small>
                    </div>
                  </div>
                </div>

                <div className={homeStyles.statusGrid} aria-label="Estado do sistema">
                  <div className={homeStyles.statusCard}>
                    <small className={homeStyles.statusLabel}>Modelo</small>
                    <strong className={homeStyles.statusValue}>{selectedModel}</strong>
                  </div>
                  <div className={homeStyles.statusCard}>
                    <small className={homeStyles.statusLabel}>Busca</small>
                    <strong className={homeStyles.statusValue}>{googleSearchAvailable ? 'Google pronto' : 'Offline'}</strong>
                  </div>
                  <div className={homeStyles.statusCard}>
                    <small className={homeStyles.statusLabel}>Memórias</small>
                    <strong className={homeStyles.statusValue}>{cognitiveMemories.length}</strong>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {activeView === 'chat' && (
          <motion.section
            key="chat"
            className={`chat-scroll-scene ${chatSceneStyles.scene} ${chatRevealActive ? `is-revealing ${chatSceneStyles.revealing}` : ''}`}
            id="chat"
            {...viewMotionProps}
          >
            <div className={`app-layout theme-${settings.theme} density-${settings.density} ${chatSceneStyles.layout}`}>
              <div className={`app-shell ${chatSceneStyles.shell} ${focusMode ? `is-focus-mode ${chatSceneStyles.shellFocus}` : ''} ${chatRevealActive ? chatSceneStyles.shellRevealing : ''}`}>
              {!focusMode && (
                <>
                  <button
                    type="button"
                    className={`mobile-sidebar-scrim ${sidebarClosing ? 'is-closing' : ''} ${sidebarStyles.scrim}`}
                    aria-label="Fechar histórico"
                    onClick={closeSidebar}
                  />
                  <Sidebar
                    isClosing={sidebarClosing}
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onNewChat={handleNewChat}
                    onSelect={handleSelectSession}
                    onDelete={handleDeleteSession}
                    systemUptime={formatUptime()}
                    aiState={aiState}
                    systemHealth={systemHealth}
                    selectedModel={selectedModel}
                  />
                </>
              )}

              <main className={`workspace ${chatShellStyles.workspace}`}>
                <section className={`content-grid ${chatShellStyles.content}`}>
                  <div className={`chat-session-bar ${chatSessionStyles.bar}`}>
                    <button
                      type="button"
                      className={`${chatSessionStyles.action} ${chatSessionStyles.sidebarTrigger}`}
                      onClick={openSidebar}
                      aria-label="Abrir histórico de conversas"
                      title="Abrir histórico"
                    >
                      <PanelLeftOpen size={17} />
                    </button>

                    <div className={`chat-title-editor ${chatSessionStyles.title}`}>
                      {isEditingTitle ? (
                        <input
                          ref={titleInputRef}
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void handleSaveCurrentTitle()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              handleCancelTitleEdit()
                            }
                          }}
                          autoFocus
                          autoComplete="off"
                          autoCorrect="off"
                          enterKeyHint="done"
                          maxLength={80}
                          spellCheck={false}
                          aria-label="Editar título da conversa"
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

                    <div className={`chat-session-actions ${chatSessionStyles.actions}`}>
                      {isEditingTitle ? (
                        <>
                          <button
                            className={`${chatSessionStyles.action} ${chatSessionStyles.saveAction}`}
                            type="button"
                            onClick={() => void handleSaveCurrentTitle()}
                            disabled={!draftTitle.trim()}
                            aria-label="Salvar título"
                            title="Salvar título"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            className={`${chatSessionStyles.action} ${chatSessionStyles.cancelAction}`}
                            type="button"
                            onClick={handleCancelTitleEdit}
                            aria-label="Cancelar edição"
                            title="Cancelar edição"
                          >
                            <X size={15} />
                          </button>
                        </>
                      ) : (
                        <button className={chatSessionStyles.action} type="button" onClick={handleEditCurrentTitle} disabled={!currentSessionId} title="Editar título">
                          <Pencil size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setKnowledgePanelOpen(value => !value)}
                        className={`${chatSessionStyles.action} ${chatSessionStyles.destructiveAction} ${knowledgePanelOpen ? 'is-active' : ''}`}
                        title="Importar conhecimento"
                      >
                        <Upload size={15} />
                      </button>
                    </div>
                  </div>

                  {knowledgePanelOpen && (
                    <Suspense fallback={<DeferredSurface label="Carregando importação..." />}>
                      <KnowledgeImportPanel
                        sources={knowledgeSources}
                        value={knowledgeInput}
                        isImporting={isImportingKnowledge}
                        onValueChange={setKnowledgeInput}
                        onImportText={handleImportKnowledgeText}
                        onImportFile={handleImportKnowledgeFile}
                      />
                    </Suspense>
                  )}

                  {!hasMessages ? (
                    <div className={`empty-state ${chatShellStyles.empty}`}>
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
                    onStop={stopOutput}
                    isProcessing={isProcessing}
                    isRecording={isRecording}
                    recSeconds={seconds}
                    onMicToggle={toggleMic}
                    selectedModel={selectedModel}
                    models={availableModels}
                    onModelChange={handleModelChange}
                    showModelSelect={false}
                    showMeta={false}
                    density="compact"
                  />
                </section>
              </main>
            </div>
            </div>
          </motion.section>
        )}

        {activeView === 'voice' && (
          <motion.div
            key="voice"
            {...viewMotionProps}
            style={{ minHeight: '100dvh' }}
          >
            <Suspense fallback={<DeferredSurface label="Carregando conversa..." />}>
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
            </Suspense>
          </motion.div>
        )}

        {activeView === 'obsidian' && (
          <motion.section
            key="obsidian"
            className={obsidianSceneStyles.scene}
            id="obsidian"
            ref={obsidianSceneRef}
            {...viewMotionProps}
          >
            <div className={obsidianSceneStyles.stage}>
              <div className={obsidianSceneStyles.graph}>
                <div className={obsidianSceneStyles.toolbar} aria-label="Ensinar e fazer backup da Obsidian">
                  {!isNativeIOS && (
                    <button
                      type="button"
                      className={`${obsidianSceneStyles.toolbarButton} ${obsidianSceneStyles.fileButton}`}
                      onClick={() => obsidianFileInputRef.current?.click()}
                      disabled={isImportingKnowledge}
                      title="Importar PDF, TXT, Markdown, CSV ou JSON"
                    >
                      <Upload size={15} />
                      <span>{isImportingKnowledge ? 'Lendo...' : 'Importar PDF'}</span>
                    </button>
                  )}
                  <input
                    ref={obsidianFileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void handleImportKnowledgeFile(file)
                    }}
                  />
                  <input
                    className={obsidianSceneStyles.toolbarInput}
                    value={knowledgeInput}
                    onChange={(event) => setKnowledgeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleImportKnowledgeText()
                    }}
                    placeholder={isNativeIOS ? 'Digite algo importante para salvar na memória...' : 'Cole texto, URL ou pesquisa para criar novas memórias...'}
                    disabled={isImportingKnowledge}
                  />
                  <button
                    type="button"
                    className={obsidianSceneStyles.toolbarButton}
                    onClick={() => void handleImportKnowledgeText()}
                    disabled={isImportingKnowledge || !knowledgeInput.trim()}
                  >
                    {isNativeIOS ? 'Salvar' : 'Aprender'}
                  </button>
                  {!isNativeIOS && (
                    <button
                      type="button"
                      className={`${obsidianSceneStyles.toolbarButton} ${obsidianSceneStyles.syncButton}`}
                      onClick={() => void handleExportMemoryBackup()}
                      disabled={isBackupBusy}
                      title="Baixar um backup completo da memória local"
                    >
                      <Database size={15} />
                      <span>{isBackupBusy ? 'Preparando...' : 'Backup'}</span>
                    </button>
                  )}
                </div>
                <Suspense fallback={<DeferredSurface label="Carregando Obsidian..." />}>
                  <BrainMap
                    key={settings.theme}
                    messages={messages}
                    knowledgeSources={knowledgeSources}
                    cognitiveMemories={cognitiveMemories}
                    knowledgeGraph={knowledgeGraph}
                    onRefresh={refreshCognitiveBrain}
                  />
                </Suspense>
              </div>
            </div>
          </motion.section>
        )}

        {activeView === 'mobile' && (
          <motion.div key="mobile" {...viewMotionProps}>
            <Suspense fallback={<DeferredSurface label="Carregando acesso pelo celular..." />}>
              <AcessoCelular config={backendConfig} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {settingsOpen && (
        <section
          className={settingsLayoutStyles.shell}
          aria-label="Configurações do Aether Memory"
        >
          <Suspense fallback={<DeferredSurface label="Carregando configurações..." />}>
            <StatusPanel
              aiState={aiState}
              sessionId={currentSessionId}
              msgCount={msgCount}
              latency={latency}
              model={selectedModel}
              models={availableModels}
              googleSearchAvailable={googleSearchAvailable}
              backupStatus={backupStatus}
              isBackupBusy={isBackupBusy}
              isStorageBusy={isStorageBusy}
              authMode={systemHealth?.authMode}
              authEmail={systemHealth?.userEmail}
              settings={settings}
              onModelChange={handleModelChange}
              onExportBackup={handleExportMemoryBackup}
              onImportBackup={handleImportMemoryBackup}
              onClearStorage={handleClearLocalStorage}
              onSettingChange={updateSetting}
              onClose={() => setSettingsOpen(false)}
            >
              <div className={`settings-section settings-insights-block ${settingsControlStyles.memoryPanel}`}>
                <div className={settingsControlStyles.panelHeading}>
                  <span>Contexto da conversa</span>
                  <ListChecks size={15} />
                </div>
                <div
                  className={settingsControlStyles.memoryTabs}
                  role="tablist"
                  aria-label="Contexto da conversa"
                >
                  {railTabs.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={`${settingsControlStyles.memoryTab} ${railTab === id ? settingsControlStyles.memoryTabActive : ''}`}
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
          </Suspense>
        </section>
      )}
    </div>
  )
}
