import { useState, useRef, useCallback, useEffect } from 'react'
import { isNativeIOSRuntime, refreshLocationContext, streamChat } from '../services/api'
import type { Message, AiState, Session, ChatStreamEvent, VoiceProvider } from '../types'
import {
  enqueueIOSNeuralSpeech,
  isIOSNeuralVoiceRuntime,
  isIOSRuntime,
  isWindowsRuntime,
  listenIOSNeuralSpeechState,
  stopIOSNeuralSpeech,
} from '../plataformas'
import { createOperationId, extractSpeakableChunks, VoiceTurnTelemetry } from '../utils/controleOperacoes'
import type { VoiceCaptureMetrics } from '../utils/controleOperacoes'
import { stripInternalReasoning } from '../utils/respostaVisivel'

interface UseChatOptions {
  sessionId: string | null
  selectedModel: string
  webSearchEnabled: boolean
  selectedVoiceURI?: string
  voiceProvider?: VoiceProvider
  onNeedSession: () => Promise<string>
  onStateChange: (s: AiState) => void
  onLatency: (ms: number) => void
  onMsgCountChange: (n: number) => void
  onSessionUpdate?: (session: Session) => void
  onResponseComplete?: (sessionId: string) => void
  autoPlayAudio?: boolean
  offlineQueueEnabled?: boolean
}

const OFFLINE_QUEUE_KEY = 'buds-offline-message-queue-v1'
const MALE_PT_VOICE_HINTS = [
  'felipe',
  'daniel',
  'joao',
  'joão',
  'lucas',
  'bruno',
  'thiago',
  'male',
  'masculino',
]
const ROBOTIC_VOICE_HINTS = ['compact', 'eloquence', 'novelty']
const NATURAL_PT_VOICE_HINTS = ['felipe', 'luciana', 'helena', 'premium', 'enhanced', 'aprimorada', 'siri']

function normalizeVoiceText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  const lang = normalizeVoiceText(voice.lang || '')
  const name = normalizeVoiceText(voice.name || '')
  let score = 0

  if (lang === 'pt-br') score += 90
  else if (lang.startsWith('pt')) score += 60
  if (MALE_PT_VOICE_HINTS.some(hint => name.includes(normalizeVoiceText(hint)))) score += 35
  if (NATURAL_PT_VOICE_HINTS.some(hint => name.includes(normalizeVoiceText(hint)))) score += 55
  if (name.includes('premium')) score += 60
  if (name.includes('enhanced') || name.includes('aprimorada')) score += 40
  if (ROBOTIC_VOICE_HINTS.some(hint => name.includes(hint))) score -= 25

  return score
}

function pickPreferredVoice(selectedVoiceURI?: string) {
  if (!('speechSynthesis' in window)) return null

  const voices = window.speechSynthesis.getVoices()
  const selectedVoice = voices.find(voice => voice.voiceURI === selectedVoiceURI)
  if (selectedVoice) return selectedVoice

  return voices
    .filter(voice => normalizeVoiceText(voice.lang || '').startsWith('pt'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? voices[0] ?? null
}

function canUseBrowserVoice(voiceProvider: VoiceProvider) {
  return voiceProvider === 'browser' && 'speechSynthesis' in window
}

function getOfflineQueue(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function setOfflineQueue(queue: string[]) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-30)))
  } catch { /* storage unavailable */ }
}

function queueOfflineText(text: string) {
  const clean = text.trim()
  if (!clean) return
  const queue = getOfflineQueue()
  queue.push(clean)
  setOfflineQueue(queue)
}

function asksExactLocation(text: string) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /\b(onde estou|onde exatamente estou|localizacao exata|minha localizacao|localizacao atual|coordenadas?|latitude|longitude|em que lugar (?:estou|eu estou))\b/.test(normalized)
}

// Hook central do chat: envia texto/áudio, controla streaming, voz e interrupção da resposta.
export function useChat({
  sessionId,
  selectedModel,
  webSearchEnabled,
  selectedVoiceURI,
  voiceProvider = 'browser',
  onNeedSession,
  onStateChange,
  onLatency,
  onMsgCountChange,
  onSessionUpdate,
  onResponseComplete,
  autoPlayAudio = false,
  offlineQueueEnabled = true,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isOutputActive, setIsOutputActive] = useState(false)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef  = useRef(false)
  const speechQueueRef = useRef<string[]>([])
  const isSpeechPlayingRef = useRef(false)
  const isNativeSpeechPlayingRef = useRef(false)
  const nativeVoiceFailedRef = useRef(false)
  const nativeSpeechPendingRef = useRef<string[]>([])
  const speechFallbackRef = useRef<(text: string) => void>(() => undefined)
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeAbortRef = useRef<AbortController | null>(null)
  const activeOperationRef = useRef<{ id: string; sessionId: string; controller: AbortController } | null>(null)
  const processingRef = useRef(false)
  const outputEpochRef = useRef(0)
  const msgCountRef = useRef(0)
  const streamIdRef = useRef(-1)
  const pendingTokensRef = useRef<Map<number, string>>(new Map())
  const tokenFlushTimerRef = useRef<number | null>(null)
  const flushingOfflineRef = useRef(false)
  const spokenLengthRef = useRef(0)
  const voiceTelemetryRef = useRef<VoiceTurnTelemetry | null>(null)
  const voiceResponseCompletedRef = useRef(false)

  const voicePlatform = isNativeIOSRuntime()
    ? 'iphone-native'
    : isWindowsRuntime()
      ? 'windows-web'
      : 'mac-web'

  function markVoice(event: Parameters<VoiceTurnTelemetry['mark']>[0]) {
    const snapshot = voiceTelemetryRef.current?.mark(event)
    if (snapshot && event === 'audio_start') {
      console.info('[BudsVoicePerf]', { ...snapshot, event })
    }
    return snapshot
  }

  function finishVoiceMetrics(reason: 'complete' | 'interrupted' | 'error') {
    const telemetry = voiceTelemetryRef.current
    if (!telemetry) return
    const snapshot = telemetry.mark('response_end')
    console.info('[BudsVoicePerf]', { ...snapshot, reason })
    voiceResponseCompletedRef.current = reason === 'complete'
    if (reason !== 'complete') voiceTelemetryRef.current = null
  }

  useEffect(() => {
    if (!('speechSynthesis' in window)) return

    const refreshVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      setAvailableVoices(voices)
      preferredVoiceRef.current = pickPreferredVoice(selectedVoiceURI)
    }

    refreshVoice()
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoice)

    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoice)
    }
  }, [selectedVoiceURI])

  function playNextSpeech(epoch = outputEpochRef.current) {
    if (!('speechSynthesis' in window)) return
    if (epoch !== outputEpochRef.current) return

    if (speechQueueRef.current.length === 0) {
      isSpeechPlayingRef.current = false
      setIsOutputActive(false)
      if (!processingRef.current) onStateChange('idle')
      if (!processingRef.current && voiceResponseCompletedRef.current) voiceTelemetryRef.current = null
      return
    }

    const cleanText = speechQueueRef.current.shift()!
    const utterance = new SpeechSynthesisUtterance(cleanText)
    const voice = preferredVoiceRef.current ?? pickPreferredVoice(selectedVoiceURI)
    preferredVoiceRef.current = voice

    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || 'pt-BR'
    utterance.rate = 0.98
    utterance.pitch = 1
    utterance.volume = 1
    let ttsStartedAt = 0
    isSpeechPlayingRef.current = true
    setIsOutputActive(true)
    onStateChange('speaking')
    utterance.onstart = () => {
      ttsStartedAt = performance.now()
      markVoice('audio_start')
    }
    utterance.onend = () => {
      console.info('[BudsPerf]', {
        stage: 'tts', provider: 'browser', characters: cleanText.length,
        tts_ms: Math.round(performance.now() - (ttsStartedAt || performance.now())),
      })
      playNextSpeech(epoch)
    }
    utterance.onerror = () => playNextSpeech(epoch)
    window.speechSynthesis.speak(utterance)
  }

  function queueSpeech(text: string) {
    const cleanText = text.trim()
    if (!cleanText || !('speechSynthesis' in window)) return

    markVoice('tts_first_chunk')
    speechQueueRef.current.push(cleanText.replace(/\s+/g, ' '))
    if (!isSpeechPlayingRef.current) playNextSpeech(outputEpochRef.current)
  }
  speechFallbackRef.current = queueSpeech

  function queueStreamingSpeech(text: string, useNativeVoice: boolean) {
    const cleanText = text.trim().replace(/\s+/g, ' ')
    if (!cleanText) return
    if (useNativeVoice && !nativeVoiceFailedRef.current) {
      markVoice('tts_first_chunk')
      nativeSpeechPendingRef.current.push(cleanText)
      // Reserva imediatamente a saída nativa. O Kokoro ainda pode estar
      // sintetizando o primeiro PCM; sem esta marca o modo contínuo reabria o
      // microfone e o AVAudioSession de gravação derrubava o player (`!pri`).
      isNativeSpeechPlayingRef.current = true
      setIsOutputActive(true)
      onStateChange('speaking')
      void enqueueIOSNeuralSpeech(cleanText).catch((error) => {
        console.error('[Buds Voice] Falha na voz neural:', error)
        nativeVoiceFailedRef.current = true
        const fallbackText = nativeSpeechPendingRef.current.join(' ')
        nativeSpeechPendingRef.current = []
        isNativeSpeechPlayingRef.current = false
        if (fallbackText) speechFallbackRef.current(fallbackText)
        else if (processingRef.current) onStateChange('thinking')
      })
      return
    }
    queueSpeech(cleanText)
  }

  function speakText(text: string) {
    if (!text.trim() || !('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    speechQueueRef.current = []
    isSpeechPlayingRef.current = false
    queueSpeech(text)
  }

  // ── Audio Queue ────────────────────────────────────────────────────────────
  function playNextAudio(epoch = outputEpochRef.current) {
    if (epoch !== outputEpochRef.current) return
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      setIsOutputActive(false)
      if (!processingRef.current) onStateChange('idle')
      if (!processingRef.current && voiceResponseCompletedRef.current) voiceTelemetryRef.current = null
      return
    }
    isPlayingRef.current = true
    setIsOutputActive(true)
    const url = audioQueueRef.current.shift()!
    onStateChange('speaking')
    const audio = new Audio(url)
    let audioStartedAt = 0
    currentAudioRef.current = audio
    audio.onplaying = () => {
      audioStartedAt = performance.now()
      markVoice('audio_start')
    }
    audio.play().catch(() => playNextAudio(epoch))
    audio.onended = () => {
      console.info('[BudsPerf]', {
        stage: 'tts', provider: 'piper', tts_ms: Math.round(performance.now() - (audioStartedAt || performance.now())),
      })
      currentAudioRef.current = null
      playNextAudio(epoch)
    }
  }

  function queueAudio(url: string) {
    markVoice('tts_first_chunk')
    audioQueueRef.current.push(url)
    if (!isPlayingRef.current) playNextAudio(outputEpochRef.current)
  }

  const stopOutput = useCallback(() => {
    if (voiceResponseCompletedRef.current) voiceTelemetryRef.current = null
    else finishVoiceMetrics('interrupted')
    voiceResponseCompletedRef.current = false
    outputEpochRef.current += 1
    activeAbortRef.current?.abort()
    activeAbortRef.current = null
    activeOperationRef.current = null
    processingRef.current = false
    pendingTokensRef.current = new Map()
    if (tokenFlushTimerRef.current !== null) {
      window.clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    audioQueueRef.current = []
    speechQueueRef.current = []
    currentAudioRef.current?.pause()
    currentAudioRef.current = null
    isPlayingRef.current = false
    isSpeechPlayingRef.current = false
    isNativeSpeechPlayingRef.current = false
    nativeVoiceFailedRef.current = false
    nativeSpeechPendingRef.current = []
    setIsOutputActive(false)
    window.speechSynthesis?.cancel()
    if (isIOSNeuralVoiceRuntime()) {
      // Interrompe imediatamente, mas preserva o engine para o próximo turno e
      // para o microfone de barge-in não perder a AVAudioSession compartilhada.
      void stopIOSNeuralSpeech(false).catch(error => console.error('[Buds Voice] Falha ao interromper voz:', error))
    }
    setMessages(prev => prev
      .map(msg => msg.streaming ? { ...msg, streaming: false } : msg)
      .filter(msg => msg.text !== '__thinking__'))
    setIsProcessing(false)
    onStateChange('idle')
  }, [onStateChange])

  useEffect(() => {
    if (!autoPlayAudio || !isIOSNeuralVoiceRuntime()) return
    let disposed = false
    let handle: Awaited<ReturnType<typeof listenIOSNeuralSpeechState>> | undefined

    void listenIOSNeuralSpeechState((event) => {
      if (disposed) return
      if (event.state === 'speaking') {
        nativeSpeechPendingRef.current = []
        isNativeSpeechPlayingRef.current = true
        setIsOutputActive(true)
        markVoice('audio_start')
        onStateChange('speaking')
      } else if (event.state === 'idle') {
        isNativeSpeechPlayingRef.current = false
        setIsOutputActive(false)
        if (!processingRef.current) onStateChange('idle')
        if (!processingRef.current && voiceResponseCompletedRef.current) voiceTelemetryRef.current = null
      } else {
        nativeVoiceFailedRef.current = true
        const fallbackText = nativeSpeechPendingRef.current.join(' ')
        nativeSpeechPendingRef.current = []
        isNativeSpeechPlayingRef.current = false
        setIsOutputActive(false)
        console.error('[Buds Voice]', event.message || 'Falha na voz neural local.')
        if (fallbackText) speechFallbackRef.current(fallbackText)
        else if (processingRef.current) onStateChange('thinking')
        else onStateChange('idle')
      }
    }).then(listenerHandle => {
      if (disposed) void listenerHandle.remove()
      else handle = listenerHandle
    }).catch(error => console.error('[Buds Voice] Listener indisponível:', error))

    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [autoPlayAudio, onStateChange])

  // ── Append message helpers ─────────────────────────────────────────────────
  function addMessage(msg: Message) {
    setMessages(prev => [...prev, msg])
    msgCountRef.current += 1
    onMsgCountChange(msgCountRef.current)
  }

  function drainStreamingTokens() {
    const pending = pendingTokensRef.current
    if (!pending.size) return

    pendingTokensRef.current = new Map()
    setMessages(prev => {
      let next = prev

      pending.forEach((token, messageId) => {
        const existing = next.find(msg => msg.id === messageId)
        if (!existing) {
          const visibleToken = stripInternalReasoning(token, true)
          next = [...next, {
            id: messageId,
            sender: 'ia',
            text: visibleToken || '__thinking__',
            rawText: token,
            streaming: true,
            created_at: new Date().toISOString(),
          }]
          return
        }

        next = next.map(msg => {
          if (msg.id !== messageId) return msg
          const raw = msg.rawText === undefined ? (msg.text === '__thinking__' ? '' : msg.text) : msg.rawText
          const newRaw = raw + token
          const clean = stripInternalReasoning(newRaw, true)
          return { ...msg, text: clean || '__thinking__', streaming: true, rawText: newRaw }
        })
      })

      return next
    })
  }

  function flushStreamingTokens() {
    if (tokenFlushTimerRef.current !== null) {
      window.clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    drainStreamingTokens()
  }

  function createAssistantPlaceholder() {
    const id = streamIdRef.current
    streamIdRef.current -= 1
    const msg: Message = {
      id,
      sender: 'ia',
      text: '__thinking__',
      streaming: true,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, msg])
    return id
  }

  function appendStreamingToken(messageId: number, token: string) {
    pendingTokensRef.current.set(
      messageId,
      (pendingTokensRef.current.get(messageId) ?? '') + token,
    )

    if (tokenFlushTimerRef.current === null) {
      tokenFlushTimerRef.current = window.setTimeout(() => {
        tokenFlushTimerRef.current = null
        drainStreamingTokens()
      }, 45)
    }
  }

  function replaceStreamingText(messageId: number, text: string) {
    flushStreamingTokens()
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        const clean = stripInternalReasoning(text, true).trim()
        return { ...msg, text: clean || '__thinking__', streaming: true, rawText: text }
      }
      return msg
    }))
  }

  function appendWebSearchStatus(messageId: number, event: ChatStreamEvent) {
    const found = event.results?.length ?? 0
    const status = found > 0
      ? `Google: ${found} fonte${found > 1 ? 's' : ''} encontrada${found > 1 ? 's' : ''} em tempo real.\n\n`
      : `Google: ${event.content || 'busca sem resultados.'}\n\n`
    appendStreamingToken(messageId, status)
  }

  function finalizeStreaming(messageId: number) {
    flushStreamingTokens()
    setMessages(prev => {
      let finalized = false
      const next = prev.map(msg => {
        if (msg.id !== messageId || !msg.streaming) return msg
        finalized = true
        const raw = msg.rawText ?? msg.text
        const clean = stripInternalReasoning(raw).trim()
        return {
          ...msg,
          text: clean === '__thinking__' ? '' : clean,
          streaming: false,
          rawText: undefined,
        }
      }).filter(msg => msg.text || msg.id !== messageId)

      if (finalized) {
        msgCountRef.current += 1
        onMsgCountChange(msgCountRef.current)
      }

      return next
    })
  }

  // ── Send text ──────────────────────────────────────────────────────────────
  async function sendText(text: string, captureMetrics?: VoiceCaptureMetrics) {
    if (!text.trim() || processingRef.current) return
    nativeVoiceFailedRef.current = false
    nativeSpeechPendingRef.current = []
    voiceTelemetryRef.current = autoPlayAudio ? new VoiceTurnTelemetry(voicePlatform, captureMetrics) : null
    voiceResponseCompletedRef.current = false
    if (voiceTelemetryRef.current && !captureMetrics?.sttFinalAt) markVoice('stt_final')
    processingRef.current = true
    setIsProcessing(true)
    onStateChange('thinking')
    const requestId = createOperationId('chat')
    const controller = new AbortController()
    activeOperationRef.current = { id: requestId, sessionId: sessionId ?? '', controller }
    activeAbortRef.current = controller

    let sid: string
    try {
      sid = sessionId ?? await onNeedSession()
    } catch (error) {
      if (activeOperationRef.current?.id === requestId) {
        activeOperationRef.current = null
        activeAbortRef.current = null
        processingRef.current = false
        setIsProcessing(false)
      }
      throw error
    }
    if (activeOperationRef.current?.id !== requestId) return
    activeOperationRef.current.sessionId = sid

    addMessage({ sender: 'user', text, created_at: new Date().toISOString() })
    const assistantMessageId = createAssistantPlaceholder()

    const start = Date.now()
    let streamedText = ''
    spokenLengthRef.current = 0
    let speechBuffer = ''
    let receivedAudio = false
    let streamFailed = false
    const useNativeVoice = autoPlayAudio && isIOSNeuralVoiceRuntime()
    const useBrowserVoice = autoPlayAudio && !useNativeVoice && canUseBrowserVoice(voiceProvider)
    const useStreamingVoice = useNativeVoice || (useBrowserVoice && !isWindowsRuntime() && !isIOSRuntime())
    const useBackendVoice = autoPlayAudio && !useNativeVoice && voiceProvider === 'piper'
    try {
      if (!isNativeIOSRuntime() && asksExactLocation(text)) {
        // Atualização precisa e única, iniciada somente por uma pergunta
        // explícita. Permissão negada não deve bloquear a conversa.
        await refreshLocationContext().catch(error => console.warn('[BudsContext] Localização exata indisponível:', error))
      }
      markVoice('llm_start')
      await streamChat({ text, sessionId: sid, model: selectedModel, webSearch: webSearchEnabled, tts: useBackendVoice }, (event) => {
        const active = activeOperationRef.current
        if (!active || active.id !== requestId || active.sessionId !== sid) return
        if (event.type === 'token' && event.content) {
          markVoice('llm_first_token')
          streamedText += event.content
          appendStreamingToken(assistantMessageId, event.content)
          if (useStreamingVoice) {
            const cleanFullText = stripInternalReasoning(streamedText, true)
            const cleanDelta = cleanFullText.slice(spokenLengthRef.current)
            if (cleanDelta.length > 0) {
              speechBuffer += cleanDelta
              spokenLengthRef.current = cleanFullText.length
              const extracted = extractSpeakableChunks(speechBuffer)
              extracted.chunks.forEach(sentence => queueStreamingSpeech(sentence, useNativeVoice))
              speechBuffer = extracted.rest
            }
          }
        } else if (event.type === 'replace_response' && event.content) {
          streamedText = event.content
          speechBuffer = ''
          replaceStreamingText(assistantMessageId, event.content)
        } else if (event.type === 'web_search') {
          appendWebSearchStatus(assistantMessageId, event)
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio && !useBrowserVoice && !useNativeVoice) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (useStreamingVoice) {
            if (speechBuffer.trim()) queueStreamingSpeech(speechBuffer, useNativeVoice)
          } else if (useBrowserVoice) {
            speakText(stripInternalReasoning(streamedText))
          } else if (autoPlayAudio && !receivedAudio) {
            speakText(stripInternalReasoning(streamedText))
          }
          onLatency(Date.now() - start)
          finishVoiceMetrics('complete')
          if (!streamFailed) onResponseComplete?.(sid)
        } else if (event.type === 'error') {
          streamFailed = true
          console.error('[Chat] SSE error:', event.content)
          replaceStreamingText(assistantMessageId, `Falha no chat: ${event.content || 'o backend interrompeu a resposta.'}`)
          finalizeStreaming(assistantMessageId)
          finishVoiceMetrics('error')
          onStateChange('error')
        }
      }, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('[Chat] fetch error:', err)
      const errorMsg = err instanceof Error ? err.message : 'Erro ao conectar com o servidor. Verifique se o Ollama está rodando.'
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      if (!navigator.onLine || /conectar|servidor local|network|fetch/i.test(errorMsg)) {
        queueOfflineText(text)
        addMessage({
          sender: 'ia',
          text: 'Mensagem salva neste aparelho. Vou tentar sincronizar quando a conexão com o Buds Memory voltar.',
          created_at: new Date().toISOString(),
        })
      } else {
        addMessage({ sender: 'ia', text: `⚠ ${errorMsg}`, created_at: new Date().toISOString() })
      }
      onStateChange('error')
      finishVoiceMetrics('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      if (activeOperationRef.current?.id === requestId) {
        activeOperationRef.current = null
        activeAbortRef.current = null
        processingRef.current = false
        setIsProcessing(false)
        if (!isPlayingRef.current && !isSpeechPlayingRef.current && !isNativeSpeechPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
      }
    }
  }

  useEffect(() => {
    if (!offlineQueueEnabled) return

    async function flushOfflineQueue() {
      if (flushingOfflineRef.current || isProcessing || !navigator.onLine) return
      const queue = getOfflineQueue()
      const next = queue.shift()
      if (!next) return
      flushingOfflineRef.current = true
      setOfflineQueue(queue)
      try {
        await sendText(next)
      } finally {
        flushingOfflineRef.current = false
      }
    }

    window.addEventListener('online', flushOfflineQueue)
    flushOfflineQueue()
    return () => window.removeEventListener('online', flushOfflineQueue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayAudio, isProcessing, offlineQueueEnabled, selectedModel, selectedVoiceURI, sessionId, voiceProvider, webSearchEnabled])

  // ── Send audio ─────────────────────────────────────────────────────────────
  async function sendAudio(blob: Blob, captureMetrics?: VoiceCaptureMetrics) {
    if (processingRef.current) return
    nativeVoiceFailedRef.current = false
    nativeSpeechPendingRef.current = []
    voiceTelemetryRef.current = autoPlayAudio ? new VoiceTurnTelemetry(voicePlatform, captureMetrics) : null
    voiceResponseCompletedRef.current = false
    processingRef.current = true
    setIsProcessing(true)
    onStateChange('transcribing')
    const requestId = createOperationId('audio-chat')
    const controller = new AbortController()
    activeOperationRef.current = { id: requestId, sessionId: sessionId ?? '', controller }
    activeAbortRef.current = controller

    let sid: string
    try {
      sid = sessionId ?? await onNeedSession()
    } catch (error) {
      if (activeOperationRef.current?.id === requestId) {
        activeOperationRef.current = null
        activeAbortRef.current = null
        processingRef.current = false
        setIsProcessing(false)
      }
      throw error
    }
    if (activeOperationRef.current?.id !== requestId) return
    activeOperationRef.current.sessionId = sid

    const assistantMessageId = createAssistantPlaceholder()
    const start = Date.now()
    let streamedText = ''
    spokenLengthRef.current = 0
    let speechBuffer = ''
    let receivedAudio = false
    let streamFailed = false
    const useNativeVoice = autoPlayAudio && isIOSNeuralVoiceRuntime()
    const useBrowserVoice = autoPlayAudio && !useNativeVoice && canUseBrowserVoice(voiceProvider)
    const useStreamingVoice = useNativeVoice || (useBrowserVoice && !isWindowsRuntime() && !isIOSRuntime())
    const useBackendVoice = autoPlayAudio && !useNativeVoice && voiceProvider === 'piper'
    try {
      await streamChat({ audio: blob, sessionId: sid, model: selectedModel, webSearch: webSearchEnabled, tts: useBackendVoice }, (event) => {
        const active = activeOperationRef.current
        if (!active || active.id !== requestId || active.sessionId !== sid) return
        if (event.type === 'transcription' && event.content) {
          markVoice('stt_final')
          markVoice('llm_start')
          // Show user transcription
          setMessages(prev => {
            const userMsg: Message = { sender: 'user', text: event.content!, created_at: new Date().toISOString() }
            msgCountRef.current += 1
            onMsgCountChange(msgCountRef.current)
            const thinking = prev.find(m => m.id === assistantMessageId)
            const withoutThinking = prev.filter(m => m.id !== assistantMessageId)
            return thinking ? [...withoutThinking, userMsg, thinking] : [...withoutThinking, userMsg]
          })
          onStateChange('thinking')
        } else if (event.type === 'token' && event.content) {
          markVoice('llm_first_token')
          streamedText += event.content
          appendStreamingToken(assistantMessageId, event.content)
          if (useStreamingVoice) {
            const cleanFullText = stripInternalReasoning(streamedText, true)
            const cleanDelta = cleanFullText.slice(spokenLengthRef.current)
            if (cleanDelta.length > 0) {
              speechBuffer += cleanDelta
              spokenLengthRef.current = cleanFullText.length
              const extracted = extractSpeakableChunks(speechBuffer)
              extracted.chunks.forEach(sentence => queueStreamingSpeech(sentence, useNativeVoice))
              speechBuffer = extracted.rest
            }
          }
        } else if (event.type === 'replace_response' && event.content) {
          streamedText = event.content
          speechBuffer = ''
          replaceStreamingText(assistantMessageId, event.content)
        } else if (event.type === 'web_search') {
          appendWebSearchStatus(assistantMessageId, event)
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio && !useBrowserVoice && !useNativeVoice) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (useStreamingVoice) {
            if (speechBuffer.trim()) queueStreamingSpeech(speechBuffer, useNativeVoice)
          } else if (useBrowserVoice) {
            speakText(stripInternalReasoning(streamedText))
          } else if (autoPlayAudio && !receivedAudio) {
            speakText(stripInternalReasoning(streamedText))
          }
          onLatency(Date.now() - start)
          finishVoiceMetrics('complete')
          if (!streamFailed) onResponseComplete?.(sid)
        } else if (event.type === 'error') {
          streamFailed = true
          console.error('[Audio Chat] SSE error:', event.content)
          replaceStreamingText(assistantMessageId, `Falha no chat: ${event.content || 'o backend interrompeu a resposta.'}`)
          finalizeStreaming(assistantMessageId)
          finishVoiceMetrics('error')
          onStateChange('error')
        }
      }, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('[Audio Chat] error:', err)
      const errorMsg = err instanceof Error ? err.message : 'Erro ao processar o áudio. Tente novamente.'
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      addMessage({ sender: 'ia', text: `⚠ ${errorMsg}`, created_at: new Date().toISOString() })
      onStateChange('error')
      finishVoiceMetrics('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      if (activeOperationRef.current?.id === requestId) {
        activeOperationRef.current = null
        activeAbortRef.current = null
        processingRef.current = false
        setIsProcessing(false)
        if (!isPlayingRef.current && !isSpeechPlayingRef.current && !isNativeSpeechPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
      }
    }
  }

  const clearMessages = useCallback(() => {
    pendingTokensRef.current = new Map()
    if (tokenFlushTimerRef.current !== null) {
      window.clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    setMessages([])
    msgCountRef.current = 0
    onMsgCountChange(0)
  }, [onMsgCountChange])

  const loadMessages = useCallback((msgs: Message[]) => {
    pendingTokensRef.current = new Map()
    if (tokenFlushTimerRef.current !== null) {
      window.clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    const safeMessages = msgs
      .map(message => (
        message.sender === 'ia'
          ? { ...message, text: stripInternalReasoning(message.text).trim(), rawText: undefined }
          : message
      ))
      .filter(message => message.sender === 'user' || Boolean(message.text))
    setMessages(safeMessages)
    msgCountRef.current = safeMessages.length
    onMsgCountChange(safeMessages.length)
  }, [onMsgCountChange])

  return { messages, isProcessing, isOutputActive, availableVoices, sendText, sendAudio, stopOutput, clearMessages, loadMessages }
}
