import { useEffect, useState, useCallback } from 'react'
import { ListTodo } from 'lucide-react'
import { focusStyles } from '../../styles/focus'
import { FocusHeader } from './FocusHeader'
import { TaskList } from './TaskList'
import { QuickAdd } from './QuickAdd'
import { BrainDump } from './BrainDump'
import { BudsThink } from './BudsThink'
import { BudsInbox } from './BudsInbox'
import { ActivityTimeline } from './ActivityTimeline'
import type { FocusTask, FocusTaskCategory, FocusTaskPriority } from '../../types'
import { getFocusTasks, createFocusTask, updateFocusTask, deleteFocusTask } from '../../services/api'

interface FocusPageProps {
  visible: boolean
}

export function FocusPage({ visible }: FocusPageProps) {
  const [tasks, setTasks] = useState<FocusTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [inboxCount, setInboxCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await getFocusTasks()
      setTasks(data)
    } catch (err) {
      console.error('Falha ao carregar tasks', err)
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o Focus.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const timeout = window.setTimeout(() => void loadTasks(), 0)
    return () => window.clearTimeout(timeout)
  }, [visible, loadTasks])

  useEffect(() => {
    const refresh = () => { if (visible) void loadTasks() }
    window.addEventListener('buds-focus-refresh', refresh)
    return () => window.removeEventListener('buds-focus-refresh', refresh)
  }, [visible, loadTasks])

  const handleAddQuickTask = async (title: string, category: FocusTaskCategory, priority: FocusTaskPriority) => {
    try {
      const task = await createFocusTask(title, category, priority)
      setTasks(prev => [task, ...prev])
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao criar tarefa')
      throw err
    }
  }



  const handleToggleTask = async (id: number, completed: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed } : t))
    try {
      await updateFocusTask(id, { completed })
    } catch {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !completed } : t))
      alert('Falha ao atualizar tarefa')
    }
  }

  const handleDeleteTask = async (id: number) => {
    if (!confirm('Deseja apagar esta tarefa?')) return
    const original = tasks
    setTasks(prev => prev.filter(t => t.id !== id))
    try {
      await deleteFocusTask(id)
    } catch {
      setTasks(original)
      alert('Falha ao apagar tarefa')
    }
  }

  const handleSetFocus = async (id: number) => {
    const original = tasks
    setTasks(prev => prev.map(t => ({ ...t, is_focus: t.id === id })))
    try {
      await updateFocusTask(id, { is_focus: true })
    } catch {
      setTasks(original)
      alert('Falha ao atualizar foco')
    }
  }

  if (!visible) return null

  return (
    <section
      className={focusStyles.container}
      id="focus"
    >
      <div className={focusStyles.content}>
        <FocusHeader
          openCount={tasks.filter(task => !task.completed).length}
          completedToday={tasks.filter(task => task.completed && new Date(task.updated_at).toDateString() === new Date().toDateString()).length}
          inboxCount={inboxCount}
        />

        <div className="grid w-full min-w-0 max-w-full grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(290px,0.75fr)] lg:gap-5">
          {/* Main Column */}
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            <div className={focusStyles.card}>
              <div className="mb-1 flex items-center justify-between">
                <h3 className={focusStyles.cardTitle}>
                  <ListTodo size={18} className="text-[var(--text)] opacity-80" />
                  Tarefas
                </h3>
              </div>
              
              <QuickAdd onAdd={handleAddQuickTask} />

              {loading ? (
                <div className="py-8 text-center text-[var(--muted)] text-[14px]">Carregando...</div>
              ) : loadError ? (
                <div className={focusStyles.error} role="alert">
                  <strong className="block text-[14px]">O Focus não conseguiu abrir.</strong>
                  <span className="mt-1 block opacity-80">{loadError}</span>
                  <button type="button" className={focusStyles.retryButton} onClick={() => void loadTasks()}>
                    Tentar novamente
                  </button>
                </div>
              ) : (
                <div className="mt-2">
                  <TaskList
                    tasks={tasks}
                    onToggle={handleToggleTask}
                    onDelete={handleDeleteTask}
                    onSetFocus={handleSetFocus}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Side Column */}
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            <BrainDump onSuccess={loadTasks} />
          </div>
        </div>

        {/* Bottom Area */}
        <div className="flex min-w-0 w-full max-w-full flex-col gap-4 lg:gap-6">
          <BudsInbox
            onCountChange={setInboxCount}
            onChanged={() => {
              void loadTasks()
              setRefreshKey(key => key + 1)
            }}
          />
          <ActivityTimeline refreshKey={refreshKey} />
        </div>
      </div>
      
      {/* Floating Action Button for Think */}
      <BudsThink />
    </section>
  )
}
