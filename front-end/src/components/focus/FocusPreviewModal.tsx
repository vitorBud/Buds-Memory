import type { FocusAnalyzePreview, FocusAnalyzeItem } from '../../types'
import { Check, Plus, Lightbulb, SplitSquareVertical, MessageSquare, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'

interface FocusPreviewModalProps {
  preview: FocusAnalyzePreview
  onApply: (items: FocusAnalyzeItem[]) => void
  onCancel: () => void
}

export function FocusPreviewModal({ preview, onApply, onCancel }: FocusPreviewModalProps) {
  const getIcon = (type: string) => {
    switch (type) {
      case 'TASK': return <Plus size={16} className="text-emerald-400" />
      case 'UPDATE': return <Check size={16} className="text-blue-400" />
      case 'IDEA': return <Lightbulb size={16} className="text-amber-400" />
      case 'DECISION': return <SplitSquareVertical size={16} className="text-purple-400" />
      case 'NOTE': return <MessageSquare size={16} className="text-zinc-400" />
      default: return <X size={16} className="text-red-400" />
    }
  }

  const validItems = preview.items.filter(i => i.type !== 'IGNORE')

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-center justify-center overflow-y-auto bg-black/55 pl-[max(14px,env(safe-area-inset-left))] pr-[max(14px,env(safe-area-inset-right))] pt-[calc(14px+env(safe-area-inset-top))] pb-[calc(14px+env(safe-area-inset-bottom))] backdrop-blur-sm platform-ios:backdrop-blur-none">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="flex w-full max-w-lg max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-28px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111111] shadow-2xl platform-ios:shadow-none"
      >
        <div className="p-5 border-b border-white/5 flex items-center justify-between shrink-0">
          <h3 className="text-[15px] font-medium text-white flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-400" />
            Análise do Buds
          </h3>
          <button onClick={onCancel} className="text-white/40 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          {validItems.length === 0 ? (
            <div className="text-center text-white/50 py-8 text-[14px]">
              O Buds não identificou ações claras nesta atualização.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {validItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="mt-0.5">{getIcon(item.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-white/90 leading-snug">{item.content}</div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                        {item.type}
                      </span>
                      {item.category && (
                        <span className="text-[10px] uppercase tracking-wider text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                          {item.category}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/5 bg-black/20 p-4 min-[420px]:gap-3 min-[420px]:p-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-medium text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            Descartar
          </button>
          <button
            onClick={() => onApply(validItems)}
            disabled={validItems.length === 0}
            className="px-5 py-2 text-[13px] font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-colors disabled:opacity-50"
          >
            Confirmar e Aplicar
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
