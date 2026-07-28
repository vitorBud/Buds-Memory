// ─── Type Definitions ───────────────────────────────────────────────────────

export type AiState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'
export type ThemeMode = 'white' | 'black' | 'gold' | 'silver'
export type DensityMode = 'compact' | 'comfortable'
export type AccentColor = 'white' | 'black' | 'gold' | 'silver' | 'amber'
export type VoiceProvider = 'browser' | 'piper'

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
  executive_summary?: string
  technical_summary?: string
  suggested_questions?: string[]
  detected_entities?: string[]
  metadata?: Record<string, unknown>
  created_at: string
}

export interface ChatStreamEvent {
  type: 'transcription' | 'token' | 'replace_response' | 'audio_sentence' | 'session_update' | 'web_search' | 'done' | 'error'
  content?: string
  text?: string
  url?: string
  pipeline?: 'FAST_PATH' | 'STANDARD_PATH' | 'DEEP_PATH' | string
  model?: string
  trace?: {
    request_id: string
    route: string
    pipeline: string
    model: string
    total_ms: number
    metrics: Record<string, unknown>
    events: Array<Record<string, unknown>>
  }
  session?: Session
  results?: Array<{ title: string; link: string; snippet: string }>
}

export interface InterfaceSettings {
  theme: ThemeMode
  density: DensityMode
  showInsights: boolean
  showBrainMap: boolean
  showQuickPrompts: boolean
  autoPlayAudio: boolean
  voiceProvider: VoiceProvider
  webSearchEnabled: boolean
  accentColor: AccentColor
}

export interface BackendConfig {
  model: string
  models: string[]
  ollama_url: string
  google_search_available: boolean
  data_dir?: string
  remote?: {
    remote_mode: boolean
    host: string
    port: number
    local_ip: string
    local_url: string
    frontend_dev_url: string
    public_url: string
    public_frontend_url: string
    recommended_url: string
    recommended_api_url: string
    auth_required: boolean
    auth_configured: boolean
    session_ttl_seconds: number
    compatible_with?: string[]
  }
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
  is_core?: boolean
  locked?: boolean
  user_confirmed?: boolean
  origin_type?: string | null
  origin_id?: string | null
  source_table?: string | null
  source_id?: number | null
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

export interface LocalBackupStatus {
  mode: 'local-backup' | string
  device_id: string
  last_backup_error?: string | null
  local_records: Record<string, number>
}

export interface LocalBackupImportResult {
  success: boolean
  message: string
  backup_exported_at?: string | null
  imported: Record<string, number>
  skipped: Record<string, number>
  total_imported: number
}
