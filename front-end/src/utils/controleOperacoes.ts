export type VoiceEndpointState = 'waiting' | 'speech-candidate' | 'speaking' | 'possible-pause' | 'complete'

export interface VoiceEndpointConfig {
  speechThreshold: number
  activationMs?: number
  minimumSpeechMs?: number
  silenceMs: number
}

export function createOperationId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}

export class AsyncOperationGate {
  private activeId: string | null = null

  begin(prefix: string) {
    this.activeId = createOperationId(prefix)
    return this.activeId
  }

  isActive(id: string | null | undefined) {
    return Boolean(id && this.activeId === id)
  }

  complete(id: string) {
    if (this.activeId === id) this.activeId = null
  }

  cancel() {
    this.activeId = null
  }

  get current() {
    return this.activeId
  }
}

export class RecordingChunkBuffer {
  private chunks: Blob[] = []
  readonly recordingId: string

  constructor(recordingId: string) {
    this.recordingId = recordingId
  }

  append(recordingId: string, chunk: Blob) {
    if (recordingId !== this.recordingId || chunk.size === 0) return false
    this.chunks.push(chunk)
    return true
  }

  finalize(recordingId: string, mimeType: string) {
    if (recordingId !== this.recordingId) return null
    const blob = new Blob(this.chunks, { type: mimeType })
    this.chunks = []
    return blob
  }

  get chunkCount() {
    return this.chunks.length
  }
}

/**
 * Detector determinístico de início/fim de fala.
 *
 * Um pico isolado nunca ativa a fala. Depois que a fala foi confirmada, uma
 * pausa vira `possible-pause`; só vira `complete` após silêncio contínuo e
 * duração mínima real de fala. Atualizações do reconhecedor contam como
 * evidência forte e preservam frases com pausas naturais.
 */
export class VoiceEndpointDetector {
  readonly config: Required<VoiceEndpointConfig>
  state: VoiceEndpointState = 'waiting'
  private candidateSince: number | null = null
  private speechStartedAt: number | null = null
  private lastSpeechEvidenceAt: number | null = null
  private lastTranscript = ''

  constructor(config: VoiceEndpointConfig) {
    this.config = {
      speechThreshold: config.speechThreshold,
      activationMs: config.activationMs ?? 160,
      minimumSpeechMs: config.minimumSpeechMs ?? 320,
      silenceMs: config.silenceMs,
    }
  }

  observeVolume(volume: number, now: number) {
    if (this.state === 'complete') return
    if (volume >= this.config.speechThreshold) {
      if (this.state === 'waiting') {
        this.state = 'speech-candidate'
        this.candidateSince = now
      } else if (this.state === 'speech-candidate') {
        if (this.candidateSince !== null && now - this.candidateSince >= this.config.activationMs) {
          this.confirmSpeech(now)
        }
      } else {
        this.state = 'speaking'
        this.lastSpeechEvidenceAt = now
      }
      return
    }

    if (this.state === 'speech-candidate') {
      this.state = 'waiting'
      this.candidateSince = null
    } else if (this.state === 'speaking') {
      this.state = 'possible-pause'
    }
    this.tick(now)
  }

  observeTranscript(transcript: string, now: number) {
    const clean = transcript.trim()
    if (!clean || clean === this.lastTranscript || this.state === 'complete') return false
    this.lastTranscript = clean
    this.confirmSpeech(now)
    return true
  }

  tick(now: number) {
    if (this.state !== 'possible-pause' || this.speechStartedAt === null || this.lastSpeechEvidenceAt === null) {
      return false
    }
    const enoughSpeech = now - this.speechStartedAt >= this.config.minimumSpeechMs
    const enoughSilence = now - this.lastSpeechEvidenceAt >= this.config.silenceMs
    if (enoughSpeech && enoughSilence) {
      this.state = 'complete'
      return true
    }
    return false
  }

  get hasConfirmedSpeech() {
    return this.speechStartedAt !== null
  }

  private confirmSpeech(now: number) {
    this.speechStartedAt ??= this.candidateSince ?? now
    this.lastSpeechEvidenceAt = now
    this.candidateSince = null
    this.state = 'speaking'
  }
}
