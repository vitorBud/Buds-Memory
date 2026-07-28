import { useState } from 'react'
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
    return `___AETHER_PLACEHOLDER_${suffix}___`
  }

  function pushPlaceholder(text: string, className: string): string {
    const id = placeholderId(placeholders.length)
    placeholders.push(`<span class="${className}">${text}</span>`)
    return id
  }

  // 1. Comments (multi-line)
  html = html.replace(/\/\*[\s\S]*?\*\//g, (m) => pushPlaceholder(m, 'token-comment'))

  // 2. Comments (single line)
  if (language === 'python' || language === 'bash' || language === 'shell' || language === 'yaml' || language === 'yml') {
    html = html.replace(/#.*/g, (m) => pushPlaceholder(m, 'token-comment'))
  } else {
    html = html.replace(/\/\/.*/g, (m) => pushPlaceholder(m, 'token-comment'))
  }

  // 3. Strings
  html = html.replace(/"(\\.|[^"\\])*"/g, (m) => pushPlaceholder(m, 'token-string'))
  html = html.replace(/'(\\.|[^'\\])*'/g, (m) => pushPlaceholder(m, 'token-string'))
  html = html.replace(/`(\\.|[^`\\])*`/g, (m) => pushPlaceholder(m, 'token-string'))

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
  html = html.replace(keywordsRegex, '<span class="token-keyword">$1</span>')

  // 5. Types & Built-ins
  const types = [
    'String', 'System', 'out', 'println', 'print', 'int', 'boolean', 'double', 'float',
    'char', 'long', 'short', 'byte', 'Object', 'List', 'ArrayList', 'Map', 'HashMap',
    'self', 'None', 'True', 'False', 'len', 'range', 'str', 'list', 'dict', 'set',
    'console', 'log', 'error', 'warn', 'info', 'window', 'document', 'process', 'require'
  ]
  const typesRegex = new RegExp(`\\b(${types.join('|')})\\b`, 'g')
  html = html.replace(typesRegex, '<span class="token-type">$1</span>')

  // 6. Numbers
  html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>')

  // 7. Annotations
  html = html.replace(/(@\w+)/g, '<span class="token-annotation">$1</span>')

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
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{displayLang}</span>
        <button
          type="button"
          className="code-block-copy-btn"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald" />
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
      <pre className="code-block-pre">
        <code
          className="code-block-code"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  )
}

// Bolha individual de mensagem, incluindo estado de pensamento e reprodução de áudio salvo.
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
      <div className="message-avatar">{isUser ? 'VG' : 'AM'}</div>

      <div className="message-stack">
        <div className={`message-bubble ${message.streaming && !isThinking ? 'streaming-cursor' : ''}`}>
          {isThinking ? (
            <div className="thinking-dots">
              <span />
              <span />
              <span />
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
                    <span key={index} style={{ whiteSpace: 'pre-wrap' }}>
                      {part.content}
                    </span>
                  )
                }
              })}
            </>
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
