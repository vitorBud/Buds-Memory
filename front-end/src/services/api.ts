// ─── API Service Layer ───────────────────────────────────────────────────────
// All calls go through the Vite proxy → http://localhost:5000

import type { Session, Message } from '../types'

const BASE = '/api'

// ── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/sessions`)
  if (!res.ok) throw new Error(`getSessions: ${res.status}`)
  return res.json()
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

export async function getSessionMessages(id: string): Promise<Message[]> {
  const res = await fetch(`${BASE}/sessions/${id}/messages`)
  if (!res.ok) throw new Error(`getSessionMessages: ${res.status}`)
  return res.json()
}

// ── Chat Streaming (SSE via ReadableStream) ─────────────────────────────────

export async function streamChat(
  payload: { text?: string; audio?: Blob; sessionId?: string },
  onEvent: (event: { type: string; content?: string; text?: string; url?: string }) => void,
): Promise<void> {
  let body: FormData | null = null

  if (payload.audio) {
    body = new FormData()
    body.append('audio', payload.audio, 'recording.webm')
    if (payload.sessionId) body.append('session_id', payload.sessionId)
  }

  const fetchOptions: RequestInit = payload.audio
    ? { method: 'POST', body }
    : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: payload.text, session_id: payload.sessionId }),
      }

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
        onEvent(event)
      } catch { /* ignore parse errors */ }
    }
  }
}

// ── Audio URL ───────────────────────────────────────────────────────────────

export function getAudioUrl(filename: string): string {
  return `/api/audio/${filename}`
}
