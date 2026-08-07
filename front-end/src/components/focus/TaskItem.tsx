import { Check, Trash2, Zap } from 'lucide-react'
import type { FocusTask } from '../../types'
import { focusStyles } from '../../styles/focus'

interface TaskItemProps {
  task: FocusTask
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
  onSetFocus: (id: number) => void
}

export function TaskItem({ task, onToggle, onDelete, onSetFocus }: TaskItemProps) {
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
          
          <div className="flex items-center justify-between">
            <div className={focusStyles.taskMeta}>
              <span className={focusStyles.badgeCategory}>
                {task.category}
              </span>
              <span className={
                task.priority === 'high' ? focusStyles.badgePriorityHigh :
                task.priority === 'medium' ? focusStyles.badgePriorityMedium :
                focusStyles.badgePriorityLow
              }>
                {task.priority}
              </span>
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
