import { FileCode2 } from 'lucide-react'
import type { Message } from '../../types'
import { getDetectedFiles, getConversationConcepts } from '../../utils/textAnalysis'
import { railStyles } from '../../styles/paineisContexto'

const TECH_SIGNALS = ['javascript', 'python', 'react', 'flask', 'erro', 'funcao', 'codigo', 'backend', 'frontend']

interface FilesPanelProps {
  messages: Message[]
}

/** Painel lateral que identifica arquivos, linguagens e sinais técnicos citados no chat. */
export function FilesPanel({ messages }: FilesPanelProps) {
  const files = getDetectedFiles(messages)
  const codeMentions = getConversationConcepts(messages)
    .filter(([label]) => TECH_SIGNALS.includes(label))

  return (
    <div className={`rail-panel files-panel ${railStyles.panel}`}>
      <div className={`rail-panel-head ${railStyles.heading}`}>
        <span className={railStyles.eyebrow}>Arquivos citados</span>
        <strong>{files.length} itens</strong>
      </div>
      <div className={`rail-list ${railStyles.list}`}>
        {files.length ? files.map(([file, count]) => (
          <div
            key={file}
            className={`file-reference grid-cols-[auto_minmax(0,1fr)_auto] [&>svg]:text-buds-cyan ${railStyles.chip}`}
          >
            <FileCode2 size={14} />
            <span>{file}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className={`empty-rail-state ${railStyles.empty}`}>Nenhum arquivo citado nesta conversa.</div>
        )}
      </div>
      <div className={`rail-panel-head compact mt-1 ${railStyles.heading}`}>
        <span className={railStyles.eyebrow}>Sinais técnicos</span>
        <strong>{codeMentions.length}</strong>
      </div>
      <div className={`memory-stack ${railStyles.stack}`}>
        {codeMentions.length ? codeMentions.map(([label, count]) => (
          <div key={label} className={`memory-chip grid-cols-[minmax(0,1fr)_auto] ${railStyles.chip}`}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className={`empty-rail-state ${railStyles.empty}`}>Sem sinais técnicos detectados.</div>
        )}
      </div>
    </div>
  )
}
