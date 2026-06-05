import { useState, useRef } from 'react'
import { streamChat } from '../services/api'
import type { Message, AiState, Session } from '../types'

interface UseChatOptions {
  sessionId: string | null
  onNeedSession: () => Promise<string>
  onStateChange: (s: AiState) => void
  onLatency: (ms: number) => void
  onMsgCountChange: (n: number) => void
  onSessionUpdate?: (session: Session) => void
  autoPlayAudio?: boolean
}

export function useChat({
  sessionId,
  onNeedSession,
  onStateChange,
  onLatency,
  onMsgCountChange,
  onSessionUpdate,
  autoPlayAudio = true,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef  = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const msgCountRef = useRef(0)
  const streamIdRef = useRef(-1)

  function speakText(text: string) {
    const cleanText = text.trim()
    if (!cleanText || !('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.lang = 'pt-BR'
    utterance.rate = 1
    utterance.pitch = 1
    onStateChange('speaking')
    utterance.onend = () => {
      if (!isProcessing) onStateChange('idle')
    }
    utterance.onerror = () => {
      if (!isProcessing) onStateChange('idle')
    }
    window.speechSynthesis.speak(utterance)
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
    let receivedAudio = false

    try {
      await streamChat({ text, sessionId: sid }, (event) => {
        if (event.type === 'token' && event.content) {
          streamedText += event.content
          appendStreamingToken(assistantMessageId, event.content)
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (autoPlayAudio && !receivedAudio) speakText(streamedText)
          onLatency(Date.now() - start)
        } else if (event.type === 'error') {
          console.error('[Chat] SSE error:', event.content)
          onStateChange('error')
        }
      })
    } catch (err) {
      console.error('[Chat] fetch error:', err)
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      addMessage({ sender: 'ia', text: '⚠ Erro ao conectar com o servidor. Verifique se o Ollama está rodando.', created_at: new Date().toISOString() })
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      setIsProcessing(false)
      if (!isPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
    }
  }

  // ── Send audio ─────────────────────────────────────────────────────────────
  async function sendAudio(blob: Blob) {
    const sid = sessionId ?? await onNeedSession()
    setIsProcessing(true)
    onStateChange('transcribing')

    const assistantMessageId = createAssistantPlaceholder()
    const start = Date.now()
    let streamedText = ''
    let receivedAudio = false

    try {
      await streamChat({ audio: blob, sessionId: sid }, (event) => {
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
        } else if (event.type === 'session_update' && event.session) {
          onSessionUpdate?.(event.session)
        } else if (event.type === 'audio_sentence' && event.url && autoPlayAudio) {
          receivedAudio = true
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming(assistantMessageId)
          if (autoPlayAudio && !receivedAudio) speakText(streamedText)
          onLatency(Date.now() - start)
        }
      })
    } catch (err) {
      console.error('[Audio Chat] error:', err)
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      addMessage({ sender: 'ia', text: '⚠ Erro ao processar o áudio. Tente novamente.', created_at: new Date().toISOString() })
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      setIsProcessing(false)
      if (!isPlayingRef.current && !window.speechSynthesis?.speaking) onStateChange('idle')
    }
  }

  function clearMessages() {
    setMessages([])
    msgCountRef.current = 0
    onMsgCountChange(0)
  }

  function loadMessages(msgs: Message[]) {
    setMessages(msgs)
    msgCountRef.current = msgs.length
    onMsgCountChange(msgs.length)
  }

  return { messages, isProcessing, sendText, sendAudio, clearMessages, loadMessages }
}
