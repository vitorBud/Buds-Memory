import { Activity, BrainCircuit, Circle, CloudDownload, Code2, Copy, Cpu, ExternalLink, FolderOpen, Gauge, HardDrive, RefreshCw, SlidersHorizontal, Smartphone, Upload, UserRound, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { indexCodebase } from '../services/api'
import { settingsControlStyles, themeDotStyles } from '../styles/controlesConfiguracoes'
import { settingsLayoutStyles, settingsSectionStyles } from '../styles/estruturaConfiguracoes'
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
    <label className={settingsControlStyles.toggleRow}>
      <span className={settingsControlStyles.toggleCopy}>
        <strong className={settingsControlStyles.toggleLabel}>{label}</strong>
        {description && <small className={settingsControlStyles.toggleDescription}>{description}</small>}
      </span>
      <input
        className={settingsControlStyles.toggleInput}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className={settingsControlStyles.toggleSwitch} />
    </label>
  )
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className={settingsControlStyles.technicalLine}>
      <span className={settingsControlStyles.technicalLabel}>{label}</span>
      <strong className={settingsControlStyles.technicalValue}>{value}</strong>
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

type PublicThemeMode = Extract<ThemeMode, 'black' | 'gold' | 'silver'>

const THEME_OPTIONS: Array<{ value: PublicThemeMode; label: string; hint: string }> = [
  { value: 'black', label: 'Black', hint: 'foco noturno' },
  { value: 'gold', label: 'Gold', hint: 'destaque quente' },
  { value: 'silver', label: 'Silver', hint: 'neutro e suave' },
]

const MODEL_OPTIONS: Record<string, { label: string; hint: string }> = {
  'qwen2.5-coder:3b': { label: 'Rápido', hint: 'leve, responde mais rápido' },
  'qwen2.5-coder:7b': { label: 'Padrão', hint: 'equilíbrio entre velocidade e qualidade' },
  'qwen2.5-coder:14b': { label: 'Mais potente', hint: 'melhor raciocínio, exige mais do computador' },
}

const VOICE_PROVIDER_OPTIONS: Array<{
  value: InterfaceSettings['voiceProvider']
  label: string
  hint: string
}> = [
  { value: 'browser', label: 'Navegador', hint: 'usa as vozes instaladas no sistema, Safari ou Chrome' },
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
  children,
}: StatusPanelProps) {
  const [codebasePath, setCodebasePath] = useState('')
  const [codebaseStatus, setCodebaseStatus] = useState('')
  const [isIndexingCodebase, setIsIndexingCodebase] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const [mobileCopyLabel, setMobileCopyLabel] = useState('')
  const [desktopRemoteToken, setDesktopRemoteToken] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)
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
    <aside className={settingsLayoutStyles.pagePanel}>
      <div className={settingsLayoutStyles.header}>
        <div className={settingsLayoutStyles.headerCopy}>
          <span className={settingsLayoutStyles.eyebrow}>Painel Aether</span>
          <strong className={settingsLayoutStyles.title}>
            Configurações do sistema
          </strong>
        </div>
        <button
          type="button"
          className={settingsLayoutStyles.close}
          onClick={onClose}
          aria-label="Fechar configurações"
          title="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      <nav className={settingsLayoutStyles.nav} aria-label="Categorias de configurações">
        {SETTINGS_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`${settingsLayoutStyles.navButton} ${activeSection === id ? settingsLayoutStyles.navButtonActive : ''}`}
            onClick={() => setActiveSection(id)}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            <Icon
              size={17}
              className={`${settingsLayoutStyles.navIcon} ${activeSection === id ? settingsLayoutStyles.navIconActive : ''}`}
            />
            <span className={settingsLayoutStyles.navCopy}>
              <strong className={settingsLayoutStyles.navLabel}>{label}</strong>
              <small className={settingsLayoutStyles.navHint}>{hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className={`${settingsLayoutStyles.content} ${settingsSectionStyles[activeSection]}`}>
      <div className="settings-section settings-interface-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Configurações da interface</span>
          <SlidersHorizontal size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Ajuste a aparência geral do Aether Memory e escolha quais elementos ficam visíveis durante o uso.
        </p>

        <div className={settingsControlStyles.themeGrid} aria-label="Tema do sistema">
          {THEME_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={`${settingsControlStyles.themeButton} ${settings.theme === option.value ? settingsControlStyles.themeButtonActive : ''}`}
              onClick={() => onSettingChange('theme', option.value)}
              title={`Tema ${option.label}`}
            >
              <Circle size={13} className={settingsControlStyles.themeIcon} />
              <span className={`${settingsControlStyles.themeDot} ${themeDotStyles[option.value]}`} />
              <strong className={settingsControlStyles.themeLabel}>{option.label}</strong>
              <small className={settingsControlStyles.themeHint}>{option.hint}</small>
            </button>
          ))}
        </div>

        <div className={settingsControlStyles.toggleStack}>
          <ToggleRow
            label="Prompts rápidos"
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

      <div className="settings-section settings-account-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Conta</span>
          <UserRound size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          O Aether Memory usa banco local. Seus chats, PDFs, memórias e grafo ficam neste dispositivo até você exportar um backup.
        </p>
        <div className={settingsControlStyles.statusCard}>
          <div
            className={`${settingsControlStyles.statusOrb} ${authMode ? settingsControlStyles.statusOrbOnline : settingsControlStyles.statusOrbOffline}`}
          >
            <UserRound size={16} />
          </div>
          <div className={settingsControlStyles.statusCardCopy}>
            <strong className={settingsControlStyles.statusCardLabel}>
              {authEmail || (authMode === 'local' ? 'Modo local' : 'Sessão Aether')}
            </strong>
            <span className={settingsControlStyles.statusCardHint}>
              {authMode === 'remote'
                ? 'Acesso remoto protegido por token'
                : 'Dados salvos no SQLite local'}
            </span>
          </div>
        </div>
        <div className={settingsControlStyles.smartphoneCard}>
          <div className={settingsControlStyles.smartphoneHead}>
            <span className={settingsControlStyles.smartphoneTitle}>
              <Smartphone size={16} />
              <strong>Abra no seu smartphone</strong>
            </span>
            <small className={settingsControlStyles.smartphoneState}>
              {backendConfig?.remote?.remote_mode
                ? 'Acesso remoto ativo'
                : 'Use com backend em modo mobile/remoto'}
            </small>
          </div>

          <div className={settingsControlStyles.smartphoneField}>
            <span className={settingsControlStyles.smartphoneFieldLabel}>Link atual</span>
            <code className={settingsControlStyles.smartphoneCode}>{smartphoneUrl}</code>
            <div className={settingsControlStyles.smartphoneActions}>
              <button
                type="button"
                className={settingsControlStyles.smartphoneAction}
                onClick={() => handleMobileCopy(smartphoneUrl, 'link')}
              >
                <Copy size={13} />
                Copiar
              </button>
              <a
                className={settingsControlStyles.smartphoneAction}
                href={smartphoneUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                Abrir
              </a>
            </div>
          </div>

          {backendConfig?.remote?.remote_mode && desktopRemoteToken && (
            <div className={settingsControlStyles.smartphoneField}>
              <span className={settingsControlStyles.smartphoneFieldLabel}>Token local do app</span>
              <code className={settingsControlStyles.smartphoneCode}>{desktopRemoteToken}</code>
              <div className={settingsControlStyles.smartphoneActions}>
                <button
                  type="button"
                  className={settingsControlStyles.smartphoneAction}
                  onClick={() => handleMobileCopy(desktopRemoteToken, 'token')}
                >
                  <Copy size={13} />
                  Copiar
                </button>
              </div>
            </div>
          )}

          <p className={settingsControlStyles.smartphoneHelp}>
            No celular, abra o link e cole o token configurado no backend quando a tela pedir acesso remoto.
            {mobileCopyLabel && (
              <strong> {mobileCopyLabel === 'token' ? 'Token copiado.' : 'Link copiado.'}</strong>
            )}
          </p>
        </div>
      </div>

      <div className="settings-section settings-model-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Modelo da IA</span>
          <BrainCircuit size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Escolha entre velocidade, equilíbrio e raciocínio mais pesado. Modelos maiores exigem mais do computador.
        </p>
        <div className={settingsControlStyles.toggleStack}>
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
        <div className={settingsControlStyles.optionGrid} aria-label="Selecionar motor de voz">
          {VOICE_PROVIDER_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={`${settingsControlStyles.optionButton} ${settings.voiceProvider === option.value ? settingsControlStyles.optionButtonActive : ''}`}
              onClick={() => onSettingChange('voiceProvider', option.value)}
            >
              <Volume2 size={15} className={settingsControlStyles.optionIcon} />
              <span className={settingsControlStyles.optionCopy}>
                <strong className={settingsControlStyles.optionLabel}>{option.label}</strong>
                <small className={settingsControlStyles.optionHint}>{option.hint}</small>
              </span>
            </button>
          ))}
        </div>
        <div className={settingsControlStyles.modelGrid} aria-label="Selecionar modelo da IA">
          {models.map(option => {
            const info = MODEL_OPTIONS[option] ?? { label: option, hint: 'modelo local do Ollama' }
            return (
              <button
                key={option}
                type="button"
                className={`${settingsControlStyles.modelButton} ${option === model ? settingsControlStyles.modelButtonActive : ''}`}
                onClick={() => onModelChange(option)}
              >
                <strong className={settingsControlStyles.modelLabel}>{info.label}</strong>
                <span className={settingsControlStyles.modelRuntime}>{option}</span>
                <small className={settingsControlStyles.modelHint}>{info.hint}</small>
              </button>
            )
          })}
        </div>
      </div>

      <div className="settings-section settings-codebase-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Codebase</span>
          <Code2 size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Ensine uma pasta de projeto para o Aether Memory responder sobre arquivos, funções, rotas e dependências.
        </p>
        <div className={settingsControlStyles.codebaseCard}>
          <span className={settingsControlStyles.codebaseTitle}>Ensinar um projeto ao Aether</span>
          <div className={settingsControlStyles.codebaseInputRow}>
            <input
              className={settingsControlStyles.codebaseInput}
              type="text"
              value={codebasePath}
              onChange={(event) => setCodebasePath(event.target.value)}
              placeholder="Caminho da pasta do projeto"
            />
            <button
              type="button"
              className={settingsControlStyles.codebaseButton}
              onClick={pickCodebaseFolder}
              title="Selecionar pasta"
            >
              <FolderOpen size={14} />
            </button>
          </div>
          <button
            type="button"
            className={settingsControlStyles.codebaseButton}
            onClick={runCodebaseIndex}
            disabled={isIndexingCodebase}
            title="Lê arquivos do projeto e salva um índice local para perguntas de código."
          >
            <RefreshCw size={14} className={isIndexingCodebase ? 'animate-spin' : ''} />
            {isIndexingCodebase ? 'Indexando' : 'Indexar codebase'}
          </button>
          {codebaseStatus && <small className={settingsControlStyles.codebaseStatus}>{codebaseStatus}</small>}
        </div>
      </div>

      <div className="settings-section settings-backup-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Backup local</span>
          <HardDrive size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Baixe um arquivo com toda a memória do Aether ou insira esse backup em outro computador para continuar com o mesmo histórico.
        </p>

        <div className={settingsControlStyles.statusCard}>
          <div
            className={`${settingsControlStyles.statusOrb} ${settingsControlStyles.statusOrbOnline}`}
          >
            <HardDrive size={16} />
          </div>
          <div className={settingsControlStyles.statusCardCopy}>
            <strong className={settingsControlStyles.statusCardLabel}>Memória portátil</strong>
            <span className={settingsControlStyles.statusCardHint}>
              Exportação local em JSON. Nenhuma conta externa necessária.
            </span>
          </div>
        </div>

        <div className={settingsControlStyles.metricsGrid}>
          <div className={settingsControlStyles.metric}>
            <HardDrive size={13} />
            <span className={settingsControlStyles.metricLabel}>Registros locais</span>
            <strong className={settingsControlStyles.metricValue}>{backupStatus?.local_records?.total ?? 0}</strong>
          </div>
          <div className={settingsControlStyles.metric}>
            <BrainCircuit size={13} />
            <span className={settingsControlStyles.metricLabel}>Modo</span>
            <strong className={settingsControlStyles.metricValue}>Local</strong>
          </div>
        </div>

        {backupStatus?.last_backup_error && (
          <p className={settingsControlStyles.error}>{backupStatus.last_backup_error}</p>
        )}

        <button
          type="button"
          className={settingsControlStyles.primaryButton}
          onClick={onExportBackup}
          disabled={isBackupBusy}
          title="Baixa um backup completo da memória local do Aether."
        >
          <CloudDownload size={14} />
          <span>{isBackupBusy ? 'Preparando backup' : 'Baixar memória'}</span>
        </button>

        <button
          type="button"
          className={`${settingsControlStyles.primaryButton} ${settingsControlStyles.secondaryButton}`}
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

      <div className="settings-section settings-session-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Sessão</span>
          <Activity size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Estado da conversa aberta agora, útil para conferir latência e atividade.
        </p>
        <div className={settingsControlStyles.technicalGrid}>
          <StatusLine label="Estado" value={aiState} />
          <StatusLine label="Mensagens" value={String(msgCount)} />
          <StatusLine label="Latência" value={latency || '--'} />
          <StatusLine label="ID" value={sessionId ? `${sessionId.slice(0, 8)}...` : '--'} />
        </div>
      </div>

      <div className="settings-section settings-pipeline-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Pipeline</span>
          <Cpu size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Componentes que sustentam a experiência: modelo local, voz, transcrição e busca.
        </p>
        <div className={settingsControlStyles.technicalGrid}>
          <div className={settingsControlStyles.pipelineLine}>
            <Cpu size={14} />
            <span className={settingsControlStyles.technicalLabel}>LLM</span>
            <strong className={settingsControlStyles.technicalValue}>{model}</strong>
          </div>
          <div className={settingsControlStyles.pipelineLine}>
            <Gauge size={14} />
            <span className={settingsControlStyles.technicalLabel}>STT</span>
            <strong className={settingsControlStyles.technicalValue}>Whisper</strong>
          </div>
          <div className={settingsControlStyles.pipelineLine}>
            <Volume2 size={14} />
            <span className={settingsControlStyles.technicalLabel}>TTS</span>
            <strong className={settingsControlStyles.technicalValue}>Piper</strong>
          </div>
          <div className={settingsControlStyles.pipelineLine}>
            <Gauge size={14} />
            <span className={settingsControlStyles.technicalLabel}>Google</span>
            <strong className={settingsControlStyles.technicalValue}>
              {googleSearchAvailable ? 'Pronto' : 'Sem chave'}
            </strong>
          </div>
        </div>
      </div>

      {children}
      </div>
    </aside>
  )
}
