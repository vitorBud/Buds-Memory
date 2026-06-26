import { FileCode2 } from 'lucide-react'
import type { Message } from '../../types'
import { getDetectedFiles, getConversationConcepts } from '../../utils/textAnalysis'

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
    <div className="rail-panel files-panel">
      <div className="rail-panel-head">
        <span className="eyebrow">Arquivos citados</span>
        <strong>{files.length} itens</strong>
      </div>
      <div className="rail-list">
        {files.length ? files.map(([file, count]) => (
          <div key={file} className="file-reference">
            <FileCode2 size={14} />
            <span>{file}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Nenhum arquivo citado nesta conversa.</div>
        )}
      </div>
      <div className="rail-panel-head compact">
        <span className="eyebrow">Sinais técnicos</span>
        <strong>{codeMentions.length}</strong>
      </div>
      <div className="memory-stack">
        {codeMentions.length ? codeMentions.map(([label, count]) => (
          <div key={label} className="memory-chip">
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        )) : (
          <div className="empty-rail-state">Sem sinais técnicos detectados.</div>
        )}
      </div>
    </div>
  )
}
