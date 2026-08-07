import { TaskItem } from './TaskItem'
import type { FocusTask } from '../../types'
import { focusStyles } from '../../styles/focus'

interface TaskListProps {
  tasks: FocusTask[]
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
  onSetFocus: (id: number) => void
}

export function TaskList({ tasks, onToggle, onDelete, onSetFocus }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center text-[var(--muted)] text-[14px]">
        Nenhuma tarefa encontrada. Que tal esvaziar a mente no Brain Dump?
      </div>
    )
  }

  const focusTask = tasks.find(t => t.is_focus && !t.completed)
  const regularTasks = tasks.filter(t => !t.is_focus && !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  return (
    <div className={focusStyles.taskList}>
      {focusTask && (
        <div className="mb-4">
          <h4 className="text-[12px] font-bold text-[var(--text)] opacity-90 uppercase tracking-wider mb-2 px-1">Foco Principal</h4>
          <TaskItem
            task={focusTask}
            onToggle={onToggle}
            onDelete={onDelete}
            onSetFocus={onSetFocus}
          />
        </div>
      )}

      {regularTasks.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[12px] font-bold text-[var(--text)] opacity-70 uppercase tracking-wider mb-2 px-1">Para Fazer</h4>
          <div className="flex flex-col gap-2">
            {regularTasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onSetFocus={onSetFocus}
              />
            ))}
          </div>
        </div>
      )}

      {completedTasks.length > 0 && (
        <div>
          <h4 className="text-[12px] font-bold text-[var(--text)] opacity-50 uppercase tracking-wider mb-2 px-1">Concluídas</h4>
          <div className="flex flex-col gap-2 opacity-70">
            {completedTasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onSetFocus={onSetFocus}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
