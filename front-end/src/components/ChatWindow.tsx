import { useLayoutEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../types'

interface ChatWindowProps {
  messages: Message[]
}

// Janela rolável que renderiza a sequência de mensagens da conversa.
export function ChatWindow({ messages }: ChatWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)

  useLayoutEffect(() => {
    const chatWindow = windowRef.current
    if (!chatWindow) return

    if (!shouldStickToBottomRef.current) return

    window.requestAnimationFrame(() => {
      chatWindow.scrollTop = chatWindow.scrollHeight
    })
  }, [messages])

  function handleScroll() {
    const chatWindow = windowRef.current
    if (!chatWindow) return
    const distanceFromBottom = chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 96
  }

  return (
    <div className="chat-window scrollbar-thin" ref={windowRef} onScroll={handleScroll}>
      {messages.map((msg, i) => (
        <MessageBubble key={msg.id ?? `${msg.sender}-${msg.created_at ?? i}`} message={msg} />
      ))}
    </div>
  )
}
