import type { Message } from '../../types'
import { getConversationConcepts } from '../../utils/textAnalysis'
import { railStyles } from '../../styles/paineisContexto'

interface MemoryPanelProps {
  messages: Message[]
}

/** Painel lateral que resume conceitos recentes e memória curta da conversa. */
export function MemoryPanel({ messages }: MemoryPanelProps) {
  const concepts = getConversationConcepts(messages)
  const recent = messages.filter(message => message.text !== '__thinking__').slice(-5)

  return (
    <div className={`rail-panel memory-panel ${railStyles.panel}`}>
      <div className={`rail-panel-head ${railStyles.heading}`}>
        <span className={railStyles.eyebrow}>Memória ativa</span>
        <strong>{messages.length} registros</strong>
      </div>
      <div className={`memory-stack ${railStyles.stack}`}>
        {concepts.length ? concepts.map(([label, count]) => (
          <div key={label} className={`memory-chip grid-cols-[minmax(0,1fr)_auto] ${railStyles.chip}`}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className={`empty-rail-state ${railStyles.empty}`}>Sem conceitos capturados ainda.</div>
        )}
      </div>
      <div className={`rail-list ${railStyles.list}`}>
        {recent.map((message, index) => (
          <div key={`${message.sender}-${message.created_at ?? index}`} className={`rail-list-item ${railStyles.item}`}>
            <span>{message.sender === 'user' ? 'Usuário' : 'IA'}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
