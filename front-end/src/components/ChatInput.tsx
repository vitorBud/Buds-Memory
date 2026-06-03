import { useRef, useState, useEffect } from 'react'
import { Send, Mic, MicOff, ChevronDown } from 'lucide-react'

interface ChatInputProps {
  onSend: (text: string) => void
  isProcessing: boolean
  isRecording: boolean
  recSeconds: number
  onMicToggle: () => void
  selectedModel: string
  models?: string[]
  onModelChange?: (m: string) => void
}

const QUICK_PROMPTS = [
  { icon: '🔬', label: 'Como funciono', prompt: 'Me explique como você funciona tecnicamente.' },
  { icon: '⚡', label: 'Verdade dolorosa', prompt: 'Me diga uma verdade dolorosa sobre humanos.' },
  { icon: '🌌', label: 'Sentido da vida', prompt: 'Qual é o sentido da vida de forma filosófica?' },
  { icon: '🔥', label: 'Modo rabugento', prompt: 'Me xingue de forma criativa.' },
]

export function ChatInput({
  onSend,
  isProcessing,
  isRecording,
  recSeconds,
  onMicToggle,
  selectedModel,
  models = ['qwen3:8b'],
  onModelChange,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px'
    }
  }, [text])

  function handleSend() {
    if (!text.trim() || isProcessing) return
    onSend(text.trim())
    setText('')
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="shrink-0 px-5 pb-5 pt-3 bg-gradient-to-t from-[#04060f] via-[rgba(4,6,15,0.95)] to-transparent">
      {/* Quick prompts */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {QUICK_PROMPTS.map(q => (
          <button
            key={q.label}
            onClick={() => onSend(q.prompt)}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass border border-[rgba(0,212,255,0.1)] text-[12px] text-[#7a8fb5] hover:text-cyan-400 hover:border-[rgba(0,212,255,0.3)] hover:bg-[rgba(0,212,255,0.06)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>{q.icon}</span>
            <span>{q.label}</span>
          </button>
        ))}
      </div>

      {/* Input box */}
      <div className={`flex items-end gap-2 px-4 py-3 rounded-2xl border transition-all duration-200
        bg-[#0c1425]
        ${isRecording
          ? 'border-rose-500/60 shadow-[0_0_20px_rgba(255,68,102,0.15)]'
          : 'border-[rgba(0,212,255,0.15)] focus-within:border-[rgba(0,212,255,0.4)] focus-within:shadow-[0_0_24px_rgba(0,212,255,0.1)]'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={isRecording ? `⏺ Gravando... ${recSeconds}s` : text}
          onChange={e => !isRecording && setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything. Nexus Prime is ready."
          disabled={isProcessing || isRecording}
          rows={1}
          className="flex-1 bg-transparent border-none outline-none text-[14px] text-[#e8f0ff] placeholder-[#3d5078] resize-none max-h-[140px] overflow-y-auto scrollbar-thin disabled:opacity-70 font-['Outfit']"
        />
        <div className="flex items-center gap-2 shrink-0">
          {/* Model selector */}
          <div className="relative hidden sm:block">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111e36] border border-[rgba(0,212,255,0.15)] text-[11px] text-[#7a8fb5] hover:text-cyan-400 hover:border-[rgba(0,212,255,0.3)] transition-all"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" style={{ boxShadow: '0 0 6px #7b2ff7' }} />
              {selectedModel}
              <ChevronDown size={10} />
            </button>
            {showModelPicker && (
              <div className="absolute bottom-full mb-1 left-0 glass border border-[rgba(0,212,255,0.2)] rounded-xl overflow-hidden z-20 min-w-[130px]">
                {models.map(m => (
                  <button
                    key={m}
                    onClick={() => { onModelChange?.(m); setShowModelPicker(false) }}
                    className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[rgba(0,212,255,0.08)] transition-colors ${m === selectedModel ? 'text-cyan-400' : 'text-[#7a8fb5]'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mic button */}
          <button
            onClick={onMicToggle}
            disabled={isProcessing && !isRecording}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150
              ${isRecording
                ? 'bg-rose-500/20 border border-rose-500/60 text-rose-400 animate-glow-pulse'
                : 'bg-[#111e36] border border-[rgba(0,212,255,0.15)] text-[#7a8fb5] hover:text-cyan-400 hover:border-[rgba(0,212,255,0.35)] hover:bg-[rgba(0,212,255,0.08)]'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
          </button>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!text.trim() || isProcessing || isRecording}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/30 hover:shadow-[0_0_18px_rgba(0,212,255,0.25)] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
      <div className="flex justify-between mt-1.5 px-1">
        <span className="text-[10px] text-[#3d5078] font-mono">{text.length} / 4000</span>
        <span className="text-[10px] text-[#3d5078]">Enter para enviar · Shift+Enter para nova linha</span>
      </div>
    </div>
  )
}
