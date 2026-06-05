import { useLayoutEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../types'

interface ChatWindowProps {
  messages: Message[]
}

export function ChatWindow({ messages }: ChatWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const chatWindow = windowRef.current
    if (!chatWindow) return

    window.requestAnimationFrame(() => {
      chatWindow.scrollTop = chatWindow.scrollHeight
    })
  }, [messages])

  return (
    <div className="chat-window scrollbar-thin" ref={windowRef}>
      {messages.map((msg, i) => (
        <MessageBubble key={msg.id ?? `${msg.sender}-${msg.created_at ?? i}`} message={msg} />
      ))}
    </div>
  )
}
