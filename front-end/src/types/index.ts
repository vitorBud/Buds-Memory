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
  folder_id?: string | null
  channel?: 'chat' | 'voice'
}

export interface ChatFolder {
  id: string
  name: string
  icon: string
  color: string
  created_at: string
  updated_at: string
  chat_count: number
}

export interface Message {
  id?: number
  session_id?: string
  sender: 'user' | 'ia'
  text: string
  audio_url?: string | null
  created_at?: string
  streaming?: boolean
  /** Buffer transitório usado apenas para filtrar raciocínio durante o streaming. */
  rawText?: string
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
  scope?: 'global' | 'conversation' | 'detached' | string
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
  storage?: {
    used_bytes: number
    database_bytes: number
    model_bytes: number
    audio_bytes: number
    available_bytes: number
  }
}

export type ConversationStorageState = 'active' | 'removed' | 'orphaned'

export interface ConversationStorageItem {
  id: string
  title: string
  created_at?: string | null
  deleted_at?: string | null
  state: ConversationStorageState
  message_count: number
  knowledge_count: number
  memory_count: number
  timeline_count: number
  graph_count: number
  total_records: number
  estimated_bytes: number
}

export interface ConversationStorageStatus {
  conversations: ConversationStorageItem[]
  orphaned: ConversationStorageItem[]
}

export interface LocalBackupImportResult {
  success: boolean
  message: string
  backup_exported_at?: string | null
  imported: Record<string, number>
  skipped: Record<string, number>
  total_imported: number
}

export type FocusTaskPriority = 'low' | 'medium' | 'high'
export type FocusTaskCategory = 'work' | 'study' | 'personal' | 'project' | 'other'
export type FocusTaskKind = 'TASK' | 'REMINDER'

export interface FocusTask {
  id: number
  title: string
  category: FocusTaskCategory
  priority: FocusTaskPriority
  completed: boolean
  is_focus: boolean
  created_at: string
  updated_at: string
  due_date: string | null
  item_type: FocusTaskKind
  source: 'manual' | 'chat' | 'inbox' | 'focus_input' | string
  source_session_id: string | null
  source_message_id: number | null
  confidence: number
  place_context: LocationPlaceContext | 'anywhere'
  trigger_on_arrival: boolean
  location_relevant?: boolean
  current_location_context?: LocationSemanticContext
}

export type LocationPlaceContext = 'home' | 'work' | 'gym' | 'study' | 'other'
export type LocationSemanticContext = LocationPlaceContext | 'commuting' | 'away' | 'unknown'

export interface KnownPlace {
  id: number
  name: string
  context: LocationPlaceContext
  latitude: number
  longitude: number
  radius_m: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface LocationState {
  id: number
  place_id: number | null
  place_name?: string | null
  context: LocationSemanticContext
  status: 'inside' | 'away' | 'manual' | 'unknown'
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  source: string
  updated_at: string | null
  changed?: boolean
  distance_m?: number | null
}

export interface LocationEvent {
  id: number
  place_id: number | null
  place_name?: string | null
  event_type: 'enter' | 'exit' | 'context_changed' | string
  context: LocationSemanticContext
  source: string
  created_at: string
}

export interface LocationDashboard {
  state: LocationState
  places: KnownPlace[]
  events: LocationEvent[]
  monitoring?: { enabled: boolean; authorization: string }
  policy: {
    continuous_gps: boolean
    precise_only_on_demand: boolean
    coordinates_sent_to_model: boolean
  }
}

export interface LocationRoutePoint {
  id: number
  route_id: number
  latitude: number
  longitude: number
  accuracy_m: number | null
  altitude_m: number | null
  speed_mps: number | null
  recorded_at: string
}

export interface LocationRoute {
  id: number
  name: string
  status: 'active' | 'completed' | 'interrupted'
  started_at: string
  ended_at: string | null
  distance_m: number
  duration_s: number
  point_count: number
  created_at: string
  points?: LocationRoutePoint[]
}

export interface LocationRouteDashboard {
  active: LocationRoute | null
  routes: LocationRoute[]
}

export interface FocusIdea {
  id: number
  content: string
  status: string
  source: string
  created_at: string
}

export interface FocusDecision {
  id: number
  content: string
  source: string
  created_at: string
}

export interface FocusTimelineEvent {
  id: number
  event_type: string
  title: string
  details: string
  created_at: string
}

export interface FocusInboxItem {
  id: number
  item_type: string
  content: string
  metadata: string
  source: string
  status: string
  created_at: string
}

export type FocusAction = 'complete_task' | 'create_task' | 'save_idea' | 'save_decision' | 'save_memory' | 'none'
export type FocusItemType = 'TASK' | 'REMINDER' | 'UPDATE' | 'IDEA' | 'DECISION' | 'MEMORY' | 'IGNORE'

export interface FocusAnalyzeItem {
  type: FocusItemType
  content: string
  action: FocusAction
  related_task_id?: number
  category?: FocusTaskCategory
  priority?: FocusTaskPriority
  confidence?: number
  due_date?: string | null
  place_context?: LocationPlaceContext | 'anywhere'
  trigger_on_arrival?: boolean
}

export interface FocusAnalyzePreview {
  items: FocusAnalyzeItem[]
}
