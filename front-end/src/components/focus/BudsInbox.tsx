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
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className={focusStyles.cardTitle}>
          <Inbox size={18} className="text-[var(--text)] opacity-80" />
          Buds Inbox
        </h3>
        {items.length > 0 && (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--accent)] text-black text-[10px] font-bold">
            {items.length}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="mt-4 flex flex-col gap-3">
          {!loading && items.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-[13px] leading-relaxed text-[var(--muted)]">
              Nada aguardando revisão. Ideias, decisões e frases duvidosas percebidas nas conversas aparecerão aqui antes de o Buds salvá-las.
            </div>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                  {({ TASK: 'Tarefa', REMINDER: 'Lembrete', IDEA: 'Ideia', DECISION: 'Decisão', MEMORY: 'Memória' } as Record<string, string>)[item.item_type] ?? item.item_type}
                </span>
              </div>
              <div className="text-[13px] text-white/90 leading-snug">{item.content}</div>
              
              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-white/5">
                <button
                  onClick={() => handleStatus(item.id, 'ignored')}
                  disabled={processingId === item.id}
                  className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-red-400 transition-colors disabled:opacity-50"
                  title="Descartar"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={() => handleStatus(item.id, 'approved')}
                  disabled={processingId === item.id}
                  className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white hover:text-emerald-400 transition-colors disabled:opacity-50"
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
