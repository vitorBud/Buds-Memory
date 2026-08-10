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
  const open = tasks.filter(t => !t.is_focus && !t.completed)
  const completedTasks = tasks.filter(t => t.completed).slice(0, 8)
  const todayKey = new Date().toDateString()
  const hasDueToday = (task: FocusTask) => task.due_date ? new Date(task.due_date).toDateString() === todayKey : false
  const todayTasks = open.filter(hasDueToday)
  const upcomingTasks = open.filter(task => task.due_date && !hasDueToday(task))
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
  const unscheduledTasks = open.filter(task => !task.due_date)
  const section = (title: string, items: FocusTask[]) => items.length > 0 && (
    <div className="mb-4" key={title}>
      <h4 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-wider text-[var(--text)] opacity-70">{title}</h4>
      <div className="flex flex-col gap-2">
        {items.map(task => <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} onSetFocus={onSetFocus} />)}
      </div>
    </div>
  )

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

      {section('Hoje', todayTasks)}
      {section('Próximos', upcomingTasks)}
      {section('Sem data', unscheduledTasks)}

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
