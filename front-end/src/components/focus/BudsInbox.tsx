import { useEffect, useState, useCallback } from 'react'
import type { FocusInboxItem } from '../../types'
import { getFocusInbox, updateFocusInboxStatus } from '../../services/api'
import { focusStyles } from '../../styles/focus'
import { Inbox, Check, X, Loader2 } from 'lucide-react'

export function BudsInbox() {
  const [items, setItems] = useState<FocusInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [processingId, setProcessingId] = useState<number | null>(null)

  const loadInbox = useCallback(async () => {
    try {
      const data = await getFocusInbox()
      setItems(data)
    } catch (err) {
      console.error('Falha ao carregar inbox', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInbox()
    const interval = setInterval(loadInbox, 60000)
    return () => clearInterval(interval)
  }, [loadInbox])

  const handleStatus = async (id: number, status: 'approved' | 'ignored') => {
    setProcessingId(id)
    try {
      await updateFocusInboxStatus(id, status)
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err) {
      alert('Falha ao atualizar item da inbox')
    } finally {
      setProcessingId(null)
    }
  }

  if (items.length === 0 && !loading) return null

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
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                  {item.item_type}
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
