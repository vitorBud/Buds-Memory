// ─── API Service Layer ───────────────────────────────────────────────────────
// All calls go through the Vite proxy → http://127.0.0.1:5050 (web)
// or directly to http://127.0.0.1:5050/api (Electron desktop).

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

type NexusBridge = { apiBase?: string; isDesktop?: boolean }

/**
 * Resolve a URL base de forma lazy (em tempo de execução) para garantir que o
 * preload do Electron já injetou window.nexus antes da primeira chamada de API.
 */
export function getBase(): string {
  const bridge = (window as unknown as { nexus?: NexusBridge }).nexus
  return bridge?.apiBase || import.meta.env.VITE_API_BASE_URL || '/api'
}

function isDesktop(): boolean {
  return Boolean((window as unknown as { nexus?: NexusBridge }).nexus?.isDesktop)
}

/**
 * Converte um caminho relativo de API (/api/audio/...) em URL absoluta.
 * Necessário para funcionar tanto no browser (proxy Vite) quanto no Electron (file://).
 */
export function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path
  const base = getBase().replace(/\/api$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
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
      'Não foi possível conectar ao servidor local. Verifique se o backend Flask está rodando na porta 5050 (execute start_backend.sh).',
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function fetchJsonWithStartupRetry<T>(url: string, attempts = isDesktop() ? 16 : 1): Promise<T> {
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

  throw humanizeError(lastError) ?? new Error(`Falha ao acessar ${url}`)
}

// ── Backend Config ─────────────────────────────────────────────────────────

export async function getBackendConfig(): Promise<BackendConfig> {
  return fetchJsonWithStartupRetry<BackendConfig>(`${getBase()}/config`)
}

// ── Local-first Sync ────────────────────────────────────────────────────────

export async function getSyncStatus(): Promise<SyncStatus> {
  return fetchJsonWithStartupRetry<SyncStatus>(`${getBase()}/sync/status`)
}

export async function runSync(): Promise<SyncRunResult> {
  let res: Response
  try {
    res = await fetch(`${getBase()}/sync/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  } catch (err) {
    throw humanizeError(err)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || `runSync: ${res.status}`)
  return data
}

// ── Cognitive Brain / Obsidian ─────────────────────────────────────────────

export async function getCognitiveMemories(limit = 200): Promise<CognitiveMemory[]> {
  return fetchJsonWithStartupRetry<CognitiveMemory[]>(`${getBase()}/cognitive/memory?limit=${limit}`)
}

export async function getKnowledgeGraph(limit = 240): Promise<KnowledgeGraph> {
  return fetchJsonWithStartupRetry<KnowledgeGraph>(`${getBase()}/cognitive/graph?limit=${limit}`)
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<Session[]> {
  return fetchJsonWithStartupRetry<Session[]>(`${getBase()}/sessions`)
}

export async function createSession(title?: string): Promise<Session> {
  const res = await fetch(`${getBase()}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? null }),
  })
  if (!res.ok) throw new Error(`createSession: ${res.status}`)
  return res.json()
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${getBase()}/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteSession: ${res.status}`)
}

export async function updateSessionTitle(id: string, title: string): Promise<Session> {
  const res = await fetch(`${getBase()}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`updateSessionTitle: ${res.status}`)
  return res.json()
}

export async function getSessionMessages(id: string): Promise<Message[]> {
  const res = await fetch(`${getBase()}/sessions/${id}/messages`)
  if (!res.ok) throw new Error(`getSessionMessages: ${res.status}`)
  return res.json()
}

// ── Knowledge Sources ──────────────────────────────────────────────────────

export async function getSessionKnowledge(id: string): Promise<KnowledgeSource[]> {
  const res = await fetch(`${getBase()}/sessions/${id}/knowledge`)
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
    response = await fetch(`${getBase()}/sessions/${sessionId}/knowledge`, {
      method: 'POST',
      body,
    })
  } else {
    response = await fetch(`${getBase()}/sessions/${sessionId}/knowledge`, {
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
  const attempts = isDesktop() ? 3 : 2
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
      const response = await fetch(`${getBase()}/chat/stream`, fetchOptions)
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

// ── Audio URL ───────────────────────────────────────────────────────────────

/** Retorna a URL absoluta para um arquivo de áudio gerado pelo backend. */
export function getAudioUrl(filename: string): string {
  return resolveUrl(`/api/audio/${filename}`)
}
