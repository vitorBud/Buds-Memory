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
        <div className="pointer-events-auto flex w-[340px] max-w-full max-h-[calc(100dvh-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-104px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c1c] shadow-2xl transition-all platform-ios:shadow-none">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/5">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-[var(--accent)]" />
              <span className="text-[13px] font-bold text-white">Buds Think</span>
            </div>
            <button 
              onClick={() => setIsExpanded(false)}
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
            {suggestion && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-[13px] leading-relaxed text-white/90">
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
                className="absolute right-2 bottom-2 p-1.5 rounded-md bg-[var(--accent)] hover:opacity-90 text-white transition-colors disabled:opacity-50"
              >
                {isThinking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {['O que priorizar?', 'Organizar a tarde', 'O que deixo pra amanhã?'].map((suggestionText) => (
                <button
                  key={suggestionText}
                  onClick={() => setQuery(suggestionText)}
                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white/70 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
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
        className={`size-12 rounded-full flex items-center justify-center shadow-lg transition-all pointer-events-auto hover:scale-105 ${
          isExpanded ? 'bg-white/10 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500'
        }`}
        title="Buds Think - Conselhos"
        style={{
          background: isExpanded ? undefined : 'linear-gradient(135deg, var(--accent) 0%, #a855f7 100%)'
        }}
      >
        {isExpanded ? <X size={20} /> : <Bot size={20} />}
      </button>

    </div>
  )
}
