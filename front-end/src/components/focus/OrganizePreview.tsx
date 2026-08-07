import { useState } from 'react'
import { Sparkles, Check, X } from 'lucide-react'

import type { FocusTaskCategory, FocusTaskPriority } from '../../types'

interface OrganizePreviewProps {
  tasks: Array<{ title: string; category: FocusTaskCategory; priority: FocusTaskPriority }>
  onAccept: (tasks: Array<{ title: string; category: FocusTaskCategory; priority: FocusTaskPriority }>) => Promise<void>
  onReject: () => void
}

export function OrganizePreview({ tasks, onAccept, onReject }: OrganizePreviewProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAccept = async () => {
    setIsSubmitting(true)
    try {
      await onAccept(tasks)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-4 shadow-[0_0_20px_rgb(var(--accent-rgb)/0.15)]">
      <div className="flex items-center gap-2 mb-3 text-[var(--accent)]">
        <Sparkles size={16} />
        <h4 className="text-[14px] font-bold">Tarefas Extraídas</h4>
      </div>
      
      <div className="flex flex-col gap-2 mb-4 max-h-[200px] overflow-y-auto pr-1">
        {tasks.map((task, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-lg bg-black/20 p-2 text-[13px]">
            <span className="flex-1 text-white truncate">{task.title}</span>
            <span className="shrink-0 rounded px-1.5 py-0.5 bg-white/10 text-[10px] uppercase text-white/70">{task.category}</span>
            <span className="shrink-0 rounded px-1.5 py-0.5 bg-white/10 text-[10px] uppercase text-white/70">{task.priority}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onReject}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white/70 hover:bg-white/10 transition-colors"
        >
          <X size={14} />
          Descartar
        </button>
        <button
          onClick={handleAccept}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-bold text-white hover:opacity-90 shadow-lg shadow-[var(--accent)]/20 transition-all"
        >
          <Check size={14} />
          {isSubmitting ? 'Adicionando...' : 'Adicionar Tarefas'}
        </button>
      </div>
    </div>
  )
}
