import { Activity, Cpu, Gauge, Moon, SlidersHorizontal, Sun, Volume2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AiState, InterfaceSettings } from '../types'

interface StatusPanelProps {
  aiState: AiState
  sessionId: string | null
  msgCount: number
  latency: string
  model: string
  googleSearchAvailable: boolean
  settings: InterfaceSettings
  onSettingChange: <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => void
  onClose: () => void
  children?: ReactNode
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  )
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Gaveta de configurações da interface, voz, tema e status técnico da sessão.
export function StatusPanel({
  aiState,
  sessionId,
  msgCount,
  latency,
  model,
  googleSearchAvailable,
  settings,
  onSettingChange,
  onClose,
  children,
}: StatusPanelProps) {
  return (
    <aside className="settings-panel">
      <div className="settings-drawer-head">
        <div>
          <span className="eyebrow">Aba</span>
          <strong>Configurações</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar configurações" title="Fechar">
          <X size={16} />
        </button>
      </div>

      <div className="panel-block">
        <div className="panel-heading">
          <span>Configurações da interface</span>
          <SlidersHorizontal size={15} />
        </div>

        <div className="segmented">
          <button
            type="button"
            className={settings.theme === 'dark' ? 'is-active' : ''}
            onClick={() => onSettingChange('theme', 'dark')}
          >
            <Moon size={14} />
            Escuro
          </button>
          <button
            type="button"
            className={settings.theme === 'light' ? 'is-active' : ''}
            onClick={() => onSettingChange('theme', 'light')}
          >
            <Sun size={14} />
            Claro
          </button>
        </div>

        <div className="toggle-stack">
          <ToggleRow
            label="Prompts rapidos"
            checked={settings.showQuickPrompts}
            onChange={(checked) => onSettingChange('showQuickPrompts', checked)}
          />
          <ToggleRow
            label="Cérebro IA"
            checked={settings.showBrainMap}
            onChange={(checked) => onSettingChange('showBrainMap', checked)}
          />
          <ToggleRow
            label="Voz automática"
            checked={settings.autoPlayAudio}
            onChange={(checked) => onSettingChange('autoPlayAudio', checked)}
          />
          <ToggleRow
            label="Buscar no Google"
            checked={settings.webSearchEnabled}
            onChange={(checked) => onSettingChange('webSearchEnabled', checked)}
          />
        </div>
      </div>

      <div className="panel-block">
        <div className="panel-heading">
          <span>Sessao</span>
          <Activity size={15} />
        </div>
        <div className="status-grid">
          <StatusLine label="Estado" value={aiState} />
          <StatusLine label="Mensagens" value={String(msgCount)} />
          <StatusLine label="Latencia" value={latency || '--'} />
          <StatusLine label="ID" value={sessionId ? `${sessionId.slice(0, 8)}...` : '--'} />
        </div>
      </div>

      <div className="panel-block">
        <div className="panel-heading">
          <span>Pipeline</span>
          <Cpu size={15} />
        </div>
        <div className="pipeline-list">
          <div>
            <Cpu size={14} />
            <span>LLM</span>
            <strong>{model}</strong>
          </div>
          <div>
            <Gauge size={14} />
            <span>STT</span>
            <strong>Whisper</strong>
          </div>
          <div>
            <Volume2 size={14} />
            <span>TTS</span>
            <strong>Piper</strong>
          </div>
          <div>
            <Gauge size={14} />
            <span>Google</span>
            <strong>{googleSearchAvailable ? 'Pronto' : 'Sem chave'}</strong>
          </div>
        </div>
      </div>

      {children}
    </aside>
  )
}
