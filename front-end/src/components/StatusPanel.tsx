import { Activity, BrainCircuit, Circle, CloudDownload, Code2, Copy, Cpu, ExternalLink, FolderOpen, Gauge, HardDrive, RefreshCw, SlidersHorizontal, Smartphone, Upload, UserRound, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { indexCodebase } from '../services/api'
import type { AiState, BackendConfig, InterfaceSettings, LocalBackupStatus, ThemeMode } from '../types'

interface StatusPanelProps {
  aiState: AiState
  sessionId: string | null
  msgCount: number
  latency: string
  model: string
  models: string[]
  googleSearchAvailable: boolean
  backendConfig: BackendConfig | null
  backupStatus: LocalBackupStatus | null
  isBackupBusy: boolean
  authMode?: string
  authEmail?: string
  settings: InterfaceSettings
  onModelChange: (model: string) => void
  onExportBackup: () => void
  onImportBackup: (file: File) => void
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

function buildSmartphoneUrl(config: BackendConfig | null) {
  const remoteUrl = config?.remote?.recommended_url || ''
  const fallback = window.location.href

  try {
    const current = new URL(window.location.href)
    const currentIsShareable = !['localhost', '127.0.0.1', '0.0.0.0'].includes(current.hostname)
    const base = currentIsShareable ? current.origin : remoteUrl || current.origin
    const url = new URL(base)
    if (current.pathname && current.pathname !== '/') url.pathname = current.pathname
    url.search = current.search
    url.hash = current.hash
    return url.toString()
  } catch {
    return remoteUrl || fallback
  }
}

function copyText(value: string) {
  if (!value) return Promise.resolve()
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
  return Promise.resolve()
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

const VOICE_PROVIDER_OPTIONS: Array<{
  value: InterfaceSettings['voiceProvider']
  label: string
  hint: string
}> = [
  { value: 'browser', label: 'Navegador', hint: 'usa as vozes instaladas no Mac, Safari ou Chrome' },
  { value: 'piper', label: 'Piper local', hint: 'gera áudio offline no backend com a voz pt-BR instalada' },
]

type SettingsSection = 'account' | 'appearance' | 'ai' | 'backup' | 'codebase' | 'memory' | 'system'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; hint: string; icon: typeof UserRound }> = [
  { id: 'account', label: 'Sessão', hint: 'Banco local', icon: UserRound },
  { id: 'appearance', label: 'Aparência', hint: 'Tema e interface', icon: SlidersHorizontal },
  { id: 'ai', label: 'IA', hint: 'Modelo, voz e Google', icon: BrainCircuit },
  { id: 'backup', label: 'Backup', hint: 'Memória local', icon: HardDrive },
  { id: 'codebase', label: 'Codebase', hint: 'Projetos locais', icon: Code2 },
  { id: 'memory', label: 'Memória', hint: 'Contexto do chat', icon: Activity },
  { id: 'system', label: 'Sistema', hint: 'Pipeline e sessão', icon: Cpu },
]

type AetherBridge = {
  pickFolder?: () => Promise<string | null>
  getRemoteToken?: () => Promise<string>
  isDesktop?: boolean
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
  backendConfig,
  backupStatus,
  isBackupBusy,
  authMode,
  authEmail,
  settings,
  onModelChange,
  onExportBackup,
  onImportBackup,
  onSettingChange,
  onClose,
  presentation = 'drawer',
  children,
}: StatusPanelProps) {
  const [codebasePath, setCodebasePath] = useState('')
  const [codebaseStatus, setCodebaseStatus] = useState('')
  const [isIndexingCodebase, setIsIndexingCodebase] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const [mobileCopyLabel, setMobileCopyLabel] = useState('')
  const [desktopRemoteToken, setDesktopRemoteToken] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)
  const isPage = presentation === 'page'
  const smartphoneUrl = buildSmartphoneUrl(backendConfig)

  useEffect(() => {
    const bridge = (window as unknown as { nexus?: AetherBridge }).nexus
    if (!backendConfig?.remote?.remote_mode || !bridge?.getRemoteToken) {
      return
    }
    let cancelled = false
    void bridge.getRemoteToken().then(token => {
      if (!cancelled) setDesktopRemoteToken(token)
    }).catch(() => {
      if (!cancelled) setDesktopRemoteToken('')
    })
    return () => {
      cancelled = true
    }
  }, [backendConfig?.remote?.remote_mode])

  const handleMobileCopy = async (value: string, label: string) => {
    await copyText(value)
    setMobileCopyLabel(label)
    window.setTimeout(() => setMobileCopyLabel(''), 1600)
  }

  const pickCodebaseFolder = async () => {
    const bridge = (window as unknown as { nexus?: AetherBridge }).nexus
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

  return (
    <aside className={`settings-panel ${isPage ? 'settings-panel-page' : ''}`} data-section={isPage ? activeSection : undefined}>
      <div className="settings-drawer-head">
        <div>
          <span className="eyebrow">{presentation === 'page' ? 'Painel Aether' : 'Aba'}</span>
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
          Ajuste a aparência geral do Aether Memory e escolha quais elementos ficam visíveis durante o uso.
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
            description="Exibe visualizações do conhecimento salvo no Aether Memory."
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
          O Aether Memory usa banco local. Seus chats, PDFs, memórias e grafo ficam neste dispositivo até você exportar um backup.
        </p>
        <div className="sync-status-card">
          <div className="sync-orb" data-state={authMode ? 'online' : 'offline'}>
            <UserRound size={16} />
          </div>
          <div>
            <strong>{authEmail || (authMode === 'local' ? 'Modo local' : 'Sessão Aether')}</strong>
            <span>
              {authMode === 'remote'
                ? 'Acesso remoto protegido por token'
                : 'Dados salvos no SQLite local'}
            </span>
          </div>
        </div>
        <div className="smartphone-access-card">
          <div className="smartphone-access-head">
            <span>
              <Smartphone size={16} />
              <strong>Abra no seu smartphone</strong>
            </span>
            <small>
              {backendConfig?.remote?.remote_mode
                ? 'Acesso remoto ativo'
                : 'Use com backend em modo mobile/remoto'}
            </small>
          </div>

          <div className="smartphone-access-field">
            <span>Link atual</span>
            <code>{smartphoneUrl}</code>
            <div>
              <button type="button" onClick={() => handleMobileCopy(smartphoneUrl, 'link')}>
                <Copy size={13} />
                Copiar
              </button>
              <a href={smartphoneUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />
                Abrir
              </a>
            </div>
          </div>

          {backendConfig?.remote?.remote_mode && desktopRemoteToken && (
            <div className="smartphone-access-field">
              <span>Token local do app</span>
              <code>{desktopRemoteToken}</code>
              <div>
                <button
                  type="button"
                  onClick={() => handleMobileCopy(desktopRemoteToken, 'token')}
                >
                  <Copy size={13} />
                  Copiar
                </button>
              </div>
            </div>
          )}

          <p>
            No celular, abra o link e cole o token configurado no backend quando a tela pedir acesso remoto.
            {mobileCopyLabel && (
              <strong> {mobileCopyLabel === 'token' ? 'Token copiado.' : 'Link copiado.'}</strong>
            )}
          </p>
        </div>
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
            description="Faz o Aether falar as respostas quando possível."
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
        <div className="settings-voice-provider" aria-label="Selecionar motor de voz">
          {VOICE_PROVIDER_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={settings.voiceProvider === option.value ? 'is-active' : ''}
              onClick={() => onSettingChange('voiceProvider', option.value)}
            >
              <Volume2 size={15} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </button>
          ))}
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
          Ensine uma pasta de projeto para o Aether Memory responder sobre arquivos, funções, rotas e dependências.
        </p>
        <div className="codebase-index-card">
          <span>Ensinar um projeto ao Aether</span>
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

      <div className="panel-block sync-panel-block settings-sync-block settings-backup-block">
        <div className="panel-heading">
          <span>Backup local</span>
          <HardDrive size={15} />
        </div>
        <p className="settings-section-copy">
          Baixe um arquivo com toda a memória do Aether ou insira esse backup em outro Mac/sistema para continuar com o mesmo histórico.
        </p>

        <div className="sync-status-card">
          <div className="sync-orb" data-state="online">
            <HardDrive size={16} />
          </div>
          <div>
            <strong>Memória portátil</strong>
            <span>Exportação local em JSON. Nenhuma conta externa necessária.</span>
          </div>
        </div>

        <div className="sync-metrics-grid">
          <div>
            <HardDrive size={13} />
            <span>Registros locais</span>
            <strong>{backupStatus?.local_records?.total ?? 0}</strong>
          </div>
          <div>
            <BrainCircuit size={13} />
            <span>Modo</span>
            <strong>Local</strong>
          </div>
        </div>

        {backupStatus?.last_backup_error && (
          <p className="sync-error">{backupStatus.last_backup_error}</p>
        )}

        <button
          type="button"
          className="sync-now-button"
          onClick={onExportBackup}
          disabled={isBackupBusy}
          title="Baixa um backup completo da memória local do Aether."
        >
          <CloudDownload size={14} />
          <span>{isBackupBusy ? 'Preparando backup' : 'Baixar memória'}</span>
        </button>

        <button
          type="button"
          className="sync-now-button sync-download-button"
          onClick={() => backupInputRef.current?.click()}
          disabled={isBackupBusy}
          title="Insere um backup exportado anteriormente, sem apagar os dados locais atuais."
        >
          <Upload size={14} />
          <span>{isBackupBusy ? 'Importando' : 'Inserir backup'}</span>
        </button>
        <input
          ref={backupInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportBackup(file)
          }}
        />
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
