import { lazy, Suspense, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
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
  Target,
  MapPinned,
  MoreHorizontal,
  LoaderCircle,
  WalletCards,
} from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { Transition } from 'framer-motion'
import { Sidebar } from './components/Sidebar'
import type { ChatFolderFilter } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { BootScreen } from './components/BootScreen'
import type { SystemHealth } from './components/BootScreen'
import { NetworkStatus } from './components/NetworkStatus'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { useMobilePerformanceMonitor } from './plataformas'
import { useHealthPolling } from './hooks/useHealthPolling'
import {
  getSessions, createSession, deleteSession, getSessionMessages, getBackendConfig,
  updateSessionTitle, updateSessionFolder, getChatFolders, createChatFolder,
  updateChatFolder, deleteChatFolder, getSessionKnowledge, importKnowledge,
  getLocalBackupStatus, getConversationStorage, purgeConversationStorage,
  exportLocalMemoryBackup, importLocalMemoryBackup, clearLocalStorage,
  getCognitiveMemories, getKnowledgeGraph, isNativeIOSRuntime,
  subscribeLocationContextSignals,
  resumeLocationMonitoring,
} from './services/api'
import type {
  AiState, BackendConfig, Session, ChatFolder, InterfaceSettings, LocalBackupStatus,
  ConversationStorageStatus, CognitiveMemory, KnowledgeGraph, KnowledgeSource,
} from './types'
import { formatSessionDate } from './utils/formatters'
import { getRuntimePlatform, isIOSRuntime, isWindowsRuntime, prepareIOSNeuralVoice } from './plataformas'
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
const FocusPage = lazy(() => import('./components/focus/FocusPage').then(module => ({ default: module.FocusPage })))
const PaginaMapaBuds = lazy(() => import('./components/mapa/PaginaMapaBuds').then(module => ({ default: module.PaginaMapaBuds })))
const FinancePage = lazy(() => import('./components/finance/FinancePage').then(module => ({ default: module.FinancePage })))

const SETTINGS_KEY = 'buds-interface-settings'
const DESKTOP_THEME_BOOT_KEY = 'buds-desktop-theme-boot-v1'
const VOICE_URI_KEY = 'buds-voice-uri-v1'
const AUDIO_DEFAULT_DISABLED_KEY = 'buds-audio-default-disabled-v1'
const MOBILE_CHAT_INTRO_KEY = 'buds-mobile-chat-intro-seen-v1'

// Migração transparente: preserva preferências das marcas anteriores.
;(function migrateStorageKeys() {
  const migrations: [string, string][] = [
    ['aether-interface-settings', 'buds-interface-settings'],
    ['nexus-interface-settings', 'buds-interface-settings'],
    ['aether-desktop-theme-boot-v1', 'buds-desktop-theme-boot-v1'],
    ['nexus-desktop-theme-boot-v1', 'buds-desktop-theme-boot-v1'],
    ['aether-voice-uri-v1', 'buds-voice-uri-v1'],
    ['nexus-voice-uri-v1', 'buds-voice-uri-v1'],
    ['aether-audio-default-disabled-v1', 'buds-audio-default-disabled-v1'],
    ['aether-mobile-chat-intro-seen-v1', 'buds-mobile-chat-intro-seen-v1'],
    ['aether_selected_model', 'buds_selected_model'],
    ['nexus_selected_model', 'buds_selected_model'],
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
type AppView = 'home' | 'chat' | 'voice' | 'obsidian' | 'mobile' | 'focus' | 'map' | 'finance'

const VIEW_HASHES: Record<AppView, string> = {
  home: '',
  chat: '#chat',
  voice: '#voice',
  obsidian: '#obsidian',
  mobile: '#mobile',
  focus: '#focus',
  map: '#map',
  finance: '#finance',
}

const MOBILE_VIEW_ORDER: AppView[] = ['home', 'chat', 'voice', 'finance', 'focus', 'map', 'obsidian', 'mobile']

const MOBILE_VIEW_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 24, scale: 0.992 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -18, scale: 0.996 }),
}

function viewFromHash(hash: string): AppView {
  const match = (Object.entries(VIEW_HASHES) as Array<[AppView, string]>)
    .find(([, viewHash]) => viewHash && viewHash === hash)
  return match?.[0] ?? 'home'
}

function resetDocumentScroll() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

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
const VOICE_RECORDER_CONFIG = {
  silenceSeconds: 1.1,
  speechThreshold: 0.075,
  noSpeechTimeoutSeconds: 6,
} as const

function isDesktopApp() {
  return Boolean((window as unknown as { nexus?: { isDesktop?: boolean } }).nexus?.isDesktop)
}

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 760px), ((pointer: coarse) and (orientation: landscape) and (max-height: 560px))').matches
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
    if ((isWindowsRuntime() || isIOSRuntime()) && parsed.voiceProvider === 'piper') {
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

export default function App() {
  useMobilePerformanceMonitor('app')
  const obsidianSceneRef = useRef<HTMLElement>(null)
  const obsidianFileInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sidebarCloseTimerRef = useRef<number | null>(null)
  const didAutoLoadSessionRef = useRef(false)
  const sessionLoadRequestRef = useRef(0)
  const voiceSessionPromiseRef = useRef<Promise<string> | null>(null)
  const wasVoiceActiveRef = useRef(false)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [sessions, setSessions] = useState<Session[]>([])
  const [chatFolders, setChatFolders] = useState<ChatFolder[]>([])
  const [activeChatFolderId, setActiveChatFolderId] = useState<ChatFolderFilter>('all')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const [voiceAiState, setVoiceAiState] = useState<AiState>('idle')
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [currentSessionCreatedAt, setCurrentSessionCreatedAt] = useState<string | null>(null)
  const [latency, setLatency] = useState('')
  const [msgCount, setMsgCount] = useState(0)
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL)
  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS)
  const [googleSearchAvailable, setGoogleSearchAvailable] = useState(false)
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
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
  const [conversationStorage, setConversationStorage] = useState<ConversationStorageStatus>({ conversations: [], orphaned: [] })
  const [isBackupBusy, setIsBackupBusy] = useState(false)
  const [isStorageBusy, setIsStorageBusy] = useState(false)
  const [cognitiveMemories, setCognitiveMemories] = useState<CognitiveMemory[]>([])
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null)
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem(VOICE_URI_KEY) || '')

  const [activeView, setActiveView] = useState<AppView>(() => viewFromHash(window.location.hash))
  const [viewDirection, setViewDirection] = useState(1)
  const activeViewRef = useRef(activeView)

  useEffect(() => {
    const landscapeQuery = window.matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 560px)')
    const syncViewportProfile = () => {
      const landscape = landscapeQuery.matches
      document.documentElement.toggleAttribute('data-mobile-landscape', landscape)
      document.documentElement.style.setProperty(
        '--app-viewport-height',
        `${Math.round(window.visualViewport?.height ?? window.innerHeight)}px`,
      )
    }
    syncViewportProfile()
    landscapeQuery.addEventListener('change', syncViewportProfile)
    window.visualViewport?.addEventListener('resize', syncViewportProfile)
    window.addEventListener('resize', syncViewportProfile)
    window.addEventListener('orientationchange', syncViewportProfile)
    return () => {
      landscapeQuery.removeEventListener('change', syncViewportProfile)
      window.visualViewport?.removeEventListener('resize', syncViewportProfile)
      window.removeEventListener('resize', syncViewportProfile)
      window.removeEventListener('orientationchange', syncViewportProfile)
      document.documentElement.removeAttribute('data-mobile-landscape')
      document.documentElement.style.removeProperty('--app-viewport-height')
    }
  }, [])
  const isWindowsUi = isWindowsRuntime()
  const isIOSUi = isIOSRuntime()
  const isNativeIOS = isNativeIOSRuntime()
  const isMobileUi = isMobileViewport()
  const prefersReducedMotion = useReducedMotion()
  const animateMobileUi = isMobileUi && !prefersReducedMotion
  const lowCostUi = isWindowsUi || isMobileUi
  const viewTransition: Transition = isWindowsUi || prefersReducedMotion
    ? { duration: 0 }
    : animateMobileUi
      ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
      : { duration: 0.28, ease: 'easeOut' }
  const viewMotionProps = isWindowsUi || prefersReducedMotion
    ? {
        initial: { opacity: 1, scale: 1 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 1, scale: 1 },
        transition: viewTransition,
      }
    : animateMobileUi
      ? {
          custom: viewDirection,
          variants: MOBILE_VIEW_VARIANTS,
          initial: 'enter',
          animate: 'center',
          exit: 'exit',
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
    if (!['#chat', '#voice', '#obsidian', '#mobile', '#focus', '#map'].includes(window.location.hash)) {
      setActiveView('home')
    }
  }, [])

  const resetViewScroll = useCallback((view: AppView, includeSettings = false) => {
    resetDocumentScroll()
    const target = includeSettings
      ? document.querySelector<HTMLElement>('[aria-label="Configurações do Buds Memory"]')
      : document.getElementById(view === 'home' ? 'inicio' : view)
    target?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  const prepareViewportForView = useCallback((view: AppView, includeSettings = false) => {
    const root = document.documentElement
    const lockDocument = includeSettings || (view !== 'home' && view !== 'mobile')
    root.dataset.appView = includeSettings ? 'settings' : view
    root.dataset.appScroll = lockDocument ? 'locked' : 'window'
    resetViewScroll(view, includeSettings)
  }, [resetViewScroll])

  useLayoutEffect(() => {
    prepareViewportForView(activeView, settingsOpen)

    // O segundo frame cobre a montagem lazy/AnimatePresence. No WKWebView isso
    // também encerra a inércia que ainda pode chegar da tela anterior.
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      resetViewScroll(activeView, settingsOpen)
      secondFrame = window.requestAnimationFrame(() => {
        resetViewScroll(activeView, settingsOpen)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [activeView, prepareViewportForView, resetViewScroll, settingsOpen])

  useEffect(() => () => {
    delete document.documentElement.dataset.appView
    delete document.documentElement.dataset.appScroll
  }, [])

  useEffect(() => {
    // O contador de uptime é estético na sidebar do chat (invisível no iOS/mobile
    // com focusMode). No iOS ele só causa re-renders desnecessários a cada segundo.
    if (activeView !== 'chat' || focusMode || isIOSUi) return
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [activeView, focusMode, isIOSUi])

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

  useEffect(() => {
    let dispose: (() => void) | undefined
    resumeLocationMonitoring()
    void subscribeLocationContextSignals(signal => {
      showToast(`${signal.title}: ${signal.message}`, signal.kind === 'ARRIVAL_REMINDER' ? 'success' : 'info')
      window.dispatchEvent(new Event('buds-focus-refresh'))
    }).then(cleanup => { dispose = cleanup }).catch(error => {
      console.warn('[BudsContext] Sinal proativo indisponível:', error)
    })
    return () => { dispose?.() }
  }, [showToast])

  const refreshLocalBackupStatus = useCallback(async () => {
    try {
      const [status, conversations] = await Promise.all([
        getLocalBackupStatus(),
        getConversationStorage(),
      ])
      setLocalBackupStatus(status)
      setConversationStorage(conversations)
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
    const folderId = activeChatFolderId !== 'all' && activeChatFolderId !== 'unfiled'
      ? activeChatFolderId
      : null
    const session = await createSession(undefined, folderId)
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setCurrentSessionCreatedAt(session.created_at)
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    setSessions(prev => [session, ...prev])
    return session.id
  }, [activeChatFolderId, currentSessionId])

  const ensureVoiceSession = useCallback(async (): Promise<string> => {
    if (voiceSessionId) return voiceSessionId
    if (voiceSessionPromiseRef.current) return voiceSessionPromiseRef.current

    const pending = (async () => {
      const existing = (await getSessions('voice'))[0]
      const session = existing ?? await createSession('Conversa por voz', null, 'voice')
      setVoiceSessionId(session.id)
      return session.id
    })()
    voiceSessionPromiseRef.current = pending
    try {
      return await pending
    } finally {
      if (voiceSessionPromiseRef.current === pending) voiceSessionPromiseRef.current = null
    }
  }, [voiceSessionId])

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
    localStorage.setItem('buds_selected_model', model)
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
    onResponseComplete: () => {
      if (activeViewRef.current !== 'chat') {
        showToast('A resposta do Buds está pronta no Chat.', 'success')
      }
      if (!isNativeIOSRuntime() && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Buds Memory', { body: 'Sua resposta está pronta no Chat.' })
        } catch {
          // Alguns navegadores móveis só permitem notificações via service worker.
        }
      }
    },
    autoPlayAudio: settings.autoPlayAudio && activeView !== 'voice',
  })

  const {
    isProcessing: isVoiceProcessing,
    availableVoices: voiceAvailableVoices,
    sendText: sendVoiceText,
    sendAudio: sendVoiceAudio,
    stopOutput: stopVoiceOutput,
  } = useChat({
    sessionId: voiceSessionId,
    selectedModel,
    webSearchEnabled: settings.webSearchEnabled,
    selectedVoiceURI,
    voiceProvider: settings.voiceProvider,
    onNeedSession: ensureVoiceSession,
    onStateChange: setVoiceAiState,
    onLatency: () => undefined,
    onMsgCountChange: () => undefined,
    autoPlayAudio: activeView === 'voice' && !settingsOpen,
    offlineQueueEnabled: false,
  })

  const {
    isRecording,
    seconds,
    volume: micVolume,
    partialTranscript: voicePartialTranscript,
    toggle: toggleMic,
    cancel: cancelRecording,
  } = useRecorder({
    onStop: async (blob, metrics) => {
      if (activeViewRef.current === 'voice') await sendVoiceAudio(blob, metrics)
      else await sendAudio(blob, metrics)
    },
    onTranscript: (text, metrics) => {
      if (activeViewRef.current === 'voice') void sendVoiceText(text, metrics)
      else void sendText(text, metrics)
    },
    onStateChange: (state) => {
      if (activeViewRef.current === 'voice') setVoiceAiState(state)
      else setAiState(state)
    },
    autoStopOnSilence: activeView === 'voice',
    silenceSeconds: activeView === 'voice' ? VOICE_RECORDER_CONFIG.silenceSeconds : 1.15,
    speechThreshold: activeView === 'voice' ? VOICE_RECORDER_CONFIG.speechThreshold : 0.075,
    maxSeconds: activeView === 'voice' ? 45 : 30,
    noSpeechTimeoutSeconds: activeView === 'voice' ? VOICE_RECORDER_CONFIG.noSpeechTimeoutSeconds : 10,
  })

  useEffect(() => {
    if (activeView === 'voice' && !settingsOpen) {
      wasVoiceActiveRef.current = true
      return
    }
    if (!wasVoiceActiveRef.current) return
    wasVoiceActiveRef.current = false
    cancelRecording()
    stopVoiceOutput()
  }, [activeView, cancelRecording, settingsOpen, stopVoiceOutput])

  const handleVoiceChange = useCallback((voiceURI: string) => {
    setSelectedVoiceURI(voiceURI)
    if (voiceURI) localStorage.setItem(VOICE_URI_KEY, voiceURI)
    else localStorage.removeItem(VOICE_URI_KEY)
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

    Promise.all([getSessions(), getChatFolders()])
      .then(async ([loadedSessions, loadedFolders]) => {
        if (cancelled) return
        setSessions(loadedSessions)
        setChatFolders(loadedFolders)
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

        const savedModel = localStorage.getItem('buds_selected_model')
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
    const targetView = viewFromHash(window.location.hash)
    window.queueMicrotask(() => {
      setActiveView(targetView)
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
    const folderId = activeChatFolderId !== 'all' && activeChatFolderId !== 'unfiled'
      ? activeChatFolderId
      : null
    const session = await createSession(undefined, folderId)
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
    if (!confirm('Remover esta conversa da lista? As memórias continuam no Buds até você apagá-las em Configurações > Armazenamento.')) return
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
    void refreshLocalBackupStatus()
  }

  const handleCreateChatFolder = async (
    input: Pick<ChatFolder, 'name' | 'icon' | 'color'>,
  ): Promise<ChatFolder> => {
    try {
      const folder = await createChatFolder(input)
      setChatFolders(prev => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      showToast(`Pasta ${folder.name} criada.`, 'success')
      return folder
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível criar a pasta.'
      alert(message)
      throw err
    }
  }

  const handleUpdateChatFolder = async (
    id: string,
    updates: Partial<Pick<ChatFolder, 'name' | 'icon' | 'color'>>,
  ) => {
    try {
      const folder = await updateChatFolder(id, updates)
      setChatFolders(prev => prev
        .map(item => item.id === id ? folder : item)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      showToast('Pasta atualizada.', 'success')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível atualizar a pasta.')
      throw err
    }
  }

  const handleDeleteChatFolder = async (id: string) => {
    const folder = chatFolders.find(item => item.id === id)
    if (!confirm(`Apagar a pasta “${folder?.name ?? 'selecionada'}”? Os chats serão mantidos em “Sem pasta”.`)) return false
    try {
      await deleteChatFolder(id)
      setChatFolders(prev => prev.filter(item => item.id !== id))
      setSessions(prev => prev.map(session => session.folder_id === id
        ? { ...session, folder_id: null }
        : session))
      setActiveChatFolderId(current => current === id ? 'unfiled' : current)
      showToast('Pasta apagada; as conversas foram preservadas.', 'success')
      return true
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível apagar a pasta.')
      return false
    }
  }

  const handleMoveSession = async (sessionId: string, folderId: string | null) => {
    try {
      const session = await updateSessionFolder(sessionId, folderId)
      setSessions(prev => prev.map(item => item.id === sessionId ? { ...item, ...session } : item))
      const folder = chatFolders.find(item => item.id === folderId)
      showToast(folder ? `Conversa movida para ${folder.name}.` : 'Conversa movida para Sem pasta.', 'success')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível mover a conversa.')
      throw err
    }
  }

  const handleSendText = async (text: string) => {
    await sendText(text)
    // Só atualiza o cérebro cognitivo se a Obsidian estiver visível;
    // caso contrário, o refresh acontece ao navegar para ela (lazy).
    if (activeView === 'obsidian') {
      window.setTimeout(() => {
        void refreshCognitiveBrain()
      }, 1800)
    }
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
      setKnowledgeSources(prev => [source, ...prev.filter(item => item.id !== source.id)])
      showToast(`${source.source_type === 'pdf' ? 'PDF' : 'Arquivo'} anexado à conversa`, 'success')
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
      setKnowledgeSources(prev => [source, ...prev.filter(item => item.id !== source.id)])
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
      const [loadedSessions, loadedFolders] = await Promise.all([getSessions(), getChatFolders()])
      setSessions(loadedSessions)
      setChatFolders(loadedFolders)
      setActiveChatFolderId('all')
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
      stopVoiceOutput()
      await clearLocalStorage(confirmation)
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao apagar os dados locais.')
      setIsStorageBusy(false)
    }
  }, [cancelRecording, stopOutput, stopVoiceOutput])

  const handlePurgeConversation = useCallback(async (id: string) => {
    setIsStorageBusy(true)
    try {
      cancelRecording()
      stopOutput()
      stopVoiceOutput()
      const updated = await purgeConversationStorage(id)
      setConversationStorage(updated)
      setSessions(prev => prev.filter(session => session.id !== id))
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
      if (voiceSessionId === id) {
        setVoiceSessionId(null)
      }
      await Promise.all([refreshLocalBackupStatus(), refreshCognitiveBrain()])
      showToast('Conversa e memórias apagadas definitivamente.', 'success')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao apagar os dados desta conversa.')
    } finally {
      setIsStorageBusy(false)
    }
  }, [cancelRecording, clearMessages, currentSessionId, refreshCognitiveBrain, refreshLocalBackupStatus, showToast, stopOutput, stopVoiceOutput, voiceSessionId])

  const activateView = useCallback((view: AppView) => {
    const currentIndex = MOBILE_VIEW_ORDER.indexOf(activeViewRef.current)
    const nextIndex = MOBILE_VIEW_ORDER.indexOf(view)
    if (currentIndex !== nextIndex) {
      setViewDirection(nextIndex >= currentIndex ? 1 : -1)
    }
    activeViewRef.current = view
    prepareViewportForView(view)
    setMobileMoreOpen(false)
    setSettingsOpen(false)
    setActiveView(view)
    window.history.replaceState(null, '', `${window.location.pathname}${VIEW_HASHES[view]}`)
  }, [prepareViewportForView])

  const handleOpenHome = () => activateView('home')

  const handleSmoothScrollToChat = () => {
    activateView('chat')
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
    if (!isIOSUi) window.setTimeout(() => setChatRevealActive(false), 1900)
  }

  const handleOpenVoice = () => {
    activateView('voice')
    if (isNativeIOS) {
      // Carrega o Kokoro enquanto o usuário começa a conversa. A sessão de
      // áudio só é ativada na primeira frase, para não disputar o microfone.
      void prepareIOSNeuralVoice().catch(error => console.error('[Buds Voice] Pré-carga indisponível:', error))
    }
    void ensureVoiceSession().catch((error) => {
      console.error(error)
      setVoiceAiState('error')
      showToast('Não foi possível preparar a conversa por voz.', 'info')
    })
  }

  const handleOpenObsidian = () => {
    activateView('obsidian')
    // Refresh lazy: atualiza memórias e grafo ao entrar na Obsidian.
    void refreshCognitiveBrain()
  }

  const handleOpenMobile = () => activateView('mobile')

  const handleOpenFocus = () => activateView('focus')

  const handleOpenMap = () => activateView('map')

  const handleOpenFinance = () => activateView('finance')

  const handleAskFinance = (prompt: string) => {
    activateView('chat')
    void handleSendText(prompt)
  }

  const handleOpenSettings = () => {
    prepareViewportForView(activeView, true)
    setMobileMoreOpen(false)
    setSettingsOpen(true)
  }

  const handleCloseSettings = () => setSettingsOpen(false)

  const hasMessages = messages.length > 0
  const railTabs: Array<{ id: RailTab; label: string; icon: typeof Database }> = [
    { id: 'memory', label: 'Memória', icon: Database },
    { id: 'files', label: 'Arquivos', icon: FileCode2 },
    { id: 'summary', label: 'Resumo', icon: ListChecks },
  ]

  const renderViewNav = () => {
    const moreIsActive = settingsOpen || activeView === 'focus' || activeView === 'map' || activeView === 'obsidian'
    const renderMobileIndicator = (active: boolean) => active ? (
      <motion.div
        layoutId="mobile-bottom-nav-indicator"
        className={navigationStyles.mobileIndicator}
        transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 470, damping: 38, mass: 0.72 }}
        aria-hidden="true"
      />
    ) : null

    return (
      <>
        <AnimatePresence initial={false}>
          {mobileMoreOpen && (
            <>
              <motion.button
                key="mobile-more-backdrop"
                type="button"
                aria-label="Fechar menu Mais"
                className={navigationStyles.mobileMoreBackdrop}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setMobileMoreOpen(false)}
              />
              <motion.div
                key="mobile-more-menu"
                className={navigationStyles.mobileMoreMenu}
                role="menu"
                aria-label="Mais seções"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <button type="button" role="menuitem" className={`${navigationStyles.mobileMoreItem} ${!settingsOpen && activeView === 'focus' ? navigationStyles.mobileMoreItemActive : ''}`} onClick={handleOpenFocus}>
                  <Target />
                  <span>Focus</span>
                </button>
                <button type="button" role="menuitem" className={`${navigationStyles.mobileMoreItem} ${!settingsOpen && activeView === 'map' ? navigationStyles.mobileMoreItemActive : ''}`} onClick={handleOpenMap}>
                  <MapPinned />
                  <span>Mapa</span>
                </button>
                <button type="button" role="menuitem" className={`${navigationStyles.mobileMoreItem} ${!settingsOpen && activeView === 'obsidian' ? navigationStyles.mobileMoreItemActive : ''}`} onClick={handleOpenObsidian}>
                  <BrainCircuit />
                  <span>Obsidian</span>
                </button>
                <button type="button" role="menuitem" className={`${navigationStyles.mobileMoreItem} ${settingsOpen ? navigationStyles.mobileMoreItemActive : ''}`} onClick={handleOpenSettings}>
                  <SettingsIcon />
                  <span>Configurações</span>
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <nav className={`view-nav view-nav-floating ${navigationStyles.nav} ${navigationStyles.floating}`} aria-label="Trocar seção">
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'home' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenHome} aria-current={!settingsOpen && activeView === 'home' ? 'page' : undefined}>
        {renderMobileIndicator(!settingsOpen && activeView === 'home')}
        <House size={14} />
        <span>Início</span>
      </button>
      <button
        type="button"
        className={`${navigationStyles.button} ${isProcessing ? navigationStyles.backgroundProcessing : ''} ${!settingsOpen && activeView === 'chat' ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={handleSmoothScrollToChat}
        aria-current={!settingsOpen && activeView === 'chat' ? 'page' : undefined}
        aria-label={isProcessing ? 'Chat — Buds está respondendo em segundo plano' : 'Chat'}
        title={isProcessing ? 'Buds está respondendo em segundo plano' : 'Chat'}
      >
        {renderMobileIndicator(!settingsOpen && activeView === 'chat')}
        {isProcessing && activeView !== 'chat'
          ? <LoaderCircle size={14} className={navigationStyles.backgroundProcessingIcon} aria-hidden="true" />
          : <MessageSquare size={14} />}
        <span>Chat</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'voice' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenVoice} aria-current={!settingsOpen && activeView === 'voice' ? 'page' : undefined}>
        {renderMobileIndicator(!settingsOpen && activeView === 'voice')}
        <Mic2 size={14} />
        <span>Voz</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${!settingsOpen && activeView === 'finance' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenFinance} aria-current={!settingsOpen && activeView === 'finance' ? 'page' : undefined}>
        {renderMobileIndicator(!settingsOpen && activeView === 'finance')}
        <WalletCards size={14} />
        <span>Finanças</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${navigationStyles.desktopOnly} ${!settingsOpen && activeView === 'focus' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenFocus} aria-current={!settingsOpen && activeView === 'focus' ? 'page' : undefined}>
        {renderMobileIndicator(!settingsOpen && activeView === 'focus')}
        <Target size={14} />
        <span>Focus</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${navigationStyles.desktopOnly} ${!settingsOpen && activeView === 'map' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenMap} aria-current={!settingsOpen && activeView === 'map' ? 'page' : undefined}>
        <MapPinned size={14} />
        <span>Map</span>
      </button>
      <button type="button" className={`${navigationStyles.button} ${navigationStyles.desktopOnly} ${!settingsOpen && activeView === 'obsidian' ? `is-active ${navigationStyles.active}` : ''}`} onClick={handleOpenObsidian} aria-current={!settingsOpen && activeView === 'obsidian' ? 'page' : undefined}>
        <BrainCircuit size={14} />
        <span>Obsidian</span>
      </button>
      <button
        type="button"
        className={`view-nav-desktop-only ${navigationStyles.button} ${navigationStyles.desktopOnly} ${!settingsOpen && activeView === 'mobile' ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={handleOpenMobile}
        aria-current={!settingsOpen && activeView === 'mobile' ? 'page' : undefined}
      >
        <Smartphone size={14} />
        <span>Celular</span>
      </button>
      <button
        type="button"
        className={`${navigationStyles.button} ${navigationStyles.desktopOnly} ${settingsOpen ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={handleOpenSettings}
        aria-current={settingsOpen ? 'page' : undefined}
      >
        <SettingsIcon size={14} />
        <span>Config</span>
      </button>
      <button
        type="button"
        className={`${navigationStyles.button} ${navigationStyles.mobileOnly} ${moreIsActive ? `is-active ${navigationStyles.active}` : ''}`}
        onClick={() => setMobileMoreOpen(open => !open)}
        aria-expanded={mobileMoreOpen}
        aria-haspopup="menu"
        aria-current={moreIsActive ? 'page' : undefined}
      >
        {renderMobileIndicator(moreIsActive)}
        <MoreHorizontal size={14} />
        <span>Mais</span>
      </button>
        </nav>
      </>
    )
  }

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


      <AnimatePresence mode={lowCostUi ? 'sync' : 'wait'} initial={false} custom={viewDirection}>
        {activeView === 'home' && (
          <motion.section
            key="home"
            className={`home-landing ${homeStyles.landing}`}
            id="inicio"
            aria-label="Tela inicial Buds Memory"
            {...viewMotionProps}
          >
            <div className={homeStyles.content}>
              <div className={`home-hero ${homeStyles.hero}`}>
                <div className={homeStyles.brandCopy}>
                  <span className={homeStyles.eyebrow}>Assistente local inteligente</span>
                  <h1 className={homeStyles.title}>Buds Memory</h1>
                </div>

                <div className={`${homeStyles.brandCopy} ${homeStyles.subcopy}`}>
                  <p className={homeStyles.subtitle}>Chat, memória Obsidian e configurações em uma experiência compacta e local.</p>
                </div>

                <div className={`home-brand-mark ${homeStyles.brandMark}`}>
                  <Suspense fallback={<HomeBrainLoader />}>
                    <HomeBrain
                      theme={settings.theme}
                      aiState={aiState}
                      memoryCount={cognitiveMemories.length}
                      visible={activeView === 'home'}
                    />
                  </Suspense>
                </div>

                <div className={homeStyles.scrollIndicator} aria-hidden="true">
                  <span className={homeStyles.scrollGlyph} />
                  <small className={homeStyles.scrollCopy}>role para baixo</small>
                </div>
              </div>

              <div className={`home-info ${homeStyles.info}`}>
                <div className={homeStyles.projectCard} aria-label="O que é o Buds Memory">
                  <div className={homeStyles.projectCopy}>
                    <span className={homeStyles.projectEyebrow}>Por que ele existe</span>
                    <h2 className={homeStyles.projectTitle}>Uma IA local com memória própria, não apenas um modelo rodando.</h2>
                    <p className={homeStyles.projectDescription}>
                      O Buds Memory usa o Ollama como motor de inteligência, mas adiciona uma camada
                      pessoal em volta dele: histórico, memórias, PDFs, busca, codebase, Obsidian visual
                      e backup portátil. O modelo responde; o Buds lembra, organiza e conecta.
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
                    folders={chatFolders}
                    activeFolderId={activeChatFolderId}
                    currentSessionId={currentSessionId}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onFolderFilterChange={setActiveChatFolderId}
                    onNewChat={handleNewChat}
                    onSelect={handleSelectSession}
                    onDelete={handleDeleteSession}
                    onCreateFolder={handleCreateChatFolder}
                    onUpdateFolder={handleUpdateChatFolder}
                    onDeleteFolder={handleDeleteChatFolder}
                    onMoveSession={handleMoveSession}
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
            className="w-full max-w-full overflow-x-hidden"
            {...viewMotionProps}
            style={{ minHeight: '100dvh', width: '100%', maxWidth: '100vw' }}
          >
            <Suspense fallback={<DeferredSurface label="Carregando conversa..." />}>
              <VoiceMode
                aiState={voiceAiState}
                theme={settings.theme}
                isRecording={isRecording}
                recSeconds={seconds}
                micVolume={micVolume}
                partialTranscript={voicePartialTranscript}
                isProcessing={isVoiceProcessing}
                availableVoices={voiceAvailableVoices.length ? voiceAvailableVoices : availableVoices}
                selectedVoiceURI={selectedVoiceURI}
                usesNeuralVoice={isNativeIOS}
                onMicToggle={toggleMic}
                onStopOutput={stopVoiceOutput}
                onVoiceChange={handleVoiceChange}
              />
            </Suspense>
          </motion.div>
        )}

        {activeView === 'obsidian' && (
          <motion.section
            key="obsidian"
            className={`obsidian-scroll-scene ${obsidianSceneStyles.scene}`}
            id="obsidian"
            ref={obsidianSceneRef}
            {...viewMotionProps}
          >
            <div className={`obsidian-stage ${obsidianSceneStyles.stage}`}>
              <div className={`obsidian-graph-shell ${obsidianSceneStyles.graph}`}>
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
          <AcessoCelular config={backendConfig} />
        )}

        {activeView === 'finance' && (
          <motion.div
            key="finance"
            className="fixed inset-0 z-[1] h-dvh min-h-0 w-full overflow-hidden"
            {...viewMotionProps}
          >
            <Suspense fallback={<DeferredSurface label="Carregando finanças..." />}>
              <FinancePage visible={activeView === 'finance'} onAskBuds={handleAskFinance} />
            </Suspense>
          </motion.div>
        )}

        {activeView === 'focus' && (
          <motion.div
            key="focus"
            className="fixed inset-0 z-[1] h-dvh min-h-0 w-full overflow-hidden"
            {...viewMotionProps}
          >
            <Suspense fallback={<DeferredSurface label="Carregando Buds Focus..." />}>
              <FocusPage visible={activeView === 'focus'} />
            </Suspense>
          </motion.div>
        )}

        {activeView === 'map' && (
          <motion.div
            key="map"
            className="fixed inset-0 z-[1] h-dvh min-h-0 w-full overflow-hidden"
            {...viewMotionProps}
          >
            <Suspense fallback={<DeferredSurface label="Carregando Buds Map..." />}>
              <PaginaMapaBuds visible={activeView === 'map'} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
      {settingsOpen && (
        <motion.section
          className={settingsLayoutStyles.shell}
          aria-label="Configurações do Buds Memory"
          initial={animateMobileUi ? { opacity: 0, x: 24 } : false}
          animate={{ opacity: 1, x: 0 }}
          exit={animateMobileUi ? { opacity: 0, x: 20 } : { opacity: 1, x: 0 }}
          transition={animateMobileUi ? viewTransition : { duration: 0 }}
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
              conversationStorage={conversationStorage}
              isBackupBusy={isBackupBusy}
              isStorageBusy={isStorageBusy}
              authMode={systemHealth?.authMode}
              authEmail={systemHealth?.userEmail}
              settings={settings}
              onModelChange={handleModelChange}
              onExportBackup={handleExportMemoryBackup}
              onImportBackup={handleImportMemoryBackup}
              onClearStorage={handleClearLocalStorage}
              onPurgeConversation={handlePurgeConversation}
              onSettingChange={updateSetting}
              onClose={handleCloseSettings}
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
        </motion.section>
      )}
      </AnimatePresence>
    </div>
  )
}
