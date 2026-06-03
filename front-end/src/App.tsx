import { useState, useEffect, useCallback } from 'react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ChatInput } from './components/ChatInput'
import { StatusPanel } from './components/StatusPanel'
import { TaskQueue, RecentActivity } from './components/TaskQueue'
import { ParticleNetwork } from './components/ParticleNetwork'
import { AiOrb } from './components/AiOrb'
import { useChat } from './hooks/useChat'
import { useRecorder } from './hooks/useRecorder'
import { getSessions, createSession, deleteSession, getSessionMessages } from './services/api'
import type { AiState, Session, ActivityItem } from './types'

// Greeting helper
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia, Administrador.'
  if (h < 18) return 'Boa tarde, Administrador.'
  return 'Boa noite, Administrador.'
}

export default function App() {
  const [aiState, setAiState]               = useState<AiState>('idle')
  const [sessions, setSessions]             = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [latency, setLatency]               = useState('')
  const [msgCount, setMsgCount]             = useState(0)
  const [activityItems, setActivityItems]   = useState<ActivityItem[]>([])
  const [selectedModel]                     = useState('qwen3:8b')

  // Uptime counter
  const [uptimeSeconds, setUptimeSeconds]   = useState(0)
  useEffect(() => {
    const t = setInterval(() => setUptimeSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const formatUptime = () => {
    const h = Math.floor(uptimeSeconds / 3600)
    const m = Math.floor((uptimeSeconds % 3600) / 60)
    const s = uptimeSeconds % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  // Activity log helper
  const pushActivity = useCallback((label: string, color: ActivityItem['color'] = 'cyan') => {
    const item: ActivityItem = { id: Date.now().toString(), label, time: 'agora', color }
    setActivityItems(prev => [item, ...prev].slice(0, 8))
  }, [])

  // Ensure session (creates one if none)
  const ensureSession = useCallback(async (): Promise<string> => {
    if (currentSessionId) return currentSessionId
    const session = await createSession()
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    setSessions(prev => [session, ...prev])
    pushActivity('Nova sessão criada', 'emerald')
    return session.id
  }, [currentSessionId, pushActivity])

  // Chat hook
  const { messages, isProcessing, sendText, sendAudio, clearMessages, loadMessages } = useChat({
    sessionId: currentSessionId,
    onNeedSession: ensureSession,
    onStateChange: setAiState,
    onLatency: (ms) => setLatency(ms + 'ms'),
    onMsgCountChange: setMsgCount,
  })

  // Recorder hook
  const { isRecording, seconds, toggle: toggleMic } = useRecorder({
    onStop: async (blob) => {
      pushActivity('Áudio gravado — enviando para STT', 'amber')
      await sendAudio(blob)
      pushActivity('Resposta gerada pelo LLM', 'violet')
    },
    onStateChange: setAiState,
  })

  // Load sessions on mount
  useEffect(() => {
    getSessions().then(setSessions).catch(console.error)
  }, [])

  // Session actions
  const handleNewChat = async () => {
    const session = await createSession()
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
    clearMessages()
    setMsgCount(0)
    setLatency('')
    setSessions(prev => [session, ...prev])
    pushActivity('Nova conversa iniciada', 'cyan')
  }

  const handleSelectSession = async (session: Session) => {
    setCurrentSessionId(session.id)
    setCurrentSessionTitle(session.title)
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
      clearMessages()
    }
    pushActivity('Conversa deletada', 'rose')
  }

  const handleSendText = async (text: string) => {
    pushActivity(`Mensagem enviada: "${text.slice(0, 30)}..."`, 'cyan')
    await sendText(text)
    pushActivity('Resposta da IA recebida', 'violet')
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-screen overflow-hidden bg-[#04060f] select-none">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewChat={handleNewChat}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        systemUptime={formatUptime()}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar
          aiState={aiState}
          sessionTitle={currentSessionTitle}
          latency={latency}
        />

        {/* Content grid */}
        <div className="flex-1 overflow-hidden flex flex-col gap-0 p-3 pt-2">

          {/* Center panels row (command + chat) */}
          <div className="flex-1 flex overflow-hidden gap-3 min-h-0">

            {/* MAIN PANEL */}
            <div className="flex-1 flex flex-col overflow-hidden glass border border-[rgba(0,212,255,0.08)] rounded-xl">
              {/* Hero when no messages */}
              {!hasMessages && (
                <div className="flex flex-col items-center justify-center gap-6 flex-1 px-6 py-8">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-[195px] h-[195px] rounded-full border border-[rgba(0,212,255,0.16)] animate-glow-pulse" />
                    <div className="absolute w-[165px] h-[165px] rounded-full border border-[rgba(0,212,255,0.09)]" />
                    <AiOrb state={aiState} size={135} />
                  </div>
                  <div className="text-center">
                    <h1 className="text-[26px] font-semibold text-gradient-cyan mb-2">{getGreeting()}</h1>
                    <p className="text-[14px] text-[#7a8fb5] font-light">Como posso ajudar você hoje?</p>
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {hasMessages && (
                <ChatWindow messages={messages} />
              )}

              {/* Input */}
              <ChatInput
                onSend={handleSendText}
                isProcessing={isProcessing}
                isRecording={isRecording}
                recSeconds={seconds}
                onMicToggle={toggleMic}
                selectedModel={selectedModel}
              />
            </div>
          </div>

          {/* Bottom cards row */}
          <div className="h-[230px] grid grid-cols-3 gap-3 mt-3 shrink-0">
            <TaskQueue />
            <RecentActivity extraItems={activityItems} />
            {/* System Visualization Card */}
            <div className="glass border border-[rgba(0,212,255,0.1)] rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">SYSTEM VISUALIZATION</span>
                <span className="text-[9px] bg-[rgba(0,212,255,0.1)] text-cyan-400 border border-[rgba(0,212,255,0.2)] px-2 py-0.5 rounded-full">AI Network</span>
              </div>
              <div className="flex-1 rounded-xl overflow-hidden border border-[rgba(0,212,255,0.08)] bg-[#04060f]">
                <ParticleNetwork count={55} maxDist={95} />
              </div>
              <div className="flex items-center gap-4 text-[9px] text-[#3d5078]">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />Models</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />Data Streams</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Connections</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Right status panel */}
      <StatusPanel
        aiState={aiState}
        sessionId={currentSessionId}
        msgCount={msgCount}
        latency={latency}
        model={selectedModel}
      />
    </div>
  )
}
