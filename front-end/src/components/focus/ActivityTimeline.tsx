import { useEffect, useState, useCallback } from 'react'
import type { FocusTimelineEvent } from '../../types'
import { getFocusTimeline } from '../../services/api'
import { focusStyles } from '../../styles/focus'
import { Clock, Plus, Check, Lightbulb, SplitSquareVertical, Activity } from 'lucide-react'

interface ActivityTimelineProps { refreshKey?: number }

export function ActivityTimeline({ refreshKey = 0 }: ActivityTimelineProps) {
  const [events, setEvents] = useState<FocusTimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)

  const loadTimeline = useCallback(async () => {
    try {
      const data = await getFocusTimeline()
      setEvents(data)
    } catch (err) {
      console.error('Falha ao carregar timeline', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadTimeline(), 0)
    const interval = window.setInterval(() => void loadTimeline(), 30000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [loadTimeline, refreshKey])

  const getIcon = (type: string) => {
    switch (type) {
      case 'task_created': return <Plus size={12} className="text-emerald-400" />
      case 'reminder_created': return <Clock size={12} className="text-violet-400" />
      case 'task_completed': return <Check size={12} className="text-blue-400" />
      case 'idea_saved': return <Lightbulb size={12} className="text-amber-400" />
      case 'decision_saved': return <SplitSquareVertical size={12} className="text-purple-400" />
      default: return <Activity size={12} className="text-zinc-400" />
    }
  }

  return (
    <div className={focusStyles.card}>
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <h3 className={focusStyles.cardTitle}>
          <Clock size={18} className="text-[var(--text)] opacity-80" />
          Atividade de Hoje
        </h3>
        <span className="text-[12px] text-[var(--muted)]">
          {events.length} {events.length === 1 ? 'evento' : 'eventos'}
        </span>
      </button>

      {isExpanded && (
        <div className="relative mt-4 ml-1 flex flex-col gap-3 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-[var(--liquid-border)]">
          {!loading && events.length === 0 && <div className="pl-9 text-[13px] text-[var(--muted)]">A atividade do seu dia aparecerá aqui.</div>}
          {events.map((event) => {
            const time = new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return (
              <div key={event.id} className="flex items-start gap-3 relative z-10">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--liquid-border)] bg-[var(--surface)]">
                  {getIcon(event.event_type)}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="text-[13px] leading-snug text-[var(--text)]">{event.title}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">{time}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
