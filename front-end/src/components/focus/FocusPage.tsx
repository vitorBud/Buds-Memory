import { useEffect, useState, useCallback } from 'react'
import { ListTodo } from 'lucide-react'
import { motion } from 'framer-motion'
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

  const loadTasks = useCallback(async () => {
    try {
      const data = await getFocusTasks()
      setTasks(data)
    } catch (err) {
      console.error('Falha ao carregar tasks', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible && tasks.length === 0) {
      loadTasks()
    }
  }, [visible, tasks.length, loadTasks])

  const handleAddQuickTask = async (title: string, category: FocusTaskCategory, priority: FocusTaskPriority) => {
    try {
      const task = await createFocusTask(title, category, priority)
      setTasks(prev => [task, ...prev])
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao criar tarefa')
    }
  }



  const handleToggleTask = async (id: number, completed: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed } : t))
    try {
      await updateFocusTask(id, { completed })
    } catch (err) {
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
    } catch (err) {
      setTasks(original)
      alert('Falha ao apagar tarefa')
    }
  }

  const handleSetFocus = async (id: number) => {
    const original = tasks
    setTasks(prev => prev.map(t => ({ ...t, is_focus: t.id === id })))
    try {
      await updateFocusTask(id, { is_focus: true })
    } catch (err) {
      setTasks(original)
      alert('Falha ao atualizar foco')
    }
  }

  if (!visible) return null

  return (
    <motion.section
      className={focusStyles.container}
      id="focus"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
    >
      <div className={focusStyles.content}>
        <FocusHeader />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] items-start gap-6 w-full max-w-full">
          {/* Main Column */}
          <div className="flex flex-col gap-6 min-w-0">
            <div className={focusStyles.card}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={focusStyles.cardTitle}>
                  <ListTodo size={18} className="text-[var(--text)] opacity-80" />
                  Tarefas
                </h3>
              </div>
              
              <QuickAdd onAdd={handleAddQuickTask} />

              {loading ? (
                <div className="py-8 text-center text-[var(--muted)] text-[14px]">Carregando...</div>
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
          <div className="flex flex-col gap-6 min-w-0">
            <BrainDump onSuccess={loadTasks} />
          </div>
        </div>

        {/* Bottom Area */}
        <div className="flex flex-col gap-6 w-full max-w-full">
          <BudsInbox />
          <ActivityTimeline />
        </div>
      </div>
      
      {/* Floating Action Button for Think */}
      <BudsThink />
    </motion.section>
  )
}
