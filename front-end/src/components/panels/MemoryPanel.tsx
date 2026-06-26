import type { Message } from '../../types'
import { getConversationConcepts } from '../../utils/textAnalysis'

interface MemoryPanelProps {
  messages: Message[]
}

/** Painel lateral que resume conceitos recentes e memória curta da conversa. */
export function MemoryPanel({ messages }: MemoryPanelProps) {
  const concepts = getConversationConcepts(messages)
  const recent = messages.filter(message => message.text !== '__thinking__').slice(-5)

  return (
    <div className="rail-panel memory-panel">
      <div className="rail-panel-head">
        <span className="eyebrow">Memória ativa</span>
        <strong>{messages.length} registros</strong>
      </div>
      <div className="memory-stack">
        {concepts.length ? concepts.map(([label, count]) => (
          <div key={label} className="memory-chip">
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Sem conceitos capturados ainda.</div>
        )}
      </div>
      <div className="rail-list">
        {recent.map((message, index) => (
          <div key={`${message.sender}-${message.created_at ?? index}`} className="rail-list-item">
            <span>{message.sender === 'user' ? 'Usuário' : 'IA'}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
