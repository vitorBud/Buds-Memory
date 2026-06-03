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

  return (
    <div className={`flex gap-3 animate-msg-enter max-w-[88%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold mt-1
        ${isUser
          ? 'bg-violet-600/40 border border-violet-500/40 text-violet-300'
          : 'bg-[#0c1425] border border-[rgba(0,212,255,0.3)] text-cyan-400'
        }`}
        style={!isUser ? { boxShadow: '0 0 12px rgba(0,212,255,0.15)' } : {}}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Body */}
      <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed
          ${isUser
            ? 'bg-violet-600/20 border border-violet-500/30 rounded-br-sm text-[#e8f0ff]'
            : 'glass border border-[rgba(0,212,255,0.1)] rounded-bl-sm text-[#e8f0ff]'
          }
          ${message.streaming && !isThinking ? 'streaming-cursor' : ''}
        `}>
          {isThinking ? (
            <div className="flex items-center gap-1.5 px-1 py-1">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-thinking" style={{ boxShadow: '0 0 6px #00d4ff' }} />
              <div className="w-2 h-2 rounded-full bg-violet-400 animate-thinking-2" />
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-thinking-3" style={{ boxShadow: '0 0 6px #00d4ff' }} />
            </div>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {time && <span className="text-[10px] text-[#3d5078]">{time}</span>}
          {message.audio_url && !isUser && (
            <button
              onClick={() => { const a = new Audio(message.audio_url!); a.play() }}
              className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 border border-[rgba(0,212,255,0.2)] hover:border-[rgba(0,212,255,0.5)] rounded-full px-2.5 py-0.5 transition-all duration-150"
            >
              <Volume2 size={9} />
              Ouvir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
