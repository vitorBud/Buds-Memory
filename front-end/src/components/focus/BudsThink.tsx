import { useState } from 'react'
import { Bot, Loader2, Send, X } from 'lucide-react'
import { focusStyles } from '../../styles/focus'
import { getFocusThink } from '../../services/api'

export function BudsThink() {
  const [query, setQuery] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleThink = async () => {
    const trimmed = query.trim() || 'O que você sugere que eu faça agora?'
    setIsThinking(true)
    try {
      const result = await getFocusThink(trimmed)
      setSuggestion(result)
      setQuery('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao consultar Buds Think')
    } finally {
      setIsThinking(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleThink()
    }
  }

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[8000] flex max-w-[calc(100vw-28px)] flex-col items-end gap-3 max-[760px]:right-[max(14px,env(safe-area-inset-right))] max-[760px]:bottom-[calc(var(--mobile-nav-height)+24px+env(safe-area-inset-bottom))]">
      
      {/* Popover content */}
      {isExpanded && (
        <div className="pointer-events-auto flex w-[360px] max-w-full max-h-[calc(100dvh-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-104px)] flex-col overflow-hidden rounded-[22px] border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-strong)] text-[var(--text)] shadow-[var(--liquid-shadow)] transition-all platform-ios:bg-[var(--surface)] platform-ios:shadow-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-[var(--accent)]" />
              <span className="text-[13px] font-bold text-[var(--text)]">Buds Think</span>
            </div>
            <button 
              onClick={() => setIsExpanded(false)}
              className="grid size-10 place-items-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--liquid-panel)] hover:text-[var(--text)]"
              aria-label="Fechar Buds Think"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
            {suggestion && (
              <div className="rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-3 text-[13px] leading-relaxed text-[var(--text)]">
                <div className="font-bold text-[var(--accent)] mb-2 text-[11px] uppercase tracking-wider">Conselho</div>
                <div className="whitespace-pre-wrap">{suggestion}</div>
              </div>
            )}

            <div className="relative">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="O que devo priorizar agora?"
                className={`${focusStyles.brainDumpArea} min-h-[50px] pb-10 text-[13px]`}
                disabled={isThinking}
              />
              <button
                onClick={handleThink}
                disabled={isThinking}
                className="absolute right-2 bottom-2 grid size-9 place-items-center rounded-[10px] bg-buds-action text-buds-action-ink transition-transform hover:-translate-y-px disabled:opacity-50"
                aria-label="Enviar pergunta ao Buds Think"
              >
                {isThinking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {['O que priorizar?', 'Organizar a tarde', 'O que deixo pra amanhã?'].map((suggestionText) => (
                <button
                  key={suggestionText}
                  onClick={() => setQuery(suggestionText)}
                  className="min-h-9 whitespace-nowrap rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--liquid-border-strong)] hover:text-[var(--text)]"
                >
                  {suggestionText}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`pointer-events-auto flex size-12 items-center justify-center rounded-full border shadow-lg transition-all hover:scale-105 ${
          isExpanded ? 'border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-strong)] text-[var(--text)]' : 'border-transparent bg-buds-action text-buds-action-ink'
        }`}
        title="Buds Think - Conselhos"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Fechar Buds Think' : 'Abrir Buds Think'}
      >
        {isExpanded ? <X size={20} /> : <Bot size={20} />}
      </button>

    </div>
  )
}
