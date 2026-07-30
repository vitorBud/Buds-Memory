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
    <div
      className="chat-window scrollbar-thin flex min-h-0 min-w-0 max-w-full flex-auto flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[22px] border-0 p-[clamp(12px,2vw,22px)] [background:radial-gradient(circle_at_50%_18%,rgba(var(--accent-hot-rgb)/0.06),transparent_34%),transparent] [contain:layout_paint] [overflow-anchor:none] [scrollbar-gutter:stable] [scroll-behavior:auto] [transform:translateZ(0)] [will-change:scroll-position] max-[760px]:w-full max-[760px]:gap-2 max-[760px]:px-3 max-[760px]:pt-3.5 max-[760px]:pb-3 max-[760px]:[scroll-padding-bottom:112px] max-[760px]:[-webkit-overflow-scrolling:touch]"
      ref={windowRef}
      onScroll={handleScroll}
    >
      {messages.map((msg, i) => (
        <MessageBubble key={msg.id ?? `${msg.sender}-${msg.created_at ?? i}`} message={msg} />
      ))}
    </div>
  )
}
