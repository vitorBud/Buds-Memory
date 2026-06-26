import { Activity, AlertCircle, BrainCircuit, CheckCircle2, Circle, Cloud, CloudDownload, Code2, Cpu, FolderOpen, Gauge, HardDrive, LogOut, RefreshCw, SlidersHorizontal, UserRound, Volume2, X } from 'lucide-react'
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
  presentation?: 'drawer' | 'page'
  children?: ReactNode
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
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

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; hint: string }> = [
  { value: 'black', label: 'Black', hint: 'foco noturno' },
  { value: 'gold', label: 'Gold', hint: 'destaque quente' },
  { value: 'silver', label: 'Silver', hint: 'neutro e suave' },
]

const MODEL_OPTIONS: Record<string, { label: string; hint: string }> = {
  'qwen2.5-coder:3b': { label: 'Rápido', hint: 'leve, responde mais rápido' },
  'qwen2.5-coder:7b': { label: 'Padrão', hint: 'equilíbrio entre velocidade e qualidade' },
  'qwen2.5-coder:14b': { label: 'Mais potente', hint: 'melhor raciocínio, exige mais do Mac' },
}

type SettingsSection = 'account' | 'appearance' | 'ai' | 'sync' | 'codebase' | 'memory' | 'system'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; hint: string; icon: typeof UserRound }> = [
  { id: 'account', label: 'Conta', hint: 'Login e sessão', icon: UserRound },
  { id: 'appearance', label: 'Aparência', hint: 'Tema e interface', icon: SlidersHorizontal },
  { id: 'ai', label: 'IA', hint: 'Modelo, voz e Google', icon: BrainCircuit },
  { id: 'sync', label: 'Sincronização', hint: 'Supabase e nuvem', icon: Cloud },
  { id: 'codebase', label: 'Codebase', hint: 'Projetos locais', icon: Code2 },
  { id: 'memory', label: 'Memória', hint: 'Contexto do chat', icon: Activity },
  { id: 'system', label: 'Sistema', hint: 'Pipeline e sessão', icon: Cpu },
]

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
  presentation = 'drawer',
  children,
}: StatusPanelProps) {
  const [codebasePath, setCodebasePath] = useState('')
  const [codebaseStatus, setCodebaseStatus] = useState('')
  const [isIndexingCodebase, setIsIndexingCodebase] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const isPage = presentation === 'page'
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

  const logout = () => {
    setRemoteSessionToken('')
    window.location.reload()
  }

  return (
    <aside className={`settings-panel ${isPage ? 'settings-panel-page' : ''}`} data-section={isPage ? activeSection : undefined}>
      <div className="settings-drawer-head">
        <div>
          <span className="eyebrow">{presentation === 'page' ? 'Painel Nexus' : 'Aba'}</span>
          <strong>{presentation === 'page' ? 'Configurações do sistema' : 'Configurações'}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar configurações" title="Fechar">
          <X size={16} />
        </button>
      </div>

      {isPage && (
        <nav className="settings-page-nav" aria-label="Categorias de configurações">
          {SETTINGS_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? 'is-active' : ''}
              onClick={() => setActiveSection(id)}
            >
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </nav>
      )}

      <div className="panel-block settings-interface-block">
        <div className="panel-heading">
          <span>Configurações da interface</span>
          <SlidersHorizontal size={15} />
        </div>
        <p className="settings-section-copy">
          Ajuste a aparência geral do Nexus e escolha quais elementos ficam visíveis durante o uso.
        </p>

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
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>

        <div className="toggle-stack">
          <ToggleRow
            label="Prompts rapidos"
            description="Mostra sugestões curtas para começar conversas mais rápido."
            checked={settings.showQuickPrompts}
            onChange={(checked) => onSettingChange('showQuickPrompts', checked)}
          />
          <ToggleRow
            label="Cérebro IA"
            description="Exibe visualizações do conhecimento salvo no Nexus."
            checked={settings.showBrainMap}
            onChange={(checked) => onSettingChange('showBrainMap', checked)}
          />
        </div>
      </div>

      <div className="panel-block settings-account-block">
        <div className="panel-heading">
          <span>Conta</span>
          <UserRound size={15} />
        </div>
        <p className="settings-section-copy">
          Controle a sessão atual. O modo Supabase libera sincronização entre dispositivos.
        </p>
        <div className="sync-status-card">
          <div className="sync-orb" data-state={authMode ? 'online' : 'offline'}>
            <UserRound size={16} />
          </div>
          <div>
            <strong>{authEmail || (authMode === 'local' ? 'Modo local' : 'Sessão Nexus')}</strong>
            <span>
              {authMode === 'supabase'
                ? 'Conta Supabase conectada'
                : authMode === 'local'
                  ? 'Dados salvos apenas neste dispositivo'
                  : 'Sessão ativa'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="account-logout-button"
          onClick={logout}
          title="Remove a sessão salva neste navegador ou app. Seus chats locais permanecem no banco local."
        >
          <LogOut size={14} />
          <span>Sair da conta</span>
        </button>
      </div>

      <div className="panel-block settings-model-block">
        <div className="panel-heading">
          <span>Modelo da IA</span>
          <BrainCircuit size={15} />
        </div>
        <p className="settings-section-copy">
          Escolha entre velocidade, equilíbrio e raciocínio mais pesado. Modelos maiores exigem mais do Mac.
        </p>
        <div className="toggle-stack">
          <ToggleRow
            label="Voz automática"
            description="Faz o Nexus falar as respostas quando possível."
            checked={settings.autoPlayAudio}
            onChange={(checked) => onSettingChange('autoPlayAudio', checked)}
          />
          <ToggleRow
            label="Buscar no Google"
            description="Permite consulta em tempo real quando a pergunta precisar de dados atuais."
            checked={settings.webSearchEnabled}
            onChange={(checked) => onSettingChange('webSearchEnabled', checked)}
          />
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

      <div className="panel-block settings-codebase-block">
        <div className="panel-heading">
          <span>Codebase</span>
          <Code2 size={15} />
        </div>
        <p className="settings-section-copy">
          Ensine uma pasta de projeto para o Nexus responder sobre arquivos, funções, rotas e dependências.
        </p>
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
          <button type="button" onClick={runCodebaseIndex} disabled={isIndexingCodebase} title="Lê arquivos do projeto e salva um índice local para perguntas de código.">
            <RefreshCw size={14} className={isIndexingCodebase ? 'is-spinning' : ''} />
            {isIndexingCodebase ? 'Indexando' : 'Indexar codebase'}
          </button>
          {codebaseStatus && <small>{codebaseStatus}</small>}
        </div>
      </div>

      <div className="panel-block sync-panel-block settings-sync-block">
        <div className="panel-heading">
          <span>Supabase Sync</span>
          <Cloud size={15} />
        </div>
        <p className="settings-section-copy">
          Envie e baixe chats da nuvem. Por segurança, a sincronização só fica ativa com login Supabase.
        </p>

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
            title="Volta para a tela de entrada para conectar uma conta Supabase."
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
          title="Envia dados locais e busca novos registros da sua conta Supabase."
        >
          <RefreshCw size={14} className={isSyncing ? 'is-spinning' : ''} />
          <span>{isSyncing ? 'Sincronizando' : 'Sincronizar agora'}</span>
        </button>

        <button
          type="button"
          className="sync-now-button sync-download-button"
          onClick={onPullCloudChats}
          disabled={syncUnavailable}
          title="Baixa conversas salvas na nuvem para este dispositivo."
        >
          <CloudDownload size={14} />
          <span>{isSyncing ? 'Baixando' : 'Baixar chats da nuvem'}</span>
        </button>
      </div>

      <div className="panel-block settings-session-block">
        <div className="panel-heading">
          <span>Sessao</span>
          <Activity size={15} />
        </div>
        <p className="settings-section-copy">
          Estado da conversa aberta agora, útil para conferir latência e atividade.
        </p>
        <div className="status-grid">
          <StatusLine label="Estado" value={aiState} />
          <StatusLine label="Mensagens" value={String(msgCount)} />
          <StatusLine label="Latencia" value={latency || '--'} />
          <StatusLine label="ID" value={sessionId ? `${sessionId.slice(0, 8)}...` : '--'} />
        </div>
      </div>

      <div className="panel-block settings-pipeline-block">
        <div className="panel-heading">
          <span>Pipeline</span>
          <Cpu size={15} />
        </div>
        <p className="settings-section-copy">
          Componentes que sustentam a experiência: modelo local, voz, transcrição e busca.
        </p>
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
