import { useEffect, useState, useCallback } from 'react'
import type { FocusInboxItem } from '../../types'
import { getFocusInbox, updateFocusInboxStatus } from '../../services/api'
import { focusStyles } from '../../styles/focus'
import { Inbox, Check, X, Loader2 } from 'lucide-react'

interface BudsInboxProps {
  onChanged?: () => void
  onCountChange?: (count: number) => void
}

export function BudsInbox({ onChanged, onCountChange }: BudsInboxProps) {
  const [items, setItems] = useState<FocusInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [processingId, setProcessingId] = useState<number | null>(null)

  const loadInbox = useCallback(async () => {
    try {
      const data = await getFocusInbox()
      setItems(data)
      if (data.length > 0) setIsExpanded(true)
      onCountChange?.(data.length)
    } catch (err) {
      console.error('Falha ao carregar inbox', err)
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadInbox(), 0)
    const interval = window.setInterval(() => void loadInbox(), 60000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [loadInbox])

  const handleStatus = async (id: number, status: 'approved' | 'ignored') => {
    setProcessingId(id)
    try {
      await updateFocusInboxStatus(id, status)
      setItems(prev => prev.filter(i => i.id !== id))
      onCountChange?.(Math.max(0, items.length - 1))
      onChanged?.()
    } catch {
      alert('Falha ao atualizar item da inbox')
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <div className={focusStyles.card}>
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center justify-between text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <h3 className={focusStyles.cardTitle}>
          <Inbox size={18} className="text-[var(--text)] opacity-80" />
          Buds Inbox
        </h3>
        {items.length > 0 && (
          <span className="flex size-6 items-center justify-center rounded-full bg-buds-action text-[10px] font-bold text-buds-action-ink">
            {items.length}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-4 flex flex-col gap-3">
          {!loading && items.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-4 text-[13px] leading-relaxed text-[var(--muted)]">
              Nada aguardando revisão. Ideias, decisões e frases duvidosas percebidas nas conversas aparecerão aqui antes de o Buds salvá-las.
            </div>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-[14px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {({ TASK: 'Tarefa', REMINDER: 'Lembrete', IDEA: 'Ideia', DECISION: 'Decisão', MEMORY: 'Memória' } as Record<string, string>)[item.item_type] ?? item.item_type}
                </span>
              </div>
              <div className="text-[13px] leading-snug text-[var(--text)]">{item.content}</div>
              
              <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--liquid-border)] pt-2">
                <button
                  onClick={() => handleStatus(item.id, 'ignored')}
                  disabled={processingId === item.id}
                  className="grid size-10 place-items-center rounded-xl text-[var(--muted)] transition-colors hover:bg-rose-500/12 hover:text-rose-300 disabled:opacity-50"
                  title="Descartar"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={() => handleStatus(item.id, 'approved')}
                  disabled={processingId === item.id}
                  className="grid size-10 place-items-center rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel)] text-[var(--text)] transition-colors hover:text-emerald-400 disabled:opacity-50"
                  title="Aprovar e Aplicar"
                >
                  {processingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
