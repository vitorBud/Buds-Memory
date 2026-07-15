import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChat } from '../services/api'
import type { Message, AiState, Session, ChatStreamEvent } from '../types'

interface UseChatOptions {
  sessionId: string | null
  selectedModel: string
  webSearchEnabled: boolean
  selectedVoiceURI?: string
  onNeedSession: () => Promise<string>
  onStateChange: (s: AiState) => void
  onLatency: (ms: number) => void
  onMsgCountChange: (n: number) => void
  onSessionUpdate?: (session: Session) => void
  autoPlayAudio?: boolean
}

const PREFER_BROWSER_VOICE = true
const OFFLINE_QUEUE_KEY = 'aether-offline-message-queue-v1'
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
  if (name.includes('premium') || name.includes('enhanced')) score += 10
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

function extractCompleteSentences(buffer: string) {
  const sentences: string[] = []
  const regex = /([^.!?\n]+[.!?]+)(?:\s+|$)/g
  let match: RegExpExecArray | null
  let lastIndex = 0

  while ((match = regex.exec(buffer))) {
    const sentence = match[1].trim()
    if (sentence.length > 2) sentences.push(sentence)
    lastIndex = regex.lastIndex
  }

  return {
    sentences,
    rest: buffer.slice(lastIndex),
  }
}

function canUseBrowserVoice() {
  return PREFER_BROWSER_VOICE && 'speechSynthesis' in window
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

// Hook central do chat: envia texto/áudio, controla streaming, voz e interrupção da resposta.
export function useChat({
  sessionId,
  selectedModel,
  webSearchEnabled,
  selectedVoiceURI,
  onNeedSession,
  onStateChange,
  onLatency,
  onMsgCountChange,
  onSessionUpdate,
  autoPlayAudio = true,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef  = useRef(false)
  const speechQueueRef = useRef<string[]>([])
  const isSpeechPlayingRef = useRef(false)
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeAbortRef = useRef<AbortController | null>(null)
  const msgCountRef = useRef(0)
  const streamIdRef = useRef(-1)
  const flushingOfflineRef = useRef(false)

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

  function playNextSpeech() {
    if (!('speechSynthesis' in window)) return

    if (speechQueueRef.current.length === 0) {
      isSpeechPlayingRef.current = false
      if (!isProcessing) onStateChange('idle')
      return
    }

    const cleanText = speechQueueRef.current.shift()!
    const utterance = new SpeechSynthesisUtterance(cleanText)
    const voice = preferredVoiceRef.current ?? pickPreferredVoice(selectedVoiceURI)
    preferredVoiceRef.current = voice

    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || 'pt-BR'
    utterance.rate = 1.07
    utterance.pitch = 0.86
    utterance.volume = 1
    isSpeechPlayingRef.current = true
    onStateChange('speaking')
    utterance.onend = () => playNextSpeech()
    utterance.onerror = () => playNextSpeech()
    window.speechSynthesis.speak(utterance)
  }

  function queueSpeech(text: string) {
    const cleanText = text.trim()
    if (!cleanText || !('speechSynthesis' in window)) return

    speechQueueRef.current.push(cleanText.replace(/\s+/g, ' '))
    if (!isSpeechPlayingRef.current) playNextSpeech()
  }

  function speakText(text: string) {
    if (!text.trim() || !('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    speechQueueRef.current = []
    isSpeechPlayingRef.current = false
    queueSpeech(text)
  }

  // ── Audio Queue ────────────────────────────────────────────────────────────
  function playNextAudio() {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      if (!isProcessing) onStateChange('idle')
      return
    }
    isPlayingRef.current = true
    const url = audioQueueRef.current.shift()!
    onStateChange('speaking')
    const audio = new Audio(url)
    currentAudioRef.current = audio
    audio.play().catch(() => playNextAudio())
    audio.onended = () => { currentAudioRef.current = null; playNextAudio() }
  }

  function queueAudio(url: string) {
    audioQueueRef.current.push(url)
    if (!isPlayingRef.current) playNextAudio()
  }

  const stopOutput = useCallback(() => {
    activeAbortRef.current?.abort()
    activeAbortRef.current = null
    audioQueueRef.current = []
    speechQueueRef.current = []
    currentAudioRef.current?.pause()
    currentAudioRef.current = null
    isPlayingRef.current = false
    isSpeechPlayingRef.current = false
    window.speechSynthesis?.cancel()
    setMessages(prev => prev
      .map(msg => msg.streaming ? { ...msg, streaming: false } : msg)
      .filter(msg => msg.text !== '__thinking__'))
    setIsProcessing(false)
    onStateChange('idle')
  }, [onStateChange])

  // ── Append message helpers ─────────────────────────────────────────────────
  function addMessage(msg: Message) {
    setMessages(prev => [...prev, msg])
    msgCountRef.current += 1
    onMsgCountChange(msgCountRef.current)
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
    setMessages(prev => {
      const existing = prev.find(msg => msg.id === messageId)
      if (!existing) {
        return [...prev, {
          id: messageId,
          sender: 'ia',
          text: token,
          streaming: true,
          created_at: new Date().toISOString(),
        }]
      }

      return prev.map(msg => {
        if (msg.id !== messageId) return msg
        const text = msg.text === '__thinking__' ? token : msg.text + token
        return { ...msg, text, streaming: true }
      })
    })
  }

  function replaceStreamingText(messageId: number, text: string) {
    setMessages(prev => prev.map(msg => (
      msg.id === messageId
        ? { ...msg, text: text.trim(), streaming: true }
        : msg
    )))
  }

  function appendWebSearchStatus(messageId: number, event: ChatStreamEvent) {
    const found = event.results?.length ?? 0
    const status = found > 0
      ? `Google: ${found} fonte${found > 1 ? 's' : ''} encontrada${found > 1 ? 's' : ''} em tempo real.\n\n`
      : `Google: ${event.content || 'busca sem resultados.'}\n\n`
    appendStreamingToken(messageId, status)
  }

  function finalizeStreaming(messageId: number) {
    setMessages(prev => {
      let finalized = false
      const next = prev.map(msg => {
        if (msg.id !== messageId || !msg.streaming) return msg
        finalized = true
        return { ...msg, text: msg.text === '__thinking__' ? '' : msg.text, streaming: false }
      }).filter(msg => msg.text || msg.id !== messageId)

      if (finalized) {
        msgCountRef.current += 1
        onMsgCountChange(msgCountRef.current)
      }

      return next
    })
  }

  // ── Send text ──────────────────────────────────────────────────────────────
  async function sendText(text: string) {
    if (!text.trim() || isProcessing) return

    const sid = sessionId ?? await onNeedSession()
    setIsProcessing(true)
    onStateChange('thinking')

    addMessage({ sender: 'user', text, created_at: new Date().toISOString() })
    const assistantMessageId = createAssistantPlaceholder()

    const start = Date.now()
    let streamedText = ''
    let speechBuffer = ''
    let receivedAudio = false
    const useBrowserVoice = autoPlayAudio && canUseBrowserVoice()
    const controller = new AbortController()
    activeAbortRef.current = controller

    try {
      await streamChat({ text, sessionId: sid, model: selectedModel, webSearch: webSearchEnabled }, (event) => {
        if (event.type === 'token' && event.content) {
          streamedText += event.content
          appendStreamingToken(assistantMessageId, event.content)
          if (useBrowserVoice) {
            speechBuffer += event.content
            const extracted = extractCompleteSentences(speechBuffer)
            extracted.sentences.forEach(queueSpeech)
            speechBuffer = extracted.rest
          }
        } else if (event.type === 'replace_response' && event.content) {
          streamedText = event.content
          speechBuffer = ''
          replaceStreamingText(assistantMessageId, event.content)
        } else if (event.type === 'web_search') {
          appendWebSearchStatus(assistantMessageId, event)
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio && !useBrowserVoice) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (useBrowserVoice) {
            if (speechBuffer.trim()) queueSpeech(speechBuffer)
          } else if (autoPlayAudio && !receivedAudio) {
            speakText(streamedText)
          }
          onLatency(Date.now() - start)
        } else if (event.type === 'error') {
          console.error('[Chat] SSE error:', event.content)
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
          text: 'Mensagem salva neste aparelho. Vou tentar sincronizar quando a conexão com o Aether Memory voltar.',
          created_at: new Date().toISOString(),
        })
      } else {
        addMessage({ sender: 'ia', text: `⚠ ${errorMsg}`, created_at: new Date().toISOString() })
      }
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      setIsProcessing(false)
      if (!isPlayingRef.current && !isSpeechPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
    }
  }

  useEffect(() => {
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
  }, [isProcessing, sessionId, selectedModel, webSearchEnabled])

  // ── Send audio ─────────────────────────────────────────────────────────────
  async function sendAudio(blob: Blob) {
    const sid = sessionId ?? await onNeedSession()
    setIsProcessing(true)
    onStateChange('transcribing')

    const assistantMessageId = createAssistantPlaceholder()
    const start = Date.now()
    let streamedText = ''
    let speechBuffer = ''
    let receivedAudio = false
    const useBrowserVoice = autoPlayAudio && canUseBrowserVoice()
    const controller = new AbortController()
    activeAbortRef.current = controller

    try {
      await streamChat({ audio: blob, sessionId: sid, model: selectedModel, webSearch: webSearchEnabled }, (event) => {
        if (event.type === 'transcription' && event.content) {
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
          streamedText += event.content
          appendStreamingToken(assistantMessageId, event.content)
          if (useBrowserVoice) {
            speechBuffer += event.content
            const extracted = extractCompleteSentences(speechBuffer)
            extracted.sentences.forEach(queueSpeech)
            speechBuffer = extracted.rest
          }
        } else if (event.type === 'replace_response' && event.content) {
          streamedText = event.content
          speechBuffer = ''
          replaceStreamingText(assistantMessageId, event.content)
        } else if (event.type === 'web_search') {
          appendWebSearchStatus(assistantMessageId, event)
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio && !useBrowserVoice) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (useBrowserVoice) {
            if (speechBuffer.trim()) queueSpeech(speechBuffer)
          } else if (autoPlayAudio && !receivedAudio) {
            speakText(streamedText)
          }
          onLatency(Date.now() - start)
        }
      }, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('[Audio Chat] error:', err)
      const errorMsg = err instanceof Error ? err.message : 'Erro ao processar o áudio. Tente novamente.'
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      addMessage({ sender: 'ia', text: `⚠ ${errorMsg}`, created_at: new Date().toISOString() })
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      setIsProcessing(false)
      if (!isPlayingRef.current && !isSpeechPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
    }
  }

  const clearMessages = useCallback(() => {
    setMessages([])
    msgCountRef.current = 0
    onMsgCountChange(0)
  }, [onMsgCountChange])

  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs)
    msgCountRef.current = msgs.length
    onMsgCountChange(msgs.length)
  }, [onMsgCountChange])

  return { messages, isProcessing, availableVoices, sendText, sendAudio, stopOutput, clearMessages, loadMessages }
}
