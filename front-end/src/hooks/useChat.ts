import { useState, useRef, useCallback } from 'react'
import { streamChat } from '../services/api'
import type { Message, AiState } from '../types'

interface UseChatOptions {
  sessionId: string | null
  onNeedSession: () => Promise<string>
  onStateChange: (s: AiState) => void
  onLatency: (ms: number) => void
  onMsgCountChange: (n: number) => void
}

export function useChat({
  sessionId,
  onNeedSession,
  onStateChange,
  onLatency,
  onMsgCountChange,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef  = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const msgCountRef = useRef(0)

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

  function appendStreamingToken(token: string) {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last && last.streaming) {
        copy[copy.length - 1] = { ...last, text: last.text + token }
        return copy
      }
      // First token: replace loading message with streaming bubble
      const aiMsg: Message = { sender: 'ia', text: token, streaming: true, created_at: new Date().toISOString() }
      return [...copy.filter(m => m.sender !== 'ia' || !m.streaming || m.text !== '__thinking__'), aiMsg]
    })
  }

  function finalizeStreaming() {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last?.streaming) {
        copy[copy.length - 1] = { ...last, streaming: false }
        msgCountRef.current += 1
        onMsgCountChange(msgCountRef.current)
      }
      return copy
    })
  }

  // ── Send text ──────────────────────────────────────────────────────────────
  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return

    const sid = sessionId ?? await onNeedSession()
    setIsProcessing(true)
    onStateChange('thinking')

    addMessage({ sender: 'user', text, created_at: new Date().toISOString() })
    // Thinking placeholder
    setMessages(prev => [...prev, { sender: 'ia', text: '__thinking__', streaming: true }])

    const start = Date.now()
    let firstToken = true

    try {
      await streamChat({ text, sessionId: sid }, (event) => {
        if (event.type === 'token' && event.content) {
          if (firstToken) {
            // Remove thinking placeholder
            setMessages(prev => prev.filter(m => !(m.streaming && m.text === '__thinking__')))
            firstToken = false
          }
          appendStreamingToken(event.content)
        } else if (event.type === 'audio_sentence' && event.url) {
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming()
          onLatency(Date.now() - start)
        } else if (event.type === 'error') {
          console.error('[Chat] SSE error:', event.content)
          onStateChange('error')
        }
      })
    } catch (err) {
      console.error('[Chat] fetch error:', err)
      setMessages(prev => prev.filter(m => !(m.streaming && m.text === '__thinking__')))
      addMessage({ sender: 'ia', text: '⚠ Erro ao conectar com o servidor. Verifique se o Ollama está rodando.', created_at: new Date().toISOString() })
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      setIsProcessing(false)
      if (!isPlayingRef.current) onStateChange('idle')
    }
  }, [sessionId, isProcessing])

  // ── Send audio ─────────────────────────────────────────────────────────────
  const sendAudio = useCallback(async (blob: Blob) => {
    const sid = sessionId ?? await onNeedSession()
    setIsProcessing(true)
    onStateChange('transcribing')

    setMessages(prev => [...prev, { sender: 'ia', text: '__thinking__', streaming: true }])

    let firstToken = true
    const start = Date.now()

    try {
      await streamChat({ audio: blob, sessionId: sid }, (event) => {
        if (event.type === 'transcription' && event.content) {
          // Show user transcription
          setMessages(prev => {
            const without = prev.filter(m => !(m.streaming && m.text === '__thinking__'))
            const userMsg: Message = { sender: 'user', text: event.content!, created_at: new Date().toISOString() }
            msgCountRef.current += 1
            onMsgCountChange(msgCountRef.current)
            return [...without, userMsg, { sender: 'ia', text: '__thinking__', streaming: true }]
          })
          onStateChange('thinking')
        } else if (event.type === 'token' && event.content) {
          if (firstToken) {
            setMessages(prev => prev.filter(m => !(m.streaming && m.text === '__thinking__')))
            firstToken = false
          }
          appendStreamingToken(event.content)
        } else if (event.type === 'audio_sentence' && event.url) {
          queueAudio(event.url)
        } else if (event.type === 'done') {
          finalizeStreaming()
          onLatency(Date.now() - start)
        }
      })
    } catch (err) {
      console.error('[Audio Chat] error:', err)
      setMessages(prev => prev.filter(m => !(m.streaming && m.text === '__thinking__')))
      addMessage({ sender: 'ia', text: '⚠ Erro ao processar o áudio. Tente novamente.', created_at: new Date().toISOString() })
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 3000)
    } finally {
      setIsProcessing(false)
      if (!isPlayingRef.current) onStateChange('idle')
    }
  }, [sessionId, isProcessing])

  const clearMessages = useCallback(() => {
    setMessages([])
    msgCountRef.current = 0
    onMsgCountChange(0)
  }, [])

  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs)
    msgCountRef.current = msgs.length
    onMsgCountChange(msgs.length)
  }, [])

  return { messages, isProcessing, sendText, sendAudio, clearMessages, loadMessages }
}
