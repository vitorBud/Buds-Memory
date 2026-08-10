import { Bell, Check, MapPin, MessageCircle, Trash2, Zap } from 'lucide-react'
import type { FocusTask } from '../../types'
import { focusStyles } from '../../styles/focus'

interface TaskItemProps {
  task: FocusTask
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
  onSetFocus: (id: number) => void
}

export function TaskItem({ task, onToggle, onDelete, onSetFocus }: TaskItemProps) {
  const categories: Record<string, string> = { work: 'Trabalho', study: 'Estudo', personal: 'Pessoal', project: 'Projeto', other: 'Geral' }
  const priorities: Record<string, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' }
  const places: Record<string, string> = { home: 'Casa', work: 'Trabalho', gym: 'Academia', study: 'Estudo', other: 'Outro lugar' }
  const dueLabel = task.due_date
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(task.due_date))
    : null
  return (
    <div className={`${focusStyles.taskItem} ${task.completed ? focusStyles.taskItemCompleted : ''}`}>
      <div className={focusStyles.taskContent}>
        <button
          type="button"
          onClick={() => onToggle(task.id, !task.completed)}
          className={`${focusStyles.taskCheckbox} ${task.completed ? focusStyles.taskCheckboxChecked : ''}`}
        >
          {task.completed && <Check size={14} />}
        </button>
        
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <span 
              className={`${focusStyles.taskTitle} ${task.completed ? focusStyles.taskTitleCompleted : ''}`}
              title={task.title}
            >
              {task.title}
            </span>
            {task.is_focus && (
              <Zap size={14} className="text-amber-400 shrink-0 mt-0.5" />
            )}
          </div>
          
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className={focusStyles.taskMeta}>
              {task.item_type === 'REMINDER' && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold text-violet-300"><Bell size={11} /> Lembrete</span>}
              <span className={focusStyles.badgeCategory}>
                {categories[task.category] ?? task.category}
              </span>
              <span className={
                task.priority === 'high' ? focusStyles.badgePriorityHigh :
                task.priority === 'medium' ? focusStyles.badgePriorityMedium :
                focusStyles.badgePriorityLow
              }>
                {priorities[task.priority] ?? task.priority}
              </span>
              {dueLabel && <span className="text-[11px] text-[var(--muted)]">{dueLabel}</span>}
              {task.place_context && task.place_context !== 'anywhere' && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${task.location_relevant ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-[var(--liquid-border)] text-[var(--muted)]'}`}>
                  <MapPin size={11} /> {places[task.place_context] ?? task.place_context}{task.trigger_on_arrival ? ' · ao chegar' : ''}
                </span>
              )}
              {task.source === 'chat' && <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]"><MessageCircle size={11} /> do chat</span>}
            </div>
            
            <div className={focusStyles.taskActions}>
              {!task.completed && !task.is_focus && (
                <button
                  type="button"
                  onClick={() => onSetFocus(task.id)}
                  className={focusStyles.actionBtn}
                  title="Definir como foco principal"
                >
                  <Zap size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(task.id)}
                className={focusStyles.actionBtn}
                title="Deletar tarefa"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
