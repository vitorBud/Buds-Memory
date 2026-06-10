// ─── Type Definitions ───────────────────────────────────────────────────────

export type AiState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'
export type ThemeMode = 'white' | 'black' | 'gold' | 'silver'
export type DensityMode = 'compact' | 'comfortable'
export type AccentColor = 'white' | 'black' | 'gold' | 'silver' | 'amber'

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

export interface KnowledgeSource {
  id: number
  session_id: string
  title: string
  source_type: 'pdf' | 'arquivo' | 'url' | 'pesquisa' | 'texto'
  source_name?: string | null
  summary: string
  content?: string
  topics: string[]
  created_at: string
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
  accentColor: AccentColor
}

export interface BackendConfig {
  model: string
  models: string[]
  ollama_url: string
  google_search_available: boolean
  data_dir?: string
}

export interface CognitiveMemory {
  id: number
  session_id?: string | null
  content: string
  memory_type: 'short' | 'medium' | 'long' | string
  importance: number
  access_count: number
  last_accessed?: string | null
  expires_at?: string | null
  tags: string[]
  created_at: string
}

export interface KnowledgeGraphEntity {
  id: number
  name: string
  entity_type: string
  description?: string | null
  importance: number
  access_count: number
  first_seen: string
  last_seen: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeGraphEdge {
  source: string
  target: string
  relation_type: string
  strength: number
}

export interface KnowledgeGraph {
  entities: KnowledgeGraphEntity[]
  edges: KnowledgeGraphEdge[]
}

export interface SyncStatus {
  mode: 'local-first' | string
  online_sync_enabled: boolean
  supabase_configured: boolean
  remote_table: string
  device_id: string
  last_sync_at?: string | null
  last_sync_error?: string | null
  local_records: Record<string, number>
}

export interface SyncRunResult {
  success: boolean
  message: string
  uploaded: number
  dry_run?: boolean
  records_found?: number
  status: SyncStatus
}
