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
    <div className="knowledge-import-panel grid flex-none gap-[7px] rounded-none border border-[var(--liquid-border)] px-3 py-2.5 shadow-[var(--liquid-shadow-soft),inset_0_1px_0_rgba(255,255,255,0.16)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_42%),var(--liquid-panel)] [backdrop-filter:blur(28px)_saturate(1.45)] theme-light:border-[rgb(var(--accent-rgb)/0.18)] max-[760px]:px-2.5 max-[760px]:py-[9px]">
      <div className="knowledge-import-main grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[7px]">
        <button
          type="button"
          className="knowledge-file-button inline-flex min-h-[34px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[rgb(var(--accent-rgb)/0.22)] bg-[rgba(12,8,4,0.78)] px-3 text-xs text-[rgba(255,237,213,0.72)] transition-[background,border-color,color,transform,box-shadow] duration-180 hover:not-disabled:-translate-y-px hover:not-disabled:border-[var(--liquid-border-strong)] hover:not-disabled:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:not-disabled:text-buds-text hover:not-disabled:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] disabled:cursor-not-allowed disabled:opacity-50 theme-light:bg-[rgba(248,250,252,0.92)] theme-light:text-slate-700 max-[760px]:[&>span]:hidden"
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
          className="min-h-[34px] min-w-0 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 text-xs text-buds-text outline-none placeholder:text-buds-faint theme-light:bg-[rgba(248,250,252,0.92)] theme-light:text-slate-700 theme-light:placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={onImportText}
          disabled={isImporting || !value.trim()}
          className="inline-flex min-h-[34px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[rgb(var(--accent-rgb)/0.22)] bg-[rgba(12,8,4,0.78)] px-3 text-xs text-[rgba(255,237,213,0.72)] transition-[background,border-color,color,transform,box-shadow] duration-180 hover:not-disabled:-translate-y-px hover:not-disabled:border-[var(--liquid-border-strong)] hover:not-disabled:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:not-disabled:text-buds-text hover:not-disabled:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] disabled:cursor-not-allowed disabled:opacity-50 theme-light:bg-[rgba(248,250,252,0.92)] theme-light:text-slate-700"
        >
          {isImporting ? 'Lendo...' : 'Aprender'}
        </button>
      </div>
      <div className="knowledge-learned-row flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>span]:whitespace-nowrap [&>span]:text-[11px] [&>span]:not-italic [&>span]:text-[rgba(255,237,213,0.48)] [&>em]:whitespace-nowrap [&>em]:text-[11px] [&>em]:not-italic [&>em]:text-[rgba(255,237,213,0.48)] theme-light:[&>span]:text-slate-500 theme-light:[&>em]:text-slate-500">
        <span>Aprendido</span>
        {sources.length ? sources.slice(0, 3).map(source => (
          <strong
            key={source.id}
            title={source.summary}
            className="max-w-[190px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-2 py-1 text-[11px] font-semibold text-buds-text theme-light:bg-[rgba(248,250,252,0.92)] theme-light:text-slate-700"
          >
            {source.title}
          </strong>
        )) : (
          <em>Nenhum material importado ainda</em>
        )}
      </div>
    </div>
  )
}
