import { Activity, AlertCircle, BrainCircuit, CheckCircle2, Circle, Cloud, CloudDownload, Cpu, Gauge, HardDrive, RefreshCw, SlidersHorizontal, Volume2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AiState, InterfaceSettings, SyncStatus, ThemeMode } from '../types'

interface StatusPanelProps {
  aiState: AiState
  sessionId: string | null
  msgCount: number
  latency: string
  model: string
  models: string[]
  googleSearchAvailable: boolean
  syncStatus: SyncStatus | null
  isSyncing: boolean
  settings: InterfaceSettings
  onModelChange: (model: string) => void
  onSyncNow: () => void
  onPullCloudChats: () => void
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

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
]

const MODEL_OPTIONS: Record<string, { label: string; hint: string }> = {
  'qwen2.5-coder:3b': { label: 'Rápido', hint: 'leve, responde mais rápido' },
  'qwen2.5-coder:7b': { label: 'Padrão', hint: 'equilíbrio entre velocidade e qualidade' },
  'qwen2.5-coder:14b': { label: 'Mais potente', hint: 'melhor raciocínio, exige mais do Mac' },
}

function formatSyncDate(value?: string | null) {
  if (!value) return 'Nunca'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nunca'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Gaveta de configurações da interface, voz, tema e status técnico da sessão.
export function StatusPanel({
  aiState,
  sessionId,
  msgCount,
  latency,
  model,
  models,
  googleSearchAvailable,
  syncStatus,
  isSyncing,
  settings,
  onModelChange,
  onSyncNow,
  onPullCloudChats,
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

        <div className="accent-picker theme-grid" aria-label="Tema do sistema">
          {THEME_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={`accent-swatch theme-swatch theme-${option.value} ${settings.theme === option.value ? 'is-active' : ''}`}
              onClick={() => onSettingChange('theme', option.value)}
              title={`Tema ${option.label}`}
            >
              <Circle size={13} />
              <span />
              {option.label}
            </button>
          ))}
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
          <span>Modelo da IA</span>
          <BrainCircuit size={15} />
        </div>
        <div className="settings-model-list" aria-label="Selecionar modelo da IA">
          {models.map(option => {
            const info = MODEL_OPTIONS[option] ?? { label: option, hint: 'modelo local do Ollama' }
            return (
              <button
                key={option}
                type="button"
                className={option === model ? 'is-active' : ''}
                onClick={() => onModelChange(option)}
              >
                <strong>{info.label}</strong>
                <span>{option}</span>
                <small>{info.hint}</small>
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel-block sync-panel-block">
        <div className="panel-heading">
          <span>Supabase Sync</span>
          <Cloud size={15} />
        </div>

        <div className="sync-status-card">
          <div className="sync-orb" data-state={syncStatus?.supabase_configured ? 'online' : 'offline'}>
            {syncStatus?.supabase_configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          </div>
          <div>
            <strong>{syncStatus?.supabase_configured ? 'Pronto para nuvem' : 'Apenas local'}</strong>
            <span>
              {syncStatus?.online_sync_enabled
                ? `Tabela ${syncStatus.remote_table}`
                : 'Sync desativado ou sem credenciais'}
            </span>
          </div>
        </div>

        <div className="sync-metrics-grid">
          <div>
            <HardDrive size={13} />
            <span>Registros locais</span>
            <strong>{syncStatus?.local_records?.total ?? 0}</strong>
          </div>
          <div>
            <Cloud size={13} />
            <span>Último sync</span>
            <strong>{formatSyncDate(syncStatus?.last_sync_at)}</strong>
          </div>
        </div>

        {syncStatus?.last_sync_error && (
          <p className="sync-error">{syncStatus.last_sync_error}</p>
        )}

        <button
          type="button"
          className="sync-now-button"
          onClick={onSyncNow}
          disabled={isSyncing || !syncStatus?.supabase_configured || !syncStatus?.online_sync_enabled}
        >
          <RefreshCw size={14} className={isSyncing ? 'is-spinning' : ''} />
          <span>{isSyncing ? 'Sincronizando' : 'Sincronizar agora'}</span>
        </button>

        <button
          type="button"
          className="sync-now-button sync-download-button"
          onClick={onPullCloudChats}
          disabled={isSyncing || !syncStatus?.supabase_configured || !syncStatus?.online_sync_enabled}
        >
          <CloudDownload size={14} />
          <span>{isSyncing ? 'Baixando' : 'Baixar chats da nuvem'}</span>
        </button>
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
