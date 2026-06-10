// ─── API Service Layer ───────────────────────────────────────────────────────
// All calls go through the Vite proxy → http://127.0.0.1:5050

import type {
  Session,
  Message,
  BackendConfig,
  ChatStreamEvent,
  CognitiveMemory,
  KnowledgeGraph,
  KnowledgeSource,
  SyncRunResult,
  SyncStatus,
} from '../types'

const desktopApiBase = (window as unknown as { nexus?: { apiBase?: string } }).nexus?.apiBase
const BASE = desktopApiBase || import.meta.env.VITE_API_BASE_URL || '/api'
const IS_DESKTOP = Boolean((window as unknown as { nexus?: { isDesktop?: boolean } }).nexus?.isDesktop)

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function fetchJsonWithStartupRetry<T>(url: string, attempts = IS_DESKTOP ? 16 : 1): Promise<T> {
  let lastError: unknown

  for (let index = 0; index < attempts; index += 1) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url}: ${res.status}`)
      return res.json()
    } catch (err) {
      lastError = err
      if (index < attempts - 1) await wait(450)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Falha ao acessar ${url}`)
}

// ── Backend Config ─────────────────────────────────────────────────────────

export async function getBackendConfig(): Promise<BackendConfig> {
  return fetchJsonWithStartupRetry<BackendConfig>(`${BASE}/config`)
}

// ── Local-first Sync ────────────────────────────────────────────────────────

export async function getSyncStatus(): Promise<SyncStatus> {
  return fetchJsonWithStartupRetry<SyncStatus>(`${BASE}/sync/status`)
}

export async function runSync(): Promise<SyncRunResult> {
  const res = await fetch(`${BASE}/sync/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || `runSync: ${res.status}`)
  return data
}

// ── Cognitive Brain / Obsidian ─────────────────────────────────────────────

export async function getCognitiveMemories(limit = 200): Promise<CognitiveMemory[]> {
  return fetchJsonWithStartupRetry<CognitiveMemory[]>(`${BASE}/cognitive/memory?limit=${limit}`)
}

export async function getKnowledgeGraph(limit = 240): Promise<KnowledgeGraph> {
  return fetchJsonWithStartupRetry<KnowledgeGraph>(`${BASE}/cognitive/graph?limit=${limit}`)
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<Session[]> {
  return fetchJsonWithStartupRetry<Session[]>(`${BASE}/sessions`)
}

export async function createSession(title?: string): Promise<Session> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? null }),
  })
  if (!res.ok) throw new Error(`createSession: ${res.status}`)
  return res.json()
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteSession: ${res.status}`)
}

export async function updateSessionTitle(id: string, title: string): Promise<Session> {
  const res = await fetch(`${BASE}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`updateSessionTitle: ${res.status}`)
  return res.json()
}

export async function getSessionMessages(id: string): Promise<Message[]> {
  const res = await fetch(`${BASE}/sessions/${id}/messages`)
  if (!res.ok) throw new Error(`getSessionMessages: ${res.status}`)
  return res.json()
}

// ── Knowledge Sources ──────────────────────────────────────────────────────

export async function getSessionKnowledge(id: string): Promise<KnowledgeSource[]> {
  const res = await fetch(`${BASE}/sessions/${id}/knowledge`)
  if (!res.ok) throw new Error(`getSessionKnowledge: ${res.status}`)
  return res.json()
}

export async function importKnowledge(
  sessionId: string,
  payload: { file?: File; text?: string; url?: string; query?: string; title?: string },
): Promise<KnowledgeSource> {
  let response: Response

  if (payload.file) {
    const body = new FormData()
    body.append('file', payload.file)
    if (payload.title) body.append('title', payload.title)
    response = await fetch(`${BASE}/sessions/${sessionId}/knowledge`, {
      method: 'POST',
      body,
    })
  } else {
    response = await fetch(`${BASE}/sessions/${sessionId}/knowledge`, {
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
  payload: { text?: string; audio?: Blob; sessionId?: string; model?: string; webSearch?: boolean },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const attempts = IS_DESKTOP ? 3 : 2
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let body: FormData | null = null
    let receivedAnyEvent = false

    if (payload.audio) {
      body = new FormData()
      body.append('audio', payload.audio, 'recording.webm')
      if (payload.sessionId) body.append('session_id', payload.sessionId)
      if (payload.model) body.append('model', payload.model)
      if (payload.webSearch) body.append('web_search', 'true')
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
          }),
          signal,
        }

    try {
      const response = await fetch(`${BASE}/chat/stream`, fetchOptions)
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

  throw lastError instanceof Error ? lastError : new Error('Falha ao conectar com o chat.')
}

// ── Audio URL ───────────────────────────────────────────────────────────────

export function getAudioUrl(filename: string): string {
  return `/api/audio/${filename}`
}
