import { useEffect, useRef } from 'react'
import { Search, Settings } from 'lucide-react'
import type { AiState } from '../types'

interface TopBarProps {
  aiState: AiState
  sessionTitle: string | null
  latency: string
  settingsOpen: boolean
  onToggleSettings: () => void
  searchQuery: string
  onSearchChange: (value: string) => void
}

const STATE_MAP: Record<AiState, { label: string; tone: string }> = {
  idle: { label: 'Aguardando', tone: 'muted' },
  listening: { label: 'Ouvindo', tone: 'cyan' },
  transcribing: { label: 'Transcrevendo', tone: 'amber' },
  thinking: { label: 'Pensando', tone: 'violet' },
  speaking: { label: 'Falando', tone: 'emerald' },
  error: { label: 'Erro', tone: 'rose' },
}

export function TopBar({
  aiState,
  sessionTitle,
  latency,
  settingsOpen,
  onToggleSettings,
  searchQuery,
  onSearchChange,
}: TopBarProps) {
  const stateInfo = STATE_MAP[aiState]
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div className="brand-copy">
          <strong>Nexus</strong>
          <span>Assistente v1</span>
        </div>
        <div className="session-chip">
          {sessionTitle || 'Sem sessao ativa'}
        </div>
      </div>

      <label className="command-search">
        <Search size={14} />
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar conversa"
        />
        <kbd>Ctrl K</kbd>
      </label>

      <div className="topbar-actions">
        <div className={`state-pill tone-${stateInfo.tone}`}>
          <span />
          {stateInfo.label}
        </div>

        {latency && <span className="latency-pill">{latency}</span>}

        <button
          className={`topbar-text-button ${settingsOpen ? 'is-active' : ''}`}
          type="button"
          onClick={onToggleSettings}
          aria-label="Alternar configuracoes"
          title="Configuracoes"
        >
          <Settings size={16} />
          <span>Configurações</span>
        </button>
      </div>
    </header>
  )
}
