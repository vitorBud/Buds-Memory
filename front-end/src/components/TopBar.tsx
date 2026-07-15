import { useEffect, useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen, Settings, Square } from 'lucide-react'

interface TopBarProps {
  sessionTitle: string | null
  latency: string
  historyHidden: boolean
  onToggleHistory: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
  canStopOutput: boolean
  onStopOutput: () => void
}

// Barra superior mínima do chat, mantendo só estado, histórico, parar e configurações.
export function TopBar({
  historyHidden,
  onToggleHistory,
  settingsOpen,
  onToggleSettings,
  canStopOutput,
  onStopOutput,
}: TopBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        settingsButtonRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-actions">
        {canStopOutput && (
          <button
            className="topbar-text-button stop-output-button"
            type="button"
            onClick={onStopOutput}
            aria-label="Parar resposta e voz"
            title="Parar resposta e voz"
          >
            <Square size={14} />
            <span>Parar</span>
          </button>
        )}

        <button
          className={`topbar-text-button ${historyHidden ? 'is-active' : ''}`}
          type="button"
          onClick={onToggleHistory}
          aria-label={historyHidden ? 'Mostrar histórico' : 'Ocultar histórico'}
          title={historyHidden ? 'Mostrar histórico' : 'Ocultar histórico'}
        >
          {historyHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <button
          ref={settingsButtonRef}
          className={`topbar-text-button ${settingsOpen ? 'is-active' : ''}`}
          type="button"
          onClick={onToggleSettings}
          aria-label="Alternar configuracoes"
          title="Configuracoes"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
