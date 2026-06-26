import { Activity, AlertCircle, BrainCircuit, CheckCircle2, Circle, Cloud, CloudDownload, Code2, Cpu, FolderOpen, Gauge, HardDrive, RefreshCw, SlidersHorizontal, Volume2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { indexCodebase, setRemoteSessionToken } from '../services/api'
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
  authMode?: string
  authEmail?: string
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

type NexusBridge = { pickFolder?: () => Promise<string | null>; isDesktop?: boolean }

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
  authMode,
  authEmail,
  settings,
  onModelChange,
  onSyncNow,
  onPullCloudChats,
  onSettingChange,
  onClose,
  children,
}: StatusPanelProps) {
  const [codebasePath, setCodebasePath] = useState('')
  const [codebaseStatus, setCodebaseStatus] = useState('')
  const [isIndexingCodebase, setIsIndexingCodebase] = useState(false)
  const isSupabaseSession = authMode === 'supabase'
  const syncConfigured = Boolean(syncStatus?.supabase_configured && syncStatus?.online_sync_enabled)
  const syncUnavailable = isSyncing || !syncConfigured || !isSupabaseSession

  const pickCodebaseFolder = async () => {
    const bridge = (window as unknown as { nexus?: NexusBridge }).nexus
    if (!bridge?.pickFolder) return
    const path = await bridge.pickFolder()
    if (path) setCodebasePath(path)
  }

  const runCodebaseIndex = async () => {
    const path = codebasePath.trim()
    if (!path) {
      setCodebaseStatus('Informe ou selecione uma pasta.')
      return
    }
    setIsIndexingCodebase(true)
    setCodebaseStatus('Indexando projeto...')
    try {
      const result = await indexCodebase(path)
      setCodebaseStatus(`${result.indexed_files} arquivos e ${result.indexed_rows} símbolos indexados.`)
    } catch (error) {
      setCodebaseStatus(error instanceof Error ? error.message : 'Não foi possível indexar a codebase.')
    } finally {
      setIsIndexingCodebase(false)
    }
  }

  const openSupabaseLogin = () => {
    setRemoteSessionToken('')
    window.location.reload()
  }

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

      <div className="panel-block">
        <div className="panel-heading">
          <span>Codebase</span>
          <Code2 size={15} />
        </div>
        <div className="codebase-index-card">
          <span>Ensinar um projeto ao Nexus</span>
          <div>
            <input
              type="text"
              value={codebasePath}
              onChange={(event) => setCodebasePath(event.target.value)}
              placeholder="/Users/vitor/projeto"
            />
            <button type="button" onClick={pickCodebaseFolder} title="Selecionar pasta">
              <FolderOpen size={14} />
            </button>
          </div>
          <button type="button" onClick={runCodebaseIndex} disabled={isIndexingCodebase}>
            <RefreshCw size={14} className={isIndexingCodebase ? 'is-spinning' : ''} />
            {isIndexingCodebase ? 'Indexando' : 'Indexar codebase'}
          </button>
          {codebaseStatus && <small>{codebaseStatus}</small>}
        </div>
      </div>

      <div className="panel-block sync-panel-block">
        <div className="panel-heading">
          <span>Supabase Sync</span>
          <Cloud size={15} />
        </div>

        <div className="sync-status-card">
          <div className="sync-orb" data-state={isSupabaseSession && syncStatus?.supabase_configured ? 'online' : 'offline'}>
            {isSupabaseSession && syncStatus?.supabase_configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          </div>
          <div>
            <strong>
              {!isSupabaseSession
                ? 'Login Supabase necessário'
                : syncStatus?.supabase_configured
                  ? 'Pronto para nuvem'
                  : 'Apenas local'}
            </strong>
            <span>
              {!isSupabaseSession
                ? 'Modo local não sincroniza. Entre com Supabase para liberar.'
                : syncStatus?.online_sync_enabled
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
        {!isSupabaseSession && (
          <p className="sync-error">
            Sessão atual: {authEmail || 'modo local'}. A sincronização fica bloqueada até entrar com Supabase.
          </p>
        )}
        {!isSupabaseSession && (
          <button
            type="button"
            className="sync-now-button sync-login-button"
            onClick={openSupabaseLogin}
          >
            <Cloud size={14} />
            <span>Entrar com Supabase</span>
          </button>
        )}

        <button
          type="button"
          className="sync-now-button"
          onClick={onSyncNow}
          disabled={syncUnavailable}
        >
          <RefreshCw size={14} className={isSyncing ? 'is-spinning' : ''} />
          <span>{isSyncing ? 'Sincronizando' : 'Sincronizar agora'}</span>
        </button>

        <button
          type="button"
          className="sync-now-button sync-download-button"
          onClick={onPullCloudChats}
          disabled={syncUnavailable}
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
