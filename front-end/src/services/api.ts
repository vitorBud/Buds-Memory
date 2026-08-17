// ─── API Service Layer ───────────────────────────────────────────────────────
// All calls go through the Vite proxy → http://127.0.0.1:5050 (web)
// or directly to http://127.0.0.1:5050/api (Electron desktop).

import { Capacitor } from '@capacitor/core'
import type {
  Session,
  ChatFolder,
  Message,
  BackendConfig,
  ChatStreamEvent,
  CognitiveMemory,
  KnowledgeGraph,
  KnowledgeSource,
  LocalBackupImportResult,
  LocalBackupStatus,
  ConversationStorageStatus,
  FocusTask,
  FocusTaskCategory,
  FocusTaskPriority,
  FocusAnalyzePreview,
  FocusAnalyzeItem,
  FocusIdea,
  FocusDecision,
  FocusTimelineEvent,
  FocusInboxItem,
  LocationDashboard,
  LocationContextSignal,
  LocationRoute,
  LocationRouteDashboard,
  KnownPlace,
  LocationPlaceContext,
  LocationSemanticContext,
  LocationState,
  SemanticLocationContext,
  LocalSyncDiscoveredPeer,
  LocalSyncPeer,
  LocalSyncRunResult,
  LocalSyncStatus,
} from '../types'
import {
  clearIOSLocalData,
  createIOSLocalSession,
  createIOSFocusTask,
  deleteIOSLocalSession,
  deleteIOSFocusTask,
  deleteIOSLocalMemory,
  analyzeIOSFocusInput,
  getIOSFocusThink,
  getIOSLocalMemories,
  getIOSLocalMessages,
  getIOSSessionKnowledge,
  getIOSLocalStatus,
  listIOSLocalSessions,
  listIOSFocusInbox,
  listIOSFocusTasks,
  listIOSFocusTimeline,
  listIOSConversationStorage,
  purgeIOSConversation,
  setIOSLocalCoreMemory,
  saveIOSFocusDecision,
  saveIOSFocusIdea,
  streamIOSLocalChat,
  updateIOSFocusInbox,
  updateIOSFocusTask,
  syncIOSFocusNotifications,
  updateIOSLocalMemory,
  updateIOSLocalSessionTitle,
  updateIOSLocalSessionFolder,
  listIOSChatFolders,
  createIOSChatFolder,
  updateIOSChatFolder,
  deleteIOSChatFolder,
  configureIOSLocationMonitoring,
  deleteIOSKnownPlace,
  getIOSLocationDashboard,
  getIOSSemanticLocationContext,
  requestIOSCurrentLocation,
  saveIOSKnownPlace,
  setIOSLocationContext,
  getIOSLocationRoutes,
  getIOSLocationRoute,
  startIOSLocationRoute,
  stopIOSLocationRoute,
  deleteIOSLocationRoute,
  addIOSContextSignalListener,
  discoverIOSLocalSyncPeers,
  getIOSLocalSyncStatus,
  pairIOSLocalSyncPeer,
  syncIOSFocusWithPeer,
  importIOSKnowledge,
} from '../plataformas'

type BudsBridge = {
  apiBase?: string
  isDesktop?: boolean
  getRemoteToken?: () => Promise<string>
}
const REMOTE_SESSION_KEY = 'nexus-remote-session-token'

export function isNativeIOSRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

/**
 * Resolve a URL base de forma lazy (em tempo de execução) para garantir que o
 * preload do Electron já injetou a bridge antes da primeira chamada de API.
 */
export function getBase(): string {
  const bridge = (window as unknown as { nexus?: BudsBridge }).nexus
  return bridge?.apiBase || import.meta.env.VITE_API_BASE_URL || '/api'
}

export function getRemoteSessionToken(): string {
  try {
    return localStorage.getItem(REMOTE_SESSION_KEY) || ''
  } catch {
    return ''
  }
}

function setRemoteSessionToken(token: string) {
  try {
    if (token) localStorage.setItem(REMOTE_SESSION_KEY, token)
    else localStorage.removeItem(REMOTE_SESSION_KEY)
  } catch { /* localStorage unavailable */ }
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  const token = getRemoteSessionToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

export function isDesktopRuntime(): boolean {
  return Boolean((window as unknown as { nexus?: BudsBridge }).nexus?.isDesktop)
}

function getAudioUploadName(blob: Blob): string {
  const mime = blob.type.split(';')[0].toLowerCase()
  const extByMime: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
  }
  return `recording.${extByMime[mime] || 'webm'}`
}

export async function transcribeAudioPartial(
  audio: Blob,
  signal?: AbortSignal,
): Promise<{ text: string; latencyMs: number; provider: string }> {
  if (isNativeIOSRuntime()) {
    throw new Error('O iPhone usa o reconhecedor local incremental nativo.')
  }
  const body = new FormData()
  body.append('audio', audio, getAudioUploadName(audio))
  const response = await authFetch(`${getBase()}/voice/transcribe-partial`, {
    method: 'POST',
    body,
    signal,
  })
  if (!response.ok) throw await apiError(response)
  const result = await response.json() as {
    text?: string
    latency_ms?: number
    provider?: string
  }
  return {
    text: result.text?.trim() || '',
    latencyMs: result.latency_ms ?? 0,
    provider: result.provider || 'faster-whisper-local',
  }
}

/**
 * Converte um caminho relativo de API (/api/audio/...) em URL absoluta.
 * Necessário para funcionar tanto no browser (proxy Vite) quanto no Electron (file://).
 */
export function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path
  const base = getBase().replace(/\/api$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const token = getRemoteSessionToken()
  if (!token || !url.includes('/api/audio/')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

/** Transforma erros de rede crus em mensagens amigáveis em português. */
function humanizeError(err: unknown): Error {
  if (!navigator.onLine) {
    return new Error(
      'Modo Offline. Verifique sua conexão com a internet ou rede Wi-Fi.',
    )
  }

  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return new Error(
      'Não foi possível conectar ao servidor local. Verifique se o backend do Buds está rodando na porta 5050.',
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function apiError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string }
  return new Error(payload.error || `Falha na API local (${response.status}).`)
}

async function fetchJsonWithStartupRetry<T>(url: string, attempts = isDesktopRuntime() ? 16 : 1): Promise<T> {
  let lastError: unknown

  for (let index = 0; index < attempts; index += 1) {
    try {
      const res = await authFetch(url)
      if (!res.ok) throw new Error(`${url}: ${res.status}`)
      return res.json()
    } catch (err) {
      lastError = err
      if (index < attempts - 1) await wait(450)
    }
  }

  throw humanizeError(lastError) ?? new Error(`Falha ao acessar ${url}`)
}

// ── Backend Config ─────────────────────────────────────────────────────────

export async function getBackendConfig(): Promise<BackendConfig> {
  if (isNativeIOSRuntime()) {
    const status = await getIOSLocalStatus()
    return {
      model: status.modelName,
      models: [status.modelName],
      ollama_url: 'iphone://local',
      google_search_available: false,
      data_dir: 'iphone://application-support/BudsMemory',
    }
  }
  return fetchJsonWithStartupRetry<BackendConfig>(`${getBase()}/config`)
}

export async function loginRemote(token: string): Promise<{ access_token?: string; success: boolean; error?: string }> {
  const res = await fetch(`${getBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, label: navigator.userAgent || 'mobile' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `loginRemote: ${res.status}`)
  if (data.access_token) setRemoteSessionToken(data.access_token)
  return data
}

export async function loginLocal(): Promise<{ access_token?: string; success: boolean; auth_mode?: string; error?: string }> {
  const res = await fetch(`${getBase()}/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: navigator.userAgent || 'local' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `loginLocal: ${res.status}`)
  if (data.access_token) setRemoteSessionToken(data.access_token)
  return data
}

export async function getLocalDeviceToken(): Promise<string> {
  const bridge = (window as unknown as { nexus?: BudsBridge }).nexus
  if (bridge?.getRemoteToken) {
    return bridge.getRemoteToken()
  }

  const isMobileBrowser = (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
  const candidates = isMobileBrowser
    ? [`${getBase()}/auth/device-token`]
    : [
        `${getBase()}/auth/device-token`,
        'http://127.0.0.1:5050/api/auth/device-token',
      ]
  let lastError: unknown

  for (const url of [...new Set(candidates)]) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3500),
      })
      const data = await res.json().catch(() => ({})) as { token?: string; error?: string }
      if (res.ok) return String(data.token || '')
      lastError = new Error(data.error || `getLocalDeviceToken: ${res.status}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Não foi possível consultar o token local.')
}

// ── Local Memory Backup ────────────────────────────────────────────────────

export async function getLocalBackupStatus(): Promise<LocalBackupStatus> {
  if (isNativeIOSRuntime()) {
    const [sessions, status] = await Promise.all([
      listIOSLocalSessions(),
      getIOSLocalStatus(),
    ])
    return {
      mode: 'iphone-local',
      device_id: 'buds-iphone',
      local_records: { sessions: sessions.length },
      storage: {
        used_bytes: status.storage.usedBytes,
        database_bytes: status.storage.databaseBytes,
        model_bytes: status.modelBytes,
        audio_bytes: 0,
        available_bytes: status.storage.availableBytes,
      },
    }
  }
  return fetchJsonWithStartupRetry<LocalBackupStatus>(`${getBase()}/local-backup/status`)
}

export async function getLocalSyncStatus(): Promise<LocalSyncStatus> {
  if (isNativeIOSRuntime()) return getIOSLocalSyncStatus()
  const response = await authFetch(`${getBase()}/local-sync/v1/status`)
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function startLocalSyncPairing(): Promise<{
  code: string
  expires_in_seconds: number
  advertised: boolean
  device: LocalSyncStatus['device']
}> {
  if (isNativeIOSRuntime()) throw new Error('O código de pareamento deve ser criado no Mac.')
  const response = await authFetch(`${getBase()}/local-sync/v1/pairing/start`, { method: 'POST' })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function advertiseLocalSyncMac(): Promise<{ advertised: boolean; expires_in_seconds: number }> {
  if (isNativeIOSRuntime()) throw new Error('O anúncio Local Sync é iniciado no Mac.')
  const response = await authFetch(`${getBase()}/local-sync/v1/advertise`, { method: 'POST' })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function discoverLocalSyncPeers(): Promise<{ peers: LocalSyncDiscoveredPeer[]; discovery_ms: number }> {
  if (!isNativeIOSRuntime()) return { peers: [], discovery_ms: 0 }
  return discoverIOSLocalSyncPeers()
}

export async function pairLocalSyncPeer(peer: LocalSyncDiscoveredPeer, code: string): Promise<LocalSyncPeer> {
  if (!isNativeIOSRuntime()) throw new Error('O pareamento deve ser confirmado no iPhone.')
  return pairIOSLocalSyncPeer(peer, code)
}

export async function syncFocusWithLocalPeer(peerDeviceId: string): Promise<LocalSyncRunResult> {
  if (!isNativeIOSRuntime()) {
    throw new Error('Nesta V0, o iPhone inicia a troca bidirecional com o Mac.')
  }
  return syncIOSFocusWithPeer(peerDeviceId)
}

export async function requestLocalSyncFromMac(peerDeviceId: string): Promise<{ requested: boolean; request_id: string }> {
  if (isNativeIOSRuntime()) throw new Error('Esta solicitação é iniciada no Mac.')
  const response = await authFetch(`${getBase()}/local-sync/v1/peers/${encodeURIComponent(peerDeviceId)}/request-sync`, {
    method: 'POST',
  })
  if (!response.ok) throw await apiError(response)
  return response.json()
}

export async function clearLocalStorage(confirmation: string): Promise<LocalBackupStatus> {
  if (isNativeIOSRuntime()) {
    const status = await clearIOSLocalData(confirmation)
    return {
      mode: 'iphone-local',
      device_id: 'buds-iphone',
      local_records: { sessions: 0 },
      storage: {
        used_bytes: status.storage.usedBytes,
        database_bytes: status.storage.databaseBytes,
        model_bytes: status.modelBytes,
        audio_bytes: 0,
        available_bytes: status.storage.availableBytes,
      },
    }
  }

  let response: Response
  try {
    response = await authFetch(`${getBase()}/local-storage`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    })
  } catch (error) {
    throw humanizeError(error)
  }
  const payload = await response.json().catch(() => ({})) as {
    error?: string
    status?: LocalBackupStatus
  }
  if (!response.ok || !payload.status) {
    throw new Error(payload.error || `clearLocalStorage: ${response.status}`)
  }
  return payload.status
}

export async function getConversationStorage(): Promise<ConversationStorageStatus> {
  if (isNativeIOSRuntime()) {
    const items = await listIOSConversationStorage()
    return {
      conversations: items.filter(item => item.state !== 'orphaned'),
      orphaned: items.filter(item => item.state === 'orphaned'),
    }
  }
  return fetchJsonWithStartupRetry<ConversationStorageStatus>(`${getBase()}/local-storage/conversations`)
}

export async function purgeConversationStorage(id: string): Promise<ConversationStorageStatus> {
  if (isNativeIOSRuntime()) {
    const items = await purgeIOSConversation(id)
    return {
      conversations: items.filter(item => item.state !== 'orphaned'),
      orphaned: items.filter(item => item.state === 'orphaned'),
    }
  }

  let response: Response
  try {
    response = await authFetch(`${getBase()}/local-storage/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: `APAGAR:${id}` }),
    })
  } catch (error) {
    throw humanizeError(error)
  }
  const payload = await response.json().catch(() => ({})) as ConversationStorageStatus & { error?: string }
  if (!response.ok) throw new Error(payload.error || `purgeConversationStorage: ${response.status}`)
  return {
    conversations: payload.conversations || [],
    orphaned: payload.orphaned || [],
  }
}

export async function exportLocalMemoryBackup(): Promise<void> {
  if (isNativeIOSRuntime()) {
    throw new Error('O backup nativo do iPhone será disponibilizado em uma próxima etapa. As memórias já permanecem salvas localmente.')
  }
  let res: Response
  try {
    res = await authFetch(`${getBase()}/local-backup/export`)
  } catch (err) {
    throw humanizeError(err)
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `exportLocalMemoryBackup: ${res.status}`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
  const filename = filenameMatch?.[1] || `buds-memory-backup-${new Date().toISOString().slice(0, 10)}.json`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function importLocalMemoryBackup(file: File): Promise<LocalBackupImportResult> {
  if (isNativeIOSRuntime()) {
    void file
    throw new Error('A importação de backup ainda não está disponível no modo totalmente local do iPhone.')
  }
  const body = new FormData()
  body.append('file', file)

  let res: Response
  try {
    res = await authFetch(`${getBase()}/local-backup/import`, {
      method: 'POST',
      body,
    })
  } catch (err) {
    throw humanizeError(err)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `importLocalMemoryBackup: ${res.status}`)
  return data
}

// ── Cognitive Brain / Obsidian ─────────────────────────────────────────────

export async function getCognitiveMemories(limit = 200): Promise<CognitiveMemory[]> {
  if (isNativeIOSRuntime()) return getIOSLocalMemories(limit)
  return fetchJsonWithStartupRetry<CognitiveMemory[]>(`${getBase()}/cognitive/memory?limit=${limit}`)
}

export async function getKnowledgeGraph(limit = 240): Promise<KnowledgeGraph> {
  if (isNativeIOSRuntime()) {
    // As memórias locais já são entregues separadamente ao BrainMap. Duplicá-las
    // como entidades e ligar uma à próxima pela ordem de criação produzia um
    // grafo visualmente cheio, mas semanticamente falso no iPhone.
    return {
      entities: [],
      edges: [],
    }
  }
  return fetchJsonWithStartupRetry<KnowledgeGraph>(`${getBase()}/cognitive/graph?limit=${limit}`)
}

export async function updateCognitiveMemory(
  id: number,
  updates: Partial<Pick<CognitiveMemory, 'content' | 'memory_type' | 'importance' | 'tags' | 'origin_type'>>,
): Promise<CognitiveMemory> {
  if (isNativeIOSRuntime()) {
    return updateIOSLocalMemory(id, {
      content: updates.content,
      importance: updates.importance,
    })
  }
  const res = await authFetch(`${getBase()}/cognitive/memory/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `updateCognitiveMemory: ${res.status}`)
  return data
}

export async function setCoreMemory(id: number, enabled: boolean): Promise<CognitiveMemory> {
  if (isNativeIOSRuntime()) {
    return setIOSLocalCoreMemory(id, enabled)
  }
  const res = await authFetch(`${getBase()}/cognitive/memory/${id}/core`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, user_confirmed: true }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `setCoreMemory: ${res.status}`)
  return data
}

export async function deleteCognitiveMemory(id: number, force = false): Promise<void> {
  if (isNativeIOSRuntime()) {
    return deleteIOSLocalMemory(id, force)
  }
  const res = await authFetch(`${getBase()}/cognitive/memory/${id}?force=${String(force)}`, {
    method: 'DELETE',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `deleteCognitiveMemory: ${res.status}`)
}

type CodebaseIndexResponse = {
  error?: string
  project_root?: string
  files_scanned?: number
  files_skipped?: number
  records_indexed?: number
  indexed_files?: number
  indexed_rows?: number
}

export async function indexCodebase(projectRoot: string, maxFiles = 900): Promise<{ indexed_files: number; indexed_rows: number; files_skipped: number; project_root: string }> {
  const res = await authFetch(`${getBase()}/cognitive/codebase/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_root: projectRoot, max_files: maxFiles }),
  })
  const data = await res.json().catch(() => ({})) as CodebaseIndexResponse
  if (!res.ok) throw new Error(data.error || `indexCodebase: ${res.status}`)
  return {
    project_root: data.project_root || projectRoot,
    indexed_files: data.indexed_files ?? data.files_scanned ?? 0,
    indexed_rows: data.indexed_rows ?? data.records_indexed ?? 0,
    files_skipped: data.files_skipped ?? 0,
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(channel: 'chat' | 'voice' = 'chat'): Promise<Session[]> {
  if (isNativeIOSRuntime()) return listIOSLocalSessions(channel)
  return fetchJsonWithStartupRetry<Session[]>(`${getBase()}/sessions?channel=${encodeURIComponent(channel)}`)
}

export async function createSession(title?: string, folderId?: string | null, channel: 'chat' | 'voice' = 'chat'): Promise<Session> {
  if (isNativeIOSRuntime()) return createIOSLocalSession(title, folderId, channel)
  const res = await authFetch(`${getBase()}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? null, folder_id: folderId ?? null, channel }),
  })
  if (!res.ok) throw new Error(`createSession: ${res.status}`)
  return res.json()
}

export async function deleteSession(id: string): Promise<void> {
  if (isNativeIOSRuntime()) return deleteIOSLocalSession(id)
  const res = await authFetch(`${getBase()}/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteSession: ${res.status}`)
}

export async function updateSessionTitle(id: string, title: string): Promise<Session> {
  if (isNativeIOSRuntime()) return updateIOSLocalSessionTitle(id, title)
  const res = await authFetch(`${getBase()}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`updateSessionTitle: ${res.status}`)
  return res.json()
}

export async function updateSessionFolder(id: string, folderId: string | null): Promise<Session> {
  if (isNativeIOSRuntime()) return updateIOSLocalSessionFolder(id, folderId)
  const res = await authFetch(`${getBase()}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_id: folderId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `updateSessionFolder: ${res.status}`)
  return data
}

export async function getChatFolders(): Promise<ChatFolder[]> {
  if (isNativeIOSRuntime()) return listIOSChatFolders()
  return fetchJsonWithStartupRetry<ChatFolder[]>(`${getBase()}/chat-folders`)
}

export async function createChatFolder(input: Pick<ChatFolder, 'name' | 'icon' | 'color'>): Promise<ChatFolder> {
  if (isNativeIOSRuntime()) return createIOSChatFolder(input)
  const res = await authFetch(`${getBase()}/chat-folders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `createChatFolder: ${res.status}`)
  return data
}

export async function updateChatFolder(id: string, updates: Partial<Pick<ChatFolder, 'name' | 'icon' | 'color'>>): Promise<ChatFolder> {
  if (isNativeIOSRuntime()) return updateIOSChatFolder(id, updates)
  const res = await authFetch(`${getBase()}/chat-folders/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `updateChatFolder: ${res.status}`)
  return data
}

export async function deleteChatFolder(id: string): Promise<void> {
  if (isNativeIOSRuntime()) return deleteIOSChatFolder(id)
  const res = await authFetch(`${getBase()}/chat-folders/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `deleteChatFolder: ${res.status}`)
  }
}

export async function getSessionMessages(id: string): Promise<Message[]> {
  if (isNativeIOSRuntime()) return getIOSLocalMessages(id)
  const res = await authFetch(`${getBase()}/sessions/${id}/messages`)
  if (!res.ok) throw new Error(`getSessionMessages: ${res.status}`)
  return res.json()
}

// ── Knowledge Sources ──────────────────────────────────────────────────────

export async function getSessionKnowledge(id: string): Promise<KnowledgeSource[]> {
  if (isNativeIOSRuntime()) return getIOSSessionKnowledge(id)
  const res = await authFetch(`${getBase()}/sessions/${id}/knowledge`)
  if (!res.ok) throw new Error(`getSessionKnowledge: ${res.status}`)
  return res.json()
}

export async function importKnowledge(
  sessionId: string,
  payload: { file?: File; text?: string; url?: string; query?: string; title?: string },
): Promise<KnowledgeSource> {
  if (isNativeIOSRuntime()) {
    const content = (payload.text || payload.url || payload.query || '').trim()
    return importIOSKnowledge(sessionId, {
      ...(payload.file ? { file: payload.file } : {}),
      ...(content ? { text: content } : {}),
      ...(payload.title ? { title: payload.title } : {}),
    })
  }
  let response: Response

  if (payload.file) {
    const body = new FormData()
    body.append('file', payload.file)
    if (payload.title) body.append('title', payload.title)
    response = await authFetch(`${getBase()}/sessions/${sessionId}/knowledge`, {
      method: 'POST',
      body,
    })
  } else {
    response = await authFetch(`${getBase()}/sessions/${sessionId}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        url: payload.url,
        query: payload.query,
        title: payload.title,
      }),
    })
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `importKnowledge: ${response.status}`)
  }
  return response.json()
}

// ── Chat Streaming (SSE via ReadableStream) ─────────────────────────────────

export async function streamChat(
  payload: { text?: string; audio?: Blob; sessionId?: string; model?: string; webSearch?: boolean; tts?: boolean },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isNativeIOSRuntime()) {
    if (payload.audio) throw new Error('No iPhone, use a captura nativa de voz; o chat local recebe o texto já transcrito.')
    return streamIOSLocalChat(payload, onEvent, signal)
  }
  const attempts = isDesktopRuntime() ? 3 : 2
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let body: FormData | null = null
    let receivedAnyEvent = false

    if (payload.audio) {
      body = new FormData()
      body.append('audio', payload.audio, getAudioUploadName(payload.audio))
      if (payload.sessionId) body.append('session_id', payload.sessionId)
      if (payload.model) body.append('model', payload.model)
      if (payload.webSearch) body.append('web_search', 'true')
      body.append('tts', String(Boolean(payload.tts)))
    }

    const fetchOptions: RequestInit = payload.audio
      ? { method: 'POST', body, signal }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: payload.text,
            session_id: payload.sessionId,
            model: payload.model,
            web_search: payload.webSearch,
            tts: Boolean(payload.tts),
          }),
          signal,
        }

    try {
      const response = await authFetch(`${getBase()}/chat/stream`, fetchOptions)
      if (!response.ok || !response.body) throw new Error(`streamChat: ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          try {
            const event = JSON.parse(raw)
            // Resolve URLs de áudio relativas para absolutas (necessário no Electron)
            if (event.url && !event.url.startsWith('http')) {
              event.url = resolveUrl(event.url)
            }
            receivedAnyEvent = true
            onEvent(event)
          } catch { /* ignore parse errors */ }
        }
      }
      return
    } catch (err) {
      lastError = err
      if (signal?.aborted || receivedAnyEvent || attempt >= attempts - 1) break
      await wait(550 + attempt * 650)
    }
  }

  throw humanizeError(lastError) ?? new Error('Falha ao conectar com o chat.')
}

// ─── Focus (Produtividade) ──────────────────────────────────────────────────

export async function getFocusTasks(): Promise<FocusTask[]> {
  if (isNativeIOSRuntime()) {
    const tasks = await listIOSFocusTasks()
    void syncIOSFocusNotifications().catch(error => console.warn('Não foi possível sincronizar os lembretes locais.', error))
    return tasks
  }
  const res = await authFetch(`${getBase()}/cognitive/focus`, { method: 'GET' })
  if (!res.ok) throw new Error('Falha ao carregar tarefas.')
  return await res.json()
}

export async function createFocusTask(
  title: string,
  category: FocusTaskCategory = 'other',
  priority: FocusTaskPriority = 'medium',
  is_focus = false,
  due_date: string | null = null,
  item_type: FocusTask['item_type'] = 'TASK',
  place_context: FocusTask['place_context'] = 'anywhere',
  trigger_on_arrival = false,
): Promise<FocusTask> {
  if (isNativeIOSRuntime()) {
    return createIOSFocusTask(title, category, priority, is_focus, due_date ?? undefined, item_type, place_context, trigger_on_arrival)
  }
  const res = await authFetch(`${getBase()}/cognitive/focus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, priority, is_focus, due_date, item_type, place_context, trigger_on_arrival }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao criar tarefa.')
  return data
}

export async function updateFocusTask(
  taskId: number,
  updates: Partial<FocusTask>
): Promise<FocusTask> {
  if (isNativeIOSRuntime()) return updateIOSFocusTask(taskId, updates)
  const res = await authFetch(`${getBase()}/cognitive/focus/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao atualizar tarefa.')
  return data
}

export async function deleteFocusTask(taskId: number): Promise<void> {
  if (isNativeIOSRuntime()) return deleteIOSFocusTask(taskId)
  const res = await authFetch(`${getBase()}/cognitive/focus/${taskId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Falha ao apagar tarefa.')
}

export async function analyzeFocusInput(text: string): Promise<FocusAnalyzePreview> {
  if (isNativeIOSRuntime()) return analyzeIOSFocusInput(text)
  const res = await authFetch(`${getBase()}/cognitive/focus/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao analisar input.')
  return data
}

export async function applyFocusItems(items: FocusAnalyzeItem[]): Promise<{ applied: boolean; results: Array<{ type: string; id?: number }> }> {
  if (isNativeIOSRuntime()) {
    const results: Array<{ type: string; id?: number }> = []
    for (const item of items) {
      const content = item.content.trim()
      if (!content || item.type === 'IGNORE') continue
      if (item.action === 'create_task') {
        const task = await createIOSFocusTask(
          content,
          item.category ?? 'other',
          item.priority ?? 'medium',
          false,
          item.due_date ?? undefined,
          item.type === 'REMINDER' ? 'REMINDER' : 'TASK',
          item.place_context ?? 'anywhere',
          item.trigger_on_arrival ?? false,
        )
        results.push({ type: 'task', id: task.id })
      } else if (item.action === 'complete_task' && item.related_task_id) {
        const task = await updateIOSFocusTask(item.related_task_id, { completed: true })
        results.push({ type: 'task_update', id: task.id })
      } else if (item.action === 'save_idea') {
        await saveIOSFocusIdea(content)
        results.push({ type: 'idea' })
      } else if (item.action === 'save_decision') {
        await saveIOSFocusDecision(content)
        results.push({ type: 'decision' })
      }
    }
    return { applied: true, results }
  }
  const res = await authFetch(`${getBase()}/cognitive/focus/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao aplicar alterações.')
  return data
}

export async function getFocusThink(query: string): Promise<string> {
  if (isNativeIOSRuntime()) return getIOSFocusThink(query)
  const res = await authFetch(`${getBase()}/cognitive/focus/think`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao consultar Buds Think.')
  return data.suggestion
}

export async function getFocusIdeas(): Promise<FocusIdea[]> {
  if (isNativeIOSRuntime()) return []
  const res = await authFetch(`${getBase()}/cognitive/focus/ideas`, { method: 'GET' })
  if (!res.ok) throw new Error('Falha ao carregar ideias.')
  return await res.json()
}

export async function getFocusDecisions(): Promise<FocusDecision[]> {
  if (isNativeIOSRuntime()) return []
  const res = await authFetch(`${getBase()}/cognitive/focus/decisions`, { method: 'GET' })
  if (!res.ok) throw new Error('Falha ao carregar decisões.')
  return await res.json()
}

export async function getFocusTimeline(): Promise<FocusTimelineEvent[]> {
  if (isNativeIOSRuntime()) return listIOSFocusTimeline()
  const res = await authFetch(`${getBase()}/cognitive/focus/timeline`, { method: 'GET' })
  if (!res.ok) throw new Error('Falha ao carregar timeline.')
  return await res.json()
}

export async function getFocusInbox(): Promise<FocusInboxItem[]> {
  if (isNativeIOSRuntime()) return listIOSFocusInbox()
  const res = await authFetch(`${getBase()}/cognitive/focus/inbox`, { method: 'GET' })
  if (!res.ok) throw new Error('Falha ao carregar inbox.')
  return await res.json()
}

export async function updateFocusInboxStatus(itemId: number, status: string): Promise<void> {
  if (isNativeIOSRuntime()) {
    if (status !== 'approved' && status !== 'ignored') throw new Error('Status inválido para a Buds Inbox.')
    return updateIOSFocusInbox(itemId, status)
  }
  const res = await authFetch(`${getBase()}/cognitive/focus/inbox/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error('Falha ao atualizar status da inbox.')
}

// Retrocompatibilidade
export async function processBrainDump(text: string): Promise<{ tasks: Array<Pick<FocusTask, 'title' | 'category' | 'priority'>> }> {
  if (isNativeIOSRuntime()) {
    const preview = await analyzeIOSFocusInput(text)
    return {
      tasks: preview.items
        .filter(item => item.action === 'create_task')
        .map(item => ({
          title: item.content,
          category: item.category ?? 'other',
          priority: item.priority ?? 'medium',
        })),
    }
  }
  const res = await authFetch(`${getBase()}/cognitive/focus/braindump`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao processar brain dump.')
  return data
}

export async function organizeMyDay(): Promise<string> {
  if (isNativeIOSRuntime()) return getIOSFocusThink('Sugira uma ordem objetiva para as minhas tarefas de hoje.')
  const res = await authFetch(`${getBase()}/cognitive/focus/organize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Falha ao organizar dia.')
  return data.suggestion
}

// ─── Buds Map / contexto de lugar ──────────────────────────────────────────

let browserRouteWatchId: number | null = null
let browserContextWatchId: number | null = null
const BROWSER_CONTEXT_MONITORING_KEY = 'buds-location-monitoring-enabled-v1'

async function postBrowserLocationSample(position: GeolocationPosition): Promise<void> {
  const response = await authFetch(`${getBase()}/cognitive/location/sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy,
      altitude_m: position.coords.altitude,
      speed_mps: position.coords.speed,
      recorded_at: new Date(position.timestamp).toISOString(),
      source: 'browser',
    }),
  })
  if (!response.ok) throw new Error('Não foi possível registrar um ponto do trajeto.')
  const state = await response.json().catch(() => ({})) as LocationState
  emitBrowserContextSignal(state.context_signal)
}

const LOCATION_SIGNAL_EVENT = 'buds-context-signal'

function emitBrowserContextSignal(signal?: LocationContextSignal): void {
  if (!signal || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<LocationContextSignal>(LOCATION_SIGNAL_EVENT, { detail: signal }))
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(signal.title, { body: signal.message, tag: `buds-context-${signal.place_context}` })
  }
}

export async function subscribeLocationContextSignals(
  listener: (signal: LocationContextSignal) => void,
): Promise<() => void> {
  if (isNativeIOSRuntime()) {
    const handle = await addIOSContextSignalListener(listener)
    return () => { void handle.remove() }
  }
  const handler = (event: Event) => listener((event as CustomEvent<LocationContextSignal>).detail)
  window.addEventListener(LOCATION_SIGNAL_EVENT, handler)
  return () => window.removeEventListener(LOCATION_SIGNAL_EVENT, handler)
}

function startBrowserRouteWatcher() {
  if (browserRouteWatchId !== null || !navigator.geolocation) return
  stopBrowserContextWatcher()
  browserRouteWatchId = navigator.geolocation.watchPosition(
    position => { void postBrowserLocationSample(position).catch(error => console.warn('[BudsMap]', error)) },
    error => console.warn('[BudsMap] Rastreamento pausado:', error.message),
    { enableHighAccuracy: true, maximumAge: 3_000, timeout: 15_000 },
  )
}

function stopBrowserRouteWatcher() {
  if (browserRouteWatchId === null || !navigator.geolocation) return
  navigator.geolocation.clearWatch(browserRouteWatchId)
  browserRouteWatchId = null
  if (localStorage.getItem(BROWSER_CONTEXT_MONITORING_KEY) === '1') startBrowserContextWatcher()
}

function startBrowserContextWatcher() {
  if (browserContextWatchId !== null || browserRouteWatchId !== null || !navigator.geolocation) return
  browserContextWatchId = navigator.geolocation.watchPosition(
    position => { void postBrowserLocationSample(position).catch(error => console.warn('[BudsContext]', error)) },
    error => console.warn('[BudsContext] Monitoramento econômico pausado:', error.message),
    { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 30_000 },
  )
}

function stopBrowserContextWatcher() {
  if (browserContextWatchId === null || !navigator.geolocation) return
  navigator.geolocation.clearWatch(browserContextWatchId)
  browserContextWatchId = null
}

export async function getLocationDashboard(): Promise<LocationDashboard> {
  if (isNativeIOSRuntime()) return getIOSLocationDashboard()
  const dashboard = await fetchJsonWithStartupRetry<LocationDashboard>(`${getBase()}/cognitive/location?limit=30`)
  const enabled = localStorage.getItem(BROWSER_CONTEXT_MONITORING_KEY) === '1'
  if (enabled) startBrowserContextWatcher()
  return {
    ...dashboard,
    monitoring: { enabled, authorization: enabled ? 'browser_while_open' : 'on_demand' },
  }
}

export async function getSemanticLocationContext(): Promise<SemanticLocationContext> {
  if (isNativeIOSRuntime()) return getIOSSemanticLocationContext()
  return fetchJsonWithStartupRetry<SemanticLocationContext>(`${getBase()}/cognitive/location/semantic-context`)
}

export async function getLocationRoutes(): Promise<LocationRouteDashboard> {
  if (isNativeIOSRuntime()) return getIOSLocationRoutes()
  const dashboard = await fetchJsonWithStartupRetry<LocationRouteDashboard>(`${getBase()}/cognitive/location/routes?limit=30`)
  if (dashboard.active) startBrowserRouteWatcher()
  return dashboard
}

export async function getLocationRoute(id: number): Promise<LocationRoute> {
  if (isNativeIOSRuntime()) return getIOSLocationRoute(id)
  return fetchJsonWithStartupRetry<LocationRoute>(`${getBase()}/cognitive/location/routes/${id}`)
}

export async function startLocationRoute(name?: string): Promise<LocationRoute> {
  if (isNativeIOSRuntime()) return startIOSLocationRoute(name)
  if (!navigator.geolocation) throw new Error('Localização não está disponível neste computador.')
  const response = await authFetch(`${getBase()}/cognitive/location/routes/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível iniciar o trajeto.')
  startBrowserRouteWatcher()
  return data
}

export async function stopLocationRoute(): Promise<LocationRoute | null> {
  if (isNativeIOSRuntime()) return stopIOSLocationRoute()
  stopBrowserRouteWatcher()
  const response = await authFetch(`${getBase()}/cognitive/location/routes/stop`, { method: 'POST' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível encerrar o trajeto.')
  return data as LocationRoute
}

export async function deleteLocationRoute(id: number): Promise<void> {
  if (isNativeIOSRuntime()) return deleteIOSLocationRoute(id)
  const response = await authFetch(`${getBase()}/cognitive/location/routes/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Não foi possível apagar o trajeto.')
}

export async function refreshLocationContext(): Promise<LocationState> {
  if (isNativeIOSRuntime()) return requestIOSCurrentLocation()
  if (!navigator.geolocation) throw new Error('Localização não está disponível neste computador.')
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: 12_000,
    })
  })
  const res = await authFetch(`${getBase()}/cognitive/location/sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy,
      altitude_m: position.coords.altitude,
      speed_mps: position.coords.speed,
      recorded_at: new Date(position.timestamp).toISOString(),
      source: 'browser',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Não foi possível atualizar o contexto de lugar.')
  emitBrowserContextSignal((data as LocationState).context_signal)
  return data
}

export async function saveKnownPlace(
  place: Omit<KnownPlace, 'id' | 'created_at' | 'updated_at'> & { id?: number },
): Promise<KnownPlace> {
  if (isNativeIOSRuntime()) return saveIOSKnownPlace(place)
  const path = place.id === undefined
    ? `${getBase()}/cognitive/location/places`
    : `${getBase()}/cognitive/location/places/${place.id}`
  const res = await authFetch(path, {
    method: place.id === undefined ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(place),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Não foi possível salvar este lugar.')
  return data
}

export async function deleteKnownPlace(id: number): Promise<void> {
  if (isNativeIOSRuntime()) return deleteIOSKnownPlace(id)
  const res = await authFetch(`${getBase()}/cognitive/location/places/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Não foi possível apagar este lugar.')
}

export async function setLocationContext(context: LocationSemanticContext): Promise<LocationState> {
  if (isNativeIOSRuntime()) return setIOSLocationContext(context)
  const res = await authFetch(`${getBase()}/cognitive/location/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Não foi possível trocar o contexto.')
  return data
}

export async function configureLocationMonitoring(enabled: boolean): Promise<{ enabled: boolean; authorization: string }> {
  if (isNativeIOSRuntime()) return configureIOSLocationMonitoring(enabled)
  if (!navigator.geolocation) return { enabled: false, authorization: 'unavailable' }
  localStorage.setItem(BROWSER_CONTEXT_MONITORING_KEY, enabled ? '1' : '0')
  if (enabled) {
    startBrowserContextWatcher()
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }
  else stopBrowserContextWatcher()
  return { enabled, authorization: enabled ? 'browser_while_open' : 'on_demand' }
}

export function resumeLocationMonitoring(): void {
  if (isNativeIOSRuntime()) return
  if (localStorage.getItem(BROWSER_CONTEXT_MONITORING_KEY) === '1') startBrowserContextWatcher()
}

export type { LocationPlaceContext }
