import { Volume2 } from 'lucide-react'
import type { Message } from '../types'
import { formatTime } from '../utils/formatters'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.sender === 'user'
  const isThinking = message.streaming && message.text === '__thinking__'
  const time = message.created_at ? formatTime(new Date(message.created_at)) : ''

  function speakMessage() {
    if (message.audio_url) {
      const audio = new Audio(message.audio_url)
      audio.play()
      return
    }

    if (!('speechSynthesis' in window) || !message.text.trim()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(message.text)
    utterance.lang = 'pt-BR'
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }

  return (
    <article className={`message-row ${isUser ? 'is-user' : 'is-ai'}`}>
      <div className="message-avatar">{isUser ? 'VG' : 'NX'}</div>

      <div className="message-stack">
        <div className={`message-bubble ${message.streaming && !isThinking ? 'streaming-cursor' : ''}`}>
          {isThinking ? (
            <div className="thinking-dots">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
          )}
        </div>

        <div className="message-meta">
          {time && <span>{time}</span>}
          {!isUser && !isThinking && message.text.trim() && (
            <button
              type="button"
              onClick={speakMessage}
            >
              <Volume2 size={11} />
              Ouvir
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
