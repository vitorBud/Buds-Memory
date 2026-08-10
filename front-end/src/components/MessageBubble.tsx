import { memo, useState } from 'react'
import { Volume2, Copy, Check } from 'lucide-react'
import type { Message } from '../types'
import { formatTime } from '../utils/formatters'

interface MessageBubbleProps {
  message: Message
}

interface MessagePart {
  type: 'text' | 'code'
  language?: string
  content: string
}

// Simple syntax highlighting using regular expressions
function highlightCode(code: string, lang: string): string {
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const language = lang.toLowerCase()
  const placeholders: string[] = []

  function placeholderId(index: number): string {
    let value = index
    let suffix = ''
    do {
      suffix = String.fromCharCode(65 + (value % 26)) + suffix
      value = Math.floor(value / 26) - 1
    } while (value >= 0)
    return `___BUDS_PLACEHOLDER_${suffix}___`
  }

  function pushPlaceholder(text: string, className: string): string {
    const id = placeholderId(placeholders.length)
    placeholders.push(`<span class="${className}">${text}</span>`)
    return id
  }

  // 1. Comments (multi-line)
  html = html.replace(/\/\*[\s\S]*?\*\//g, (m) => pushPlaceholder(m, 'text-[#6e7681] italic'))

  // 2. Comments (single line)
  if (language === 'python' || language === 'bash' || language === 'shell' || language === 'yaml' || language === 'yml') {
    html = html.replace(/#.*/g, (m) => pushPlaceholder(m, 'text-[#6e7681] italic'))
  } else {
    html = html.replace(/\/\/.*/g, (m) => pushPlaceholder(m, 'text-[#6e7681] italic'))
  }

  // 3. Strings
  html = html.replace(/"(\\.|[^"\\])*"/g, (m) => pushPlaceholder(m, 'text-[#a5d6ff]'))
  html = html.replace(/'(\\.|[^'\\])*'/g, (m) => pushPlaceholder(m, 'text-[#a5d6ff]'))
  html = html.replace(/`(\\.|[^`\\])*`/g, (m) => pushPlaceholder(m, 'text-[#a5d6ff]'))

  // 4. Keywords
  const keywords = [
    'class', 'public', 'private', 'protected', 'static', 'void', 'import', 'package',
    'return', 'if', 'else', 'for', 'while', 'do', 'new', 'null', 'this', 'super',
    'try', 'catch', 'finally', 'throw', 'throws', 'extends', 'implements', 'interface',
    'def', 'elif', 'except', 'as', 'with', 'from', 'global', 'nonlocal', 'lambda',
    'const', 'let', 'var', 'function', 'async', 'await', 'export', 'default',
    'break', 'continue', 'switch', 'case', 'typeof', 'instanceof', 'in', 'of',
    'and', 'or', 'not', 'is', 'pass', 'yield', 'final'
  ]
  const keywordsRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')
  html = html.replace(keywordsRegex, '<span class="font-semibold text-[#ff7b72]">$1</span>')

  // 5. Types & Built-ins
  const types = [
    'String', 'System', 'out', 'println', 'print', 'int', 'boolean', 'double', 'float',
    'char', 'long', 'short', 'byte', 'Object', 'List', 'ArrayList', 'Map', 'HashMap',
    'self', 'None', 'True', 'False', 'len', 'range', 'str', 'list', 'dict', 'set',
    'console', 'log', 'error', 'warn', 'info', 'window', 'document', 'process', 'require'
  ]
  const typesRegex = new RegExp(`\\b(${types.join('|')})\\b`, 'g')
  html = html.replace(typesRegex, '<span class="text-[#79c0ff]">$1</span>')

  // 6. Numbers
  html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-[#d2a8ff]">$1</span>')

  // 7. Annotations
  html = html.replace(/(@\w+)/g, '<span class="text-[#ff9b50]">$1</span>')

  // Restore placeholders in reverse order
  for (let i = placeholders.length - 1; i >= 0; i--) {
    html = html.replace(placeholderId(i), placeholders[i])
  }

  return html
}

// Parses markdown code blocks (```lang ... ```)
function parseMessageText(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  if (!text) return parts

  const lines = text.split('\n')
  let currentBlock: { type: 'text' | 'code'; language?: string; lines: string[] } = {
    type: 'text',
    lines: []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^\s*```([^\s`]*)/)
    if (match) {
      if (currentBlock.lines.length > 0) {
        parts.push({
          type: currentBlock.type,
          language: currentBlock.language,
          content: currentBlock.lines.join('\n')
        })
      }

      if (currentBlock.type === 'text') {
        currentBlock = {
          type: 'code',
          language: match[1] || '',
          lines: []
        }
      } else {
        currentBlock = {
          type: 'text',
          lines: []
        }
      }
    } else {
      currentBlock.lines.push(line)
    }
  }

  if (currentBlock.lines.length > 0) {
    parts.push({
      type: currentBlock.type,
      language: currentBlock.language,
      content: currentBlock.lines.join('\n')
    })
  }

  return parts
}

interface CodeBlockProps {
  language: string
  code: string
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const displayLang = (language || 'code').toUpperCase()
  const highlightedHtml = highlightCode(code, language)

  return (
    <div className="my-3.5 flex min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-white/8 bg-[rgba(15,15,20,0.65)] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-lg platform-ios:![backdrop-filter:none]">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/5 bg-[rgba(10,10,12,0.5)] px-4 py-2 font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,sans-serif]">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold tracking-[0.5px] text-white/50">{displayLang}</span>
        <button
          type="button"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-white/50 transition-all duration-200 hover:bg-white/5 hover:text-white/85 active:scale-96"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check size={13} className="!text-emerald-400" />
              <span>Copiado!</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copiar código</span>
            </>
          )}
        </button>
      </div>
      <pre className="m-0 min-w-0 max-w-full overflow-x-auto bg-transparent p-4 max-[760px]:overflow-x-hidden max-[760px]:p-3">
        <code
          className="block max-w-full whitespace-pre text-left font-['SFMono-Regular',Consolas,'Liberation_Mono',Menlo,Courier,monospace] text-[13.5px] leading-[1.6] text-slate-200 max-[760px]:whitespace-pre-wrap max-[760px]:break-words max-[760px]:[overflow-wrap:anywhere]"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  )
}

// Bolha individual de mensagem, incluindo estado de pensamento e reprodução de áudio salvo.
export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
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
    <article
      className={`message-row flex min-w-0 max-w-[min(820px,88%)] gap-2.5 animate-[msg-enter_220ms_ease_both] platform-windows:![animation:none] max-[760px]:w-full max-[760px]:max-w-full max-[760px]:gap-[7px] ${
        isUser
          ? 'is-user ml-auto self-end flex-row-reverse justify-start'
          : 'is-ai mr-auto self-start justify-start'
      }`}
    >
      <div
        className={`message-avatar mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border bg-[rgba(var(--accent-hot-rgb)/0.1)] font-mono text-[10px] font-bold max-[760px]:hidden ${
          isUser
            ? 'border-[var(--liquid-border)] text-buds-text'
            : 'border-[rgba(255,209,102,0.42)] text-[var(--jarvis-hot)]'
        }`}
      >
        {isUser ? 'VG' : 'BM'}
      </div>

      <div
        className={`message-stack grid min-w-0 gap-[5px] max-[760px]:max-w-[min(calc(100vw-40px),560px)] ${
          isUser ? 'justify-items-end' : 'justify-items-start'
        }`}
      >
        <div
          className={`message-bubble min-w-0 max-w-[min(760px,78vw)] overflow-hidden rounded-3xl border px-[15px] py-[13px] text-sm leading-[1.62] text-buds-text shadow-[var(--liquid-shadow-soft),inset_0_1px_0_rgba(255,255,255,0.16)] ![backdrop-filter:none] [transform:translateZ(0)] max-[760px]:max-w-full max-[760px]:break-words max-[760px]:[overflow-wrap:anywhere] max-[760px]:rounded-[18px] max-[760px]:px-[13px] max-[760px]:py-2.5 max-[760px]:text-[15px] max-[760px]:leading-[1.45] ${
            isUser
              ? 'border-[rgba(var(--accent-hot-rgb)/0.2)] [background:linear-gradient(135deg,rgba(var(--accent-hot-rgb)/0.2),transparent_52%),rgba(var(--accent-hot-rgb)/0.1)] max-[760px]:rounded-br-md max-[760px]:border-transparent max-[760px]:bg-buds-action max-[760px]:text-buds-action-ink'
              : 'border-[var(--liquid-border)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_42%),var(--liquid-panel-soft)] max-[760px]:rounded-bl-md max-[760px]:border-[var(--line)] max-[760px]:[background:color-mix(in_srgb,var(--surface-3)_86%,white_6%)]'
          } ${
            message.streaming && !isThinking
              ? "streaming-cursor after:ml-0.5 after:animate-[blink_0.7s_ease_infinite] after:text-buds-cyan after:content-['▌'] platform-windows:after:![animation:none]"
              : ''
          }`}
        >
          {isThinking ? (
            <div className="thinking-dots flex min-h-5 items-center gap-[5px]">
              <span className="size-[7px] animate-[thinking_1.1s_ease_infinite] rounded-full bg-buds-cyan platform-windows:![animation:none]" />
              <span className="size-[7px] animate-[thinking_1.1s_ease_0.16s_infinite] rounded-full bg-buds-violet platform-windows:![animation:none]" />
              <span className="size-[7px] animate-[thinking_1.1s_ease_0.32s_infinite] rounded-full bg-buds-teal platform-windows:![animation:none]" />
            </div>
          ) : (
            <>
              {parseMessageText(message.text).map((part, index) => {
                if (part.type === 'code') {
                  return (
                    <CodeBlock
                      key={index}
                      language={part.language || ''}
                      code={part.content}
                    />
                  )
                } else {
                  return (
                    <span key={index} className="block max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {part.content}
                    </span>
                  )
                }
              })}
            </>
          )}
        </div>

        <div className={`message-meta flex items-center gap-2 text-[11px] text-buds-muted max-[760px]:opacity-[.72] ${
          isUser ? 'justify-self-end' : 'justify-self-start'
        }`}>
          {time && <span>{time}</span>}
          {!isUser && !isThinking && message.text.trim() && (
            <button
              type="button"
              onClick={speakMessage}
              className="inline-flex min-h-8 items-center gap-[5px] rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-2.5 py-[3px] text-buds-text hover:border-[var(--liquid-border-strong)] hover:bg-[var(--liquid-panel-strong)] hover:text-[var(--accent-hot)]"
            >
              <Volume2 size={11} />
              Ouvir
            </button>
          )}
        </div>
      </div>
    </article>
  )
})
