import { useState } from 'react'
import { Sparkles, Loader2, Maximize } from 'lucide-react'
import { focusStyles } from '../../styles/focus'
import { FocusPreviewModal } from './FocusPreviewModal'
import type { FocusAnalyzePreview, FocusAnalyzeItem } from '../../types'
import { analyzeFocusInput, applyFocusItems } from '../../services/api'

interface FocusInputProps {
  onSuccess: () => void
}

export function BrainDump({ onSuccess }: FocusInputProps) {
  const [text, setText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [preview, setPreview] = useState<FocusAnalyzePreview | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  const handleProcess = async () => {
    const trimmed = text.trim()
    if (!trimmed || isProcessing) return

    setIsProcessing(true)
    setPreview(null)
    try {
      const data = await analyzeFocusInput(trimmed)
      setPreview(data)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao processar texto')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleApply = async (items: FocusAnalyzeItem[]) => {
    setIsApplying(true)
    try {
      await applyFocusItems(items)
      setPreview(null)
      setText('')
      onSuccess()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao aplicar ações')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className={focusStyles.card}>
      <h3 className={focusStyles.cardTitle}>
        <Maximize size={18} className="text-[var(--text)] opacity-80" />
        Atualizar meu Dia
      </h3>
      <p className="text-[13px] text-[var(--muted)] -mt-2">
        Escreva ideias, tarefas novas ou relate o que você concluiu. O Buds classificará e aplicará para você.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Terminei o relatório e tive uma ideia para o novo modo..."
        className={focusStyles.brainDumpArea}
        disabled={isProcessing || isApplying}
      />

      <button
        onClick={handleProcess}
        disabled={!text.trim() || isProcessing || isApplying}
        className={focusStyles.brainDumpBtn}
      >
        {isProcessing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Sparkles size={18} />
        )}
        {isProcessing ? 'Analisando...' : 'Processar com Buds'}
      </button>

      {preview && (
        <FocusPreviewModal
          preview={preview}
          onApply={handleApply}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  )
}
