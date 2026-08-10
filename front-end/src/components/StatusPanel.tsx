import { Activity, AlertTriangle, BrainCircuit, Circle, CloudDownload, Code2, Cpu, Database, FolderOpen, Gauge, HardDrive, MessageSquare, RefreshCw, SlidersHorizontal, Trash2, Upload, UserRound, Volume2, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { indexCodebase, isNativeIOSRuntime } from '../services/api'
import { settingsControlStyles, themeDotStyles } from '../styles/controlesConfiguracoes'
import { settingsLayoutStyles, settingsSectionStyles } from '../styles/estruturaConfiguracoes'
import type { AiState, ConversationStorageItem, ConversationStorageStatus, InterfaceSettings, LocalBackupStatus, ThemeMode } from '../types'

interface StatusPanelProps {
  aiState: AiState
  sessionId: string | null
  msgCount: number
  latency: string
  model: string
  models: string[]
  googleSearchAvailable: boolean
  backupStatus: LocalBackupStatus | null
  conversationStorage: ConversationStorageStatus
  isBackupBusy: boolean
  isStorageBusy: boolean
  authMode?: string
  authEmail?: string
  settings: InterfaceSettings
  onModelChange: (model: string) => void
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  onClearStorage: (confirmation: string) => void
  onPurgeConversation: (id: string) => void
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

type SettingsSection = 'account' | 'appearance' | 'ai' | 'voice' | 'backup' | 'storage' | 'codebase' | 'memory' | 'system'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; hint: string; icon: typeof UserRound }> = [
  { id: 'account', label: 'Sessão', hint: 'Banco local', icon: UserRound },
  { id: 'appearance', label: 'Aparência', hint: 'Tema e interface', icon: SlidersHorizontal },
  { id: 'ai', label: 'IA', hint: 'Modelo e Google', icon: BrainCircuit },
  { id: 'voice', label: 'Voz', hint: 'Ativar e escolher', icon: Volume2 },
  { id: 'backup', label: 'Backup', hint: 'Memória local', icon: HardDrive },
  { id: 'storage', label: 'Armazenamento', hint: 'Uso e limpeza', icon: Database },
  { id: 'codebase', label: 'Codebase', hint: 'Projetos locais', icon: Code2 },
  { id: 'memory', label: 'Memória', hint: 'Contexto do chat', icon: Activity },
  { id: 'system', label: 'Sistema', hint: 'Pipeline e sessão', icon: Cpu },
]

type BudsBridge = {
  pickFolder?: () => Promise<string | null>
  isDesktop?: boolean
}

function formatBytes(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unit)
  return `${value.toFixed(unit === 0 || value >= 10 ? 0 : 1)} ${units[unit]}`
}

function formatStorageDate(value?: string | null): string {
  if (!value) return 'Data original indisponível'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Data original indisponível'
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
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
  backupStatus,
  conversationStorage,
  isBackupBusy,
  isStorageBusy,
  authMode,
  authEmail,
  settings,
  onModelChange,
  onExportBackup,
  onImportBackup,
  onClearStorage,
  onPurgeConversation,
  onSettingChange,
  onClose,
  children,
}: StatusPanelProps) {
  const [codebasePath, setCodebasePath] = useState('')
  const [codebaseStatus, setCodebaseStatus] = useState('')
  const [isIndexingCodebase, setIsIndexingCodebase] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const [storageConfirmation, setStorageConfirmation] = useState('')
  const [storageDangerOpen, setStorageDangerOpen] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const nativeIOS = isNativeIOSRuntime()
  const storageItems: ConversationStorageItem[] = [
    ...conversationStorage.orphaned,
    ...conversationStorage.conversations.filter(item => item.state === 'removed'),
    ...conversationStorage.conversations.filter(item => item.state === 'active'),
  ]

  const selectSection = (section: SettingsSection) => {
    setActiveSection(section)
    if (window.matchMedia('(max-width: 860px)').matches) {
      window.requestAnimationFrame(() => {
        contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  const pickCodebaseFolder = async () => {
    const bridge = (window as unknown as { nexus?: BudsBridge }).nexus
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
    <aside className={`settings-page-panel ${settingsLayoutStyles.pagePanel}`}>
      <div className={settingsLayoutStyles.header}>
        <div className={settingsLayoutStyles.headerCopy}>
          <span className={settingsLayoutStyles.eyebrow}>Painel Buds</span>
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

      <nav className={`settings-categories ${settingsLayoutStyles.nav}`} aria-label="Categorias de configurações">
        {SETTINGS_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`${settingsLayoutStyles.navButton} ${activeSection === id ? settingsLayoutStyles.navButtonActive : ''}`}
            onClick={() => selectSection(id)}
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

      <div ref={contentRef} className={`settings-content ${settingsLayoutStyles.content} ${settingsSectionStyles[activeSection]}`}>
      <div className="settings-section settings-interface-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Configurações da interface</span>
          <SlidersHorizontal size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Ajuste a aparência geral do Buds Memory.
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

      </div>

      <div className="settings-section settings-account-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Conta</span>
          <UserRound size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          O Buds Memory usa banco local. Seus chats, PDFs, memórias e grafo ficam neste dispositivo até você exportar um backup.
        </p>
        <div className={settingsControlStyles.statusCard}>
          <div
            className={`${settingsControlStyles.statusOrb} ${authMode ? settingsControlStyles.statusOrbOnline : settingsControlStyles.statusOrbOffline}`}
          >
            <UserRound size={16} />
          </div>
          <div className={settingsControlStyles.statusCardCopy}>
            <strong className={settingsControlStyles.statusCardLabel}>
              {authEmail || (authMode === 'local' ? 'Modo local' : 'Sessão Buds')}
            </strong>
            <span className={settingsControlStyles.statusCardHint}>
              {authMode === 'remote'
                ? 'Sessão autenticada neste dispositivo'
                : 'Dados salvos no SQLite local'}
            </span>
          </div>
        </div>
        <div className={settingsControlStyles.discoveryCard}>
          <strong>O que você quer ajustar?</strong>
          <span>As opções mais procuradas estão a um toque daqui.</span>
          <div className={settingsControlStyles.discoveryGrid}>
            {SETTINGS_SECTIONS.filter(item => ['appearance', 'ai', 'voice', 'storage'].includes(item.id)).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => selectSection(id)}>
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
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
            label="Buscar no Google"
            description="Permite consulta em tempo real quando a pergunta precisar de dados atuais."
            checked={settings.webSearchEnabled}
            onChange={(checked) => onSettingChange('webSearchEnabled', checked)}
          />
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

      <div className="settings-section settings-voice-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Voz do Buds</span>
          <Volume2 size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Ative ou desative a leitura automática das respostas. O microfone do modo Voz continua disponível separadamente.
        </p>
        <div className={settingsControlStyles.toggleStack}>
          <ToggleRow
            label="Falar respostas automaticamente"
            description={nativeIOS ? 'Usa a voz instalada no iPhone.' : 'Reproduz em voz alta as novas respostas do chat.'}
            checked={settings.autoPlayAudio}
            onChange={(checked) => {
              if (nativeIOS && checked && settings.voiceProvider !== 'browser') {
                onSettingChange('voiceProvider', 'browser')
              }
              onSettingChange('autoPlayAudio', checked)
            }}
          />
        </div>
        <div className={settingsControlStyles.optionGrid} aria-label="Selecionar motor de voz">
          {VOICE_PROVIDER_OPTIONS.filter(option => !nativeIOS || option.value === 'browser').map(option => (
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
      </div>

      <div className="settings-section settings-codebase-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Codebase</span>
          <Code2 size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Ensine uma pasta de projeto para o Buds Memory responder sobre arquivos, funções, rotas e dependências.
        </p>
        <div className={settingsControlStyles.codebaseCard}>
          <span className={settingsControlStyles.codebaseTitle}>Ensinar um projeto ao Buds</span>
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
          Baixe um arquivo com toda a memória do Buds ou insira esse backup em outro computador para continuar com o mesmo histórico.
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
          title="Baixa um backup completo da memória local do Buds."
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

      <div className="settings-section settings-storage-block">
        <div className={settingsControlStyles.panelHeading}>
          <span>Armazenamento</span>
          <Database size={15} />
        </div>
        <p className={settingsControlStyles.sectionCopy}>
          Espaço ocupado pelos dados locais do Buds neste dispositivo. Os valores são atualizados ao abrir as configurações.
        </p>

        <div className={settingsControlStyles.metricsGrid}>
          <div className={settingsControlStyles.metric}>
            <HardDrive size={13} />
            <span className={settingsControlStyles.metricLabel}>Total usado</span>
            <strong className={settingsControlStyles.metricValue}>{formatBytes(backupStatus?.storage?.used_bytes)}</strong>
          </div>
          <div className={settingsControlStyles.metric}>
            <Database size={13} />
            <span className={settingsControlStyles.metricLabel}>Conversas e memórias</span>
            <strong className={settingsControlStyles.metricValue}>{formatBytes(backupStatus?.storage?.database_bytes)}</strong>
          </div>
          <div className={settingsControlStyles.metric}>
            <BrainCircuit size={13} />
            <span className={settingsControlStyles.metricLabel}>{nativeIOS ? 'Modelo local 4B' : 'Modelo dentro do Buds'}</span>
            <strong className={settingsControlStyles.metricValue}>{formatBytes(backupStatus?.storage?.model_bytes)}</strong>
          </div>
          <div className={settingsControlStyles.metric}>
            <Gauge size={13} />
            <span className={settingsControlStyles.metricLabel}>Livre no dispositivo</span>
            <strong className={settingsControlStyles.metricValue}>{formatBytes(backupStatus?.storage?.available_bytes)}</strong>
          </div>
        </div>

        <div className={settingsControlStyles.storageInfoNotice}>
          <strong>Dados por conversa</strong>
          <span>
            Remover um chat da barra lateral não apaga suas lembranças. Escolha abaixo o que deseja eliminar definitivamente; os pontos correspondentes também somem da Obsidian.
          </span>
        </div>

        <div className={settingsControlStyles.conversationStorageList}>
          {storageItems.length === 0 ? (
            <div className={settingsControlStyles.storageEmpty}>
              <MessageSquare size={18} />
              <strong>Nenhuma conversa armazenada</strong>
              <span>Quando houver chats, você poderá limpar cada um separadamente aqui.</span>
            </div>
          ) : storageItems.map(item => (
            <article key={`${item.state}-${item.id}`} className={settingsControlStyles.conversationStorageCard}>
              <div className={settingsControlStyles.conversationStorageHeader}>
                <span className={settingsControlStyles.conversationStorageIcon}><MessageSquare size={15} /></span>
                <div className={settingsControlStyles.conversationStorageCopy}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.state === 'active' ? 'Na barra lateral' : item.state === 'removed' ? 'Removida da barra lateral' : 'Dados de uma versão anterior'}
                    {' · '}{formatStorageDate(item.deleted_at || item.created_at)}
                  </small>
                </div>
                <span className={settingsControlStyles.conversationStorageBadge} data-state={item.state}>
                  {item.state === 'active' ? 'Ativa' : item.state === 'removed' ? 'Removida' : 'Antiga'}
                </span>
              </div>
              <div className={settingsControlStyles.conversationStorageStats}>
                <span>{item.message_count} mensagens</span>
                <span>{item.memory_count} memórias</span>
                <span>{item.knowledge_count + item.graph_count + item.timeline_count} itens cognitivos</span>
                {item.estimated_bytes > 0 && <span>~{formatBytes(item.estimated_bytes)}</span>}
              </div>
              <button
                type="button"
                className={settingsControlStyles.conversationDangerButton}
                disabled={isStorageBusy || !['idle', 'error'].includes(aiState)}
                onClick={() => {
                  const accepted = window.confirm(`Apagar definitivamente “${item.title}” e toda memória associada? Esta ação não pode ser desfeita.`)
                  if (accepted) onPurgeConversation(item.id)
                }}
              >
                <Trash2 size={14} />
                Apagar chat e memórias
              </button>
            </article>
          ))}
        </div>

        <div className={settingsControlStyles.storageTotalDivider}>
          <span>Exclusão completa do dispositivo</span>
        </div>

        <div className={settingsControlStyles.storageNotice}>
          <strong>Zona de exclusão total</strong>
          <span>
            {nativeIOS
              ? 'Apaga todas as conversas, memórias e o modelo 4B deste iPhone. Para usar a IA novamente, será necessário baixar o modelo de novo.'
              : 'Apaga conversas, memórias, documentos, grafo e áudios do Buds. Os modelos do Ollama instalados fora do aplicativo permanecem no MacBook.'}
          </span>
        </div>

        {!storageDangerOpen ? (
          <button
            type="button"
            className={settingsControlStyles.dangerButton}
            onClick={() => setStorageDangerOpen(true)}
            disabled={isStorageBusy || !['idle', 'error'].includes(aiState)}
          >
            <Trash2 size={15} />
            Apagar todos os dados
          </button>
        ) : (
          <div className={settingsControlStyles.storageNotice}>
            <strong><AlertTriangle size={15} /> Esta ação não pode ser desfeita</strong>
            <span>Digite APAGAR TUDO no campo abaixo para liberar o botão.</span>
            <input
              className={settingsControlStyles.storageInput}
              value={storageConfirmation}
              onChange={(event) => setStorageConfirmation(event.target.value)}
              placeholder="APAGAR TUDO"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={settingsControlStyles.dangerButton}
              disabled={storageConfirmation !== 'APAGAR TUDO' || isStorageBusy || !['idle', 'error'].includes(aiState)}
              onClick={() => {
                const accepted = window.confirm('Apagar definitivamente todos os dados locais do Buds neste dispositivo?')
                if (accepted) onClearStorage(storageConfirmation)
              }}
            >
              <Trash2 size={15} />
              {isStorageBusy ? 'Apagando dados...' : 'Confirmar exclusão total'}
            </button>
          </div>
        )}
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
            <strong className={settingsControlStyles.technicalValue}>
              {nativeIOS ? 'Voz do iPhone' : settings.voiceProvider === 'piper' ? 'Piper' : 'Sistema'}
            </strong>
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
