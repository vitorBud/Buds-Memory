import { useState } from 'react'
import { Plus } from 'lucide-react'
import { focusStyles } from '../../styles/focus'
import type { FocusTaskCategory, FocusTaskPriority } from '../../types'

interface QuickAddProps {
  onAdd: (title: string, category: FocusTaskCategory, priority: FocusTaskPriority) => Promise<void>
}

export function QuickAdd({ onAdd }: QuickAddProps) {
  const [title, setTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onAdd(trimmed, 'other', 'medium')
      setTitle('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={focusStyles.taskInputWrapper}>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Adicionar nova tarefa..."
        className={focusStyles.taskInput}
        disabled={isSubmitting}
      />
      <button
        type="submit"
        disabled={!title.trim() || isSubmitting}
        className={focusStyles.taskAddBtn}
        title="Adicionar"
      >
        <Plus size={18} />
      </button>
    </form>
  )
}
