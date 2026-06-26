import { useRef } from 'react'
import { Upload } from 'lucide-react'
import type { KnowledgeSource } from '../../types'

interface KnowledgeImportPanelProps {
  sources: KnowledgeSource[]
  value: string
  isImporting: boolean
  onValueChange: (value: string) => void
  onImportText: () => void
  onImportFile: (file: File) => void
}

export function KnowledgeImportPanel({
  sources,
  value,
  isImporting,
  onValueChange,
  onImportText,
  onImportFile,
}: KnowledgeImportPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="knowledge-import-panel">
      <div className="knowledge-import-main">
        <button
          type="button"
          className="knowledge-file-button"
          onClick={() => fileRef.current?.click()}
          disabled={isImporting}
          title="Importar PDF, TXT ou Markdown"
        >
          <Upload size={14} />
          <span>Importar</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,text/plain,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportFile(file)
          }}
        />
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onImportText()
          }}
          placeholder="Cole uma URL, pesquisa ou texto para a IA aprender"
          disabled={isImporting}
        />
        <button type="button" onClick={onImportText} disabled={isImporting || !value.trim()}>
          {isImporting ? 'Lendo...' : 'Aprender'}
        </button>
      </div>
      <div className="knowledge-learned-row">
        <span>Aprendido</span>
        {sources.length ? sources.slice(0, 3).map(source => (
          <strong key={source.id} title={source.summary}>
            {source.title}
          </strong>
        )) : (
          <em>Nenhum material importado ainda</em>
        )}
      </div>
    </div>
  )
}
