// ─── API Service Layer ───────────────────────────────────────────────────────
// All calls go through the Vite proxy → http://127.0.0.1:5050 (web)
// or directly to http://127.0.0.1:5050/api (Electron desktop).

import { Capacitor } from '@capacitor/core'
import type {
  Session,
  Message,
  BackendConfig,
  ChatStreamEvent,
  CognitiveMemory,
  KnowledgeGraph,
  KnowledgeSource,
  LocalBackupImportResult,
  LocalBackupStatus,
  ConversationStorageStatus,
} from '../types'
import {
  clearIOSLocalData,
  createIOSLocalMemory,
  createIOSLocalSession,
  deleteIOSLocalSession,
  deleteIOSLocalMemory,
  getIOSLocalMemories,
  getIOSLocalMessages,
  getIOSLocalStatus,
  listIOSLocalSessions,
  listIOSConversationStorage,
  purgeIOSConversation,
  setIOSLocalCoreMemory,
  streamIOSLocalChat,
  updateIOSLocalMemory,
  updateIOSLocalSessionTitle,
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

function isDesktop(): boolean {
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

async function fetchJsonWithStartupRetry<T>(url: string, attempts = isDesktop() ? 16 : 1): Promise<T> {
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
    const memories = await getIOSLocalMemories(limit)
    return {
      entities: memories.map(memory => ({
        id: memory.id,
        name: memory.content.slice(0, 72),
        entity_type: memory.is_core ? 'core_memory' : 'memory',
        description: memory.content,
        importance: memory.importance,
        access_count: memory.access_count,
        first_seen: memory.created_at,
        last_seen: memory.last_accessed || memory.created_at,
        metadata: { origin: 'iphone_local' },
      })),
      edges: memories.slice(1).map((memory, index) => ({
        source: memories[index].content.slice(0, 72),
        target: memory.content.slice(0, 72),
        relation_type: 'memória relacionada',
        strength: Math.min(memories[index].importance, memory.importance),
      })),
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

export async function getSessions(): Promise<Session[]> {
  if (isNativeIOSRuntime()) return listIOSLocalSessions()
  return fetchJsonWithStartupRetry<Session[]>(`${getBase()}/sessions`)
}

export async function createSession(title?: string): Promise<Session> {
  if (isNativeIOSRuntime()) return createIOSLocalSession(title)
  const res = await authFetch(`${getBase()}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? null }),
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

export async function getSessionMessages(id: string): Promise<Message[]> {
  if (isNativeIOSRuntime()) return getIOSLocalMessages(id)
  const res = await authFetch(`${getBase()}/sessions/${id}/messages`)
  if (!res.ok) throw new Error(`getSessionMessages: ${res.status}`)
  return res.json()
}

// ── Knowledge Sources ──────────────────────────────────────────────────────

export async function getSessionKnowledge(id: string): Promise<KnowledgeSource[]> {
  if (isNativeIOSRuntime()) {
    void id
    return []
  }
  const res = await authFetch(`${getBase()}/sessions/${id}/knowledge`)
  if (!res.ok) throw new Error(`getSessionKnowledge: ${res.status}`)
  return res.json()
}

export async function importKnowledge(
  sessionId: string,
  payload: { file?: File; text?: string; url?: string; query?: string; title?: string },
): Promise<KnowledgeSource> {
  if (isNativeIOSRuntime()) {
    if (payload.file) {
      throw new Error('PDFs continuam sendo indexados pelo Buds no Mac; no iPhone você pode salvar textos diretamente na memória.')
    }
    const content = (payload.text || payload.url || payload.query || '').trim()
    if (!content) throw new Error('Digite o conteúdo que deseja salvar na memória.')
    const memory = await createIOSLocalMemory(content, 0.76)
    return {
      id: memory.id,
      session_id: sessionId,
      title: payload.title || content.slice(0, 72),
      source_type: payload.url ? 'url' : 'texto',
      source_name: 'Memória local do iPhone',
      summary: content,
      content,
      topics: memory.tags,
      metadata: { origin: 'iphone_local_memory' },
      created_at: memory.created_at,
    }
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
    if (payload.audio) throw new Error('A transcrição de áudio local será adicionada depois do motor 7B.')
    return streamIOSLocalChat(payload, onEvent, signal)
  }
  const attempts = isDesktop() ? 3 : 2
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
