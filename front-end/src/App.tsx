import { useState, useEffect, useCallback } from 'react'
import { Activity, Check, Cpu, Gauge, MessageSquare, Network, Pencil, Radio, Trash2, X } from 'lucide-react'
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
import type { AiState, Session, ActivityItem, InterfaceSettings } from './types'

const SETTINGS_KEY = 'nexus-interface-settings'
const FALLBACK_MODEL = 'qwen2.5-coder:7b'
const AVAILABLE_MODELS = [FALLBACK_MODEL]

const DEFAULT_SETTINGS: InterfaceSettings = {
  theme: 'dark',
  density: 'compact',
  showInsights: true,
  showBrainMap: true,
  showQuickPrompts: true,
  reduceMotion: false,
  autoPlayAudio: true,
}

function getInitialSettings(): InterfaceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function MetricTile({ icon: Icon, label, value, tone }: {
  icon: typeof Activity
  label: string
  value: string
  tone: 'cyan' | 'violet' | 'emerald' | 'amber'
}) {
  return (
    <div className={`metric-tile tone-${tone}`}>
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function App() {
  const [aiState, setAiState] = useState<AiState>('idle')
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [latency, setLatency] = useState('')
  const [msgCount, setMsgCount] = useState(0)
  const [, setActivityItems] = useState<ActivityItem[]>([])
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<InterfaceSettings>(getInitialSettings)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  useEffect(() => {
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.density = 'compact'
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion)
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
    setDraftTitle(session.title)
    setIsEditingTitle(false)
    setSessions(prev => [session, ...prev])
    pushActivity('Nova sessão criada', 'emerald')
    return session.id
  }, [currentSessionId, pushActivity])

  const { messages, isProcessing, sendText, sendAudio, clearMessages, loadMessages } = useChat({
    sessionId: currentSessionId,
    onNeedSession: ensureSession,
    onStateChange: setAiState,
    onLatency: (ms) => setLatency(ms + 'ms'),
    onMsgCountChange: setMsgCount,
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
      .then(config => setSelectedModel(config.model || FALLBACK_MODEL))
      .catch(console.error)
  }, [])

  const handleNewChat = async () => {
    const session = await createSession()
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
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
    setSessions(prev => prev.map(session => (
      session.id === currentSessionId ? { ...session, title: updated.title } : session
    )))
    setIsEditingTitle(false)
    pushActivity('Título da conversa atualizado', 'emerald')
  }

  const handleDeleteCurrentChat = async () => {
    if (!currentSessionId) return
    await handleDeleteSession(currentSessionId)
  }

  const hasMessages = messages.length > 0

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        searchQuery={searchQuery}
        onNewChat={handleNewChat}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        systemUptime={formatUptime()}
      />

      <main className="workspace">
        <TopBar
          aiState={aiState}
          sessionTitle={currentSessionTitle}
          latency={latency}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen(v => !v)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <section className="command-strip compact-command-strip">
          <div>
            <span className="eyebrow">NEXUS ASSISTENT</span>
            <h1>{getGreeting()}, Vitor.</h1>
          </div>
          <div className="metric-grid">
            <MetricTile icon={Radio} label="Estado" value={aiState} tone="cyan" />
            <MetricTile icon={Gauge} label="Latencia" value={latency || '--'} tone="violet" />
            <MetricTile icon={MessageSquare} label="Mensagens" value={String(msgCount)} tone="emerald" />
            <MetricTile icon={Cpu} label="Modelo" value={selectedModel} tone="amber" />
          </div>
        </section>

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
                <span>{currentSessionId ? 'Sessão ativa' : 'Nenhuma sessão salva'}</span>
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
                  {!settings.reduceMotion && <ParticleNetwork count={34} maxDist={82} />}
                  <div className="orb-layer">
                    <AiOrb state={aiState} size={118} />
                  </div>
                </div>
                <div>
                  <span className="eyebrow">Pronto para operar</span>
                  <h2>Converse, dite comandos ou carregue uma sessão.</h2>
                  <p>Interface compacta, telemetria ativa e resposta por texto ou voz.</p>
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
              models={AVAILABLE_MODELS}
              onModelChange={setSelectedModel}
              showQuickPrompts={settings.showQuickPrompts}
              density="compact"
            />
          </div>

          <aside className={`insights-rail ${settings.showInsights ? '' : 'is-hidden'}`}>
            {settings.showBrainMap ? (
              <BrainMap messages={messages} />
            ) : (
              <div className="network-card">
                <div className="panel-heading">
                  <span>Rede neural</span>
                  <Network size={14} />
                </div>
                <div className="network-canvas">
                  {settings.reduceMotion ? (
                    <div className="static-grid" />
                  ) : (
                    <ParticleNetwork count={46} maxDist={88} />
                  )}
                </div>
              </div>
            )}
          </aside>
        </section>
      </main>

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
            settings={settings}
            onSettingChange={updateSetting}
            onClose={() => setSettingsOpen(false)}
          />
        </>
      )}
    </div>
  )
}
