// ─── Type Definitions ───────────────────────────────────────────────────────

export type AiState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'
export type ThemeMode = 'dark' | 'light'
export type DensityMode = 'compact' | 'comfortable'

export interface Session {
  id: string
  title: string
  created_at: string
}

export interface Message {
  id?: number
  session_id?: string
  sender: 'user' | 'ia'
  text: string
  audio_url?: string | null
  created_at?: string
  streaming?: boolean
}

export interface ChatStreamEvent {
  type: 'transcription' | 'token' | 'audio_sentence' | 'session_update' | 'web_search' | 'done' | 'error'
  content?: string
  text?: string
  url?: string
  session?: Session
  results?: Array<{ title: string; link: string; snippet: string }>
}

export interface SystemStats {
  cpu: number
  gpu: number
  memory: number
  network: number
}

export interface ModelStat {
  id: string
  name: string
  role: string
  pct: number
  color: string
  active: boolean
}

export interface ActivityItem {
  id: string
  label: string
  time: string
  color: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose'
}

export interface TaskItem {
  id: string
  title: string
  category: string
  progress: number
  color: string
}

export interface InterfaceSettings {
  theme: ThemeMode
  density: DensityMode
  showInsights: boolean
  showBrainMap: boolean
  showQuickPrompts: boolean
  autoPlayAudio: boolean
  webSearchEnabled: boolean
}

export interface BackendConfig {
  model: string
  models: string[]
  ollama_url: string
  google_search_available: boolean
}
