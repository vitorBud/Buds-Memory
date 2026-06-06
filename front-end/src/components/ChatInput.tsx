import { useRef, useState, useEffect } from 'react'
import { Bot, ChevronDown, Compass, Mic, MicOff, Send, ShieldCheck, Zap } from 'lucide-react'
import type { DensityMode } from '../types'

interface ChatInputProps {
  onSend: (text: string) => void
  isProcessing: boolean
  isRecording: boolean
  recSeconds: number
  onMicToggle: () => void
  selectedModel: string
  models?: string[]
  onModelChange?: (m: string) => void
  showQuickPrompts?: boolean
  density?: DensityMode
}

const QUICK_PROMPTS = [
  { icon: Bot, label: 'Tecnico', prompt: 'Explique como você funciona tecnicamente, de forma objetiva.' },
  { icon: Zap, label: 'Direto', prompt: 'Responda de forma curta, prática e sem floreios.' },
  { icon: Compass, label: 'Plano', prompt: 'Monte um plano de ação com prioridades claras.' },
  { icon: ShieldCheck, label: 'Revisar', prompt: 'Revise minha ideia procurando riscos, lacunas e melhorias.' },
]

const MODEL_LABELS: Record<string, { label: string; hint: string }> = {
  'qwen2.5-coder:3b': { label: 'Rápido', hint: 'leve' },
  'qwen2.5-coder:7b': { label: 'Padrão', hint: 'equilibrado' },
  'qwen2.5-coder:14b': { label: 'Mais potente', hint: 'melhor raciocínio' },
}

// Campo de composição do chat com prompts rápidos, seletor de modelo, microfone e envio.
export function ChatInput({
  onSend,
  isProcessing,
  isRecording,
  recSeconds,
  onMicToggle,
  selectedModel,
  models = ['qwen3:8b'],
  onModelChange,
  showQuickPrompts = true,
  density = 'compact',
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const maxHeight = density === 'compact' ? 104 : 142
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, maxHeight) + 'px'
    }
  }, [text, density])

  function handleSend() {
    if (!text.trim() || isProcessing) return
    onSend(text.trim())
    setText('')
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`chat-input-shell density-${density}`}>
      {showQuickPrompts && (
        <div className="quick-prompts">
          {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSend(prompt)}
              disabled={isProcessing}
              className="quick-prompt"
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`composer ${isRecording ? 'is-recording' : ''}`}>
        <textarea
          ref={textareaRef}
          value={isRecording ? `Gravando... ${recSeconds}s` : text}
          onChange={e => !isRecording && setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Digite um comando ou mensagem"
          disabled={isProcessing || isRecording}
          rows={1}
        />

        <div className="composer-actions">
          <div className="model-select">
            <button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="model-button"
            >
              <span />
              {MODEL_LABELS[selectedModel]?.label ?? selectedModel}
              <ChevronDown size={12} />
            </button>

            {showModelPicker && (
              <div className="model-menu">
                {models.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onModelChange?.(m)
                      setShowModelPicker(false)
                    }}
                    className={m === selectedModel ? 'is-active' : ''}
                  >
                    <span>{MODEL_LABELS[m]?.label ?? m}</span>
                    <small>{MODEL_LABELS[m]?.hint ?? m}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onMicToggle}
            disabled={isProcessing && !isRecording}
            className={`round-action ${isRecording ? 'is-recording' : ''}`}
            aria-label={isRecording ? 'Parar gravacao' : 'Gravar audio'}
            title={isRecording ? 'Parar gravacao' : 'Gravar audio'}
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || isProcessing || isRecording}
            className="send-action"
            aria-label="Enviar mensagem"
            title="Enviar"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <div className="composer-meta">
        <span>{text.length} / 4000</span>
        <span>Enter envia</span>
      </div>
    </div>
  )
}
