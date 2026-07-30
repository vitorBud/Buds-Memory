import type { AiState, Message } from '../../types'
import { getConversationConcepts, getFirstUserMessage } from '../../utils/textAnalysis'
import { railStyles } from '../../styles/paineisContexto'

interface SummaryPanelProps {
  messages: Message[]
  aiState: AiState
  latency: string
  msgCount: number
  selectedModel: string
}

/** Painel lateral que mostra uma visão compacta do estado atual da conversa. */
export function SummaryPanel({
  messages,
  aiState,
  latency,
  msgCount,
  selectedModel,
}: SummaryPanelProps) {
  const firstQuestion = getFirstUserMessage(messages)
  const concepts = getConversationConcepts(messages).slice(0, 5)
  const questions = messages.filter(message => message.sender === 'user' && message.text.includes('?')).length

  return (
    <div className={`rail-panel summary-panel ${railStyles.panel}`}>
      <div className={`rail-panel-head ${railStyles.heading}`}>
        <span className={railStyles.eyebrow}>Resumo</span>
        <strong>{messages.length ? 'Conversa ativa' : 'Aguardando'}</strong>
      </div>
      <div className={`summary-block ${railStyles.summary}`}>
        <span>Objetivo provável</span>
        <p>{firstQuestion || 'Nenhuma pergunta enviada ainda.'}</p>
      </div>
      <div className={railStyles.stats}>
        <div>
          <span>Estado</span>
          <strong>{aiState}</strong>
        </div>
        <div>
          <span>Latência</span>
          <strong>{latency || '--'}</strong>
        </div>
        <div>
          <span>Mensagens</span>
          <strong>{msgCount}</strong>
        </div>
      </div>
      <div className={`summary-block ${railStyles.summary}`}>
        <span>Assuntos</span>
        <p>{concepts.length ? concepts.map(([label]) => label).join(', ') : 'Sem assuntos suficientes.'}</p>
      </div>
      <div className={`summary-block ${railStyles.summary}`}>
        <span>Sistema</span>
        <p>{selectedModel} · {questions} pergunta(s) detectada(s)</p>
      </div>
    </div>
  )
}
