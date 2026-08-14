export type VoiceEndpointState = 'waiting' | 'speech-candidate' | 'speaking' | 'possible-pause' | 'complete'
export type VoiceRecordingMode = 'turn' | 'barge-in'

export interface VoiceCaptureMetrics {
  recordingId: string
  mode: VoiceRecordingMode
  captureStartedAt: number
  speechStartedAt?: number
  speechEndedAt?: number
  sttFirstPartialAt?: number
  sttFinalAt?: number
}

export type VoiceMetricEvent =
  | 'speech_start'
  | 'speech_end'
  | 'stt_first_partial'
  | 'stt_final'
  | 'llm_start'
  | 'llm_first_token'
  | 'tts_first_chunk'
  | 'audio_start'
  | 'response_end'

export class VoiceTurnTelemetry {
  readonly turnId: string
  readonly platform: string
  private marks = new Map<VoiceMetricEvent, number>()

  constructor(platform: string, capture?: VoiceCaptureMetrics) {
    this.turnId = capture?.recordingId ?? createOperationId('voice-turn')
    this.platform = platform
    if (capture?.speechStartedAt) this.marks.set('speech_start', capture.speechStartedAt)
    if (capture?.speechEndedAt) this.marks.set('speech_end', capture.speechEndedAt)
    if (capture?.sttFirstPartialAt) this.marks.set('stt_first_partial', capture.sttFirstPartialAt)
    if (capture?.sttFinalAt) this.marks.set('stt_final', capture.sttFinalAt)
  }

  mark(event: VoiceMetricEvent, at = performance.now()) {
    if (!this.marks.has(event)) this.marks.set(event, at)
    return this.snapshot()
  }

  snapshot() {
    const value = (event: VoiceMetricEvent) => this.marks.get(event)
    const between = (start: VoiceMetricEvent, end: VoiceMetricEvent) => {
      const a = value(start)
      const b = value(end)
      return a !== undefined && b !== undefined ? Math.max(0, Math.round(b - a)) : undefined
    }
    return {
      turn_id: this.turnId,
      platform: this.platform,
      events: Object.fromEntries(this.marks),
      speech_to_text_latency_ms: between('speech_end', 'stt_final'),
      ttft_ms: between('llm_start', 'llm_first_token'),
      time_to_first_audio_ms: between('speech_end', 'audio_start'),
      llm_to_first_audio_ms: between('llm_start', 'audio_start'),
      total_turn_time_ms: between('speech_start', 'response_end'),
    }
  }
}

/**
 * Separa texto incremental em blocos pronunciáveis. Pontuação encerra o bloco
 * normalmente; respostas sem pontuação ganham um corte seguro em pausa ou
 * espaço para o TTS não esperar o término completo do modelo.
 */
export function extractSpeakableChunks(
  buffer: string,
  maxCharacters = 150,
  minimumFallbackCharacters = 72,
) {
  const chunks: string[] = []
  let rest = buffer

  while (rest.length > 0) {
    const sentence = rest.match(/^([\s\S]*?[.!?]+)(?=\s|$)/)
    if (sentence) {
      const clean = sentence[1].trim()
      if (clean.length > 2) chunks.push(clean)
      rest = rest.slice(sentence[0].length).trimStart()
      continue
    }

    if (rest.length < maxCharacters) break
    const window = rest.slice(0, maxCharacters + 1)
    const punctuationFloor = Math.min(minimumFallbackCharacters, window.length - 1)
    let splitAt = -1
    for (const separator of [',', ';', ':', '\n']) {
      const candidate = window.lastIndexOf(separator)
      if (candidate >= punctuationFloor) splitAt = Math.max(splitAt, candidate + 1)
    }
    if (splitAt < punctuationFloor) {
      const whitespace = window.lastIndexOf(' ')
      splitAt = whitespace >= punctuationFloor ? whitespace : maxCharacters
    }
    const clean = rest.slice(0, splitAt).trim()
    if (clean) chunks.push(clean)
    rest = rest.slice(splitAt).trimStart()
  }

  return { chunks, rest }
}

export interface VoiceEndpointConfig {
  speechThreshold: number
  activationMs?: number
  minimumSpeechMs?: number
  silenceMs: number
}

/**
 * Aprende o piso de eco/ruído nos primeiros instantes da fala do Buds e exige
 * que a interrupção fique claramente acima dele. Não tenta interpretar áudio;
 * apenas protege o VAD contra caixa de som, ventilador e ruído constante.
 */
export class AdaptiveBargeInGate {
  private baselineSamples: number[] = []
  private readonly minimumThreshold: number
  private readonly maximumThreshold: number

  constructor(
    minimumThreshold = 0.22,
    maximumThreshold = 0.48,
  ) {
    this.minimumThreshold = minimumThreshold
    this.maximumThreshold = maximumThreshold
  }

  calibrate(volume: number) {
    this.baselineSamples.push(Math.max(0, Math.min(1, volume)))
    if (this.baselineSamples.length > 80) this.baselineSamples.shift()
  }

  get threshold() {
    if (!this.baselineSamples.length) return this.minimumThreshold
    const sorted = [...this.baselineSamples].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.8))
    const noiseFloor = sorted[index]
    return Math.min(this.maximumThreshold, Math.max(this.minimumThreshold, noiseFloor * 1.55 + 0.04))
  }

  accepts(volume: number) {
    return volume >= this.threshold
  }
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

  snapshot(recordingId: string, mimeType: string) {
    if (recordingId !== this.recordingId || this.chunks.length === 0) return null
    return new Blob(this.chunks, { type: mimeType })
  }

  retainLast(recordingId: string, count: number) {
    if (recordingId !== this.recordingId) return false
    this.chunks = this.chunks.slice(-Math.max(0, count))
    return true
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

/**
 * No reconhecimento nativo do iOS, alterações reais da transcrição são uma
 * evidência de fala mais confiável que o volume: ventilador, TV ou trânsito
 * podem manter o medidor alto mesmo depois que o usuário terminou a frase.
 */
export class TranscriptSilenceGate {
  private lastTranscript = ''
  private lastChangeAt: number | null = null

  observe(transcript: string, now: number) {
    const clean = transcript.trim()
    if (!clean || clean === this.lastTranscript) return false
    this.lastTranscript = clean
    this.lastChangeAt = now
    return true
  }

  shouldFinalize(now: number, silenceMs: number) {
    return this.lastChangeAt !== null
      && this.lastTranscript.length > 0
      && now - this.lastChangeAt >= silenceMs
  }
}
