import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, Database, Download, KeyRound, Loader2, Server, Smartphone, Wifi } from 'lucide-react'
import {
  authFetch,
  getBase,
  getLocalDeviceToken,
  getRemoteSessionToken,
  isNativeIOSRuntime,
  loginLocal,
  loginRemote,
} from '../services/api'
import { downloadIOSLocalModel, getIOSLocalStatus } from '../plataformas'
import type { IOSLocalStatus } from '../plataformas'
import { bootBadgeStyles, bootScreenStyles, bootStepStyles } from '../styles/telaInicializacao'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type StepState = 'pending' | 'loading' | 'ok' | 'error'

interface BootStep {
  id: string
  icon: typeof Server
  label: string
  detail: string
  state: StepState
  errorMsg?: string
}

interface BootScreenProps {
  onDone: (health: SystemHealth) => void
}

export interface SystemHealth {
  backend: boolean
  ollama: boolean
  database: boolean
  rag?: boolean
  knowledgeGraph?: boolean
  remoteMode?: boolean
  authMode?: 'local' | 'remote' | 'anonymous' | string
  userId?: string
  userEmail?: string
  model: string
  backendLatency: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function timedFetch(url: string, options?: RequestInit): Promise<{ ok: boolean; data: unknown; ms: number }> {
  const start = Date.now()
  try {
    const res = await authFetch(url, { signal: AbortSignal.timeout(7000), ...options })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, data, ms: Date.now() - start }
  } catch {
    return { ok: false, data: null, ms: Date.now() - start }
  }
}

function formatGigabytes(bytes: number) {
  return (bytes / 1_073_741_824).toFixed(1).replace('.', ',')
}

// ── Componente principal ───────────────────────────────────────────────────────

export function BootScreen({ onDone }: BootScreenProps) {
  const nativeIOS = isNativeIOSRuntime()
  const [visible, setVisible] = useState(true)
  const [closing, setClosing] = useState(false)
  const [health, setHealth] = useState<SystemHealth>({
    backend: false,
    ollama: false,
    database: false,
    rag: false,
    knowledgeGraph: false,
    remoteMode: false,
    authMode: 'local',
    model: '',
    backendLatency: null,
  })
  const [needsAuth, setNeedsAuth] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authVersion, setAuthVersion] = useState(0)
  const [nativeLocalStatus, setNativeLocalStatus] = useState<IOSLocalStatus | null>(null)
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number | null>(null)
  const [modelDownloadBusy, setModelDownloadBusy] = useState(false)
  const [modelDownloadError, setModelDownloadError] = useState('')

  const [steps, setSteps] = useState<BootStep[]>([
    {
      id: 'backend',
      icon: nativeIOS ? Database : Server,
      label: nativeIOS ? 'Memória local do iPhone' : 'Servidor backend',
      detail: nativeIOS ? 'Verificando espaço e banco SQLite…' : 'Conectando ao Flask na porta 5050…',
      state: 'pending',
    },
    {
      id: 'ollama',
      icon: nativeIOS ? Smartphone : Bot,
      label: nativeIOS ? 'Motor local 4B' : 'Motor de IA (Ollama)',
      detail: nativeIOS ? 'Verificando Qwen3.5-4B…' : 'Verificando modelo de linguagem…',
      state: 'pending',
    },
  ])

  const doneRef = useRef(false)

  function setStep(id: string, patch: Partial<BootStep>) {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
  }

  function closeAndReport(h: SystemHealth) {
    if (doneRef.current) return
    doneRef.current = true
    setClosing(true)
    setTimeout(() => {
      setVisible(false)
      onDone(h)
    }, 420)
  }

  async function finishAuth(action: () => Promise<unknown>, fallbackError: string) {
    setAuthError('')
    setAuthBusy(true)
    try {
      await action()
      setAuthToken('')
      setNeedsAuth(false)
      setAuthVersion(value => value + 1)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : fallbackError)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleRemoteLogin(event: FormEvent) {
    event.preventDefault()
    if (!authToken.trim()) return
    await finishAuth(
      () => loginRemote(authToken.trim()),
      'Token remoto inválido.',
    )
  }

  async function handleNativeModelDownload() {
    setModelDownloadError('')
    setModelDownloadBusy(true)
    setModelDownloadProgress(0)
    setStep('ollama', { state: 'loading', detail: 'Baixando Qwen3.5-4B…', errorMsg: '' })
    try {
      await downloadIOSLocalModel(progress => {
        setModelDownloadProgress(Math.round(progress * 100))
        setStep('ollama', {
          state: 'loading',
          detail: `Baixando e verificando o modelo… ${Math.round(progress * 100)}%`,
        })
      })
      setAuthVersion(value => value + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao baixar o modelo local.'
      setModelDownloadError(message)
      setStep('ollama', { state: 'error', detail: 'Download interrompido', errorMsg: message })
    } finally {
      setModelDownloadBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      const base = getBase()
      const updatedHealth: SystemHealth = {
        backend: false,
        ollama: false,
        database: false,
        rag: false,
        knowledgeGraph: false,
        remoteMode: false,
        authMode: 'local',
        model: '',
        backendLatency: null,
      }

      if (nativeIOS) {
        setStep('backend', { state: 'loading', detail: 'Verificando espaço e banco SQLite…', errorMsg: '' })
        setStep('ollama', { state: 'loading', detail: 'Verificando Qwen3.5-4B…', errorMsg: '' })
        try {
          const status = await getIOSLocalStatus()
          if (cancelled) return
          setNativeLocalStatus(status)
          updatedHealth.backend = status.databaseReady
          updatedHealth.database = status.databaseReady
          updatedHealth.ollama = status.modelInstalled
          updatedHealth.model = status.modelName
          updatedHealth.authMode = 'local'
          updatedHealth.backendLatency = 0

          if (status.storage.databaseBlocked) {
            const freeGB = (status.storage.availableBytes / 1_073_741_824).toFixed(1)
            setStep('backend', {
              state: 'error',
              detail: 'Banco protegido e mantido fechado',
              errorMsg: `O iPhone possui apenas ${freeGB} GB livres. Libere espaço até ter pelo menos 1,5 GB.`,
            })
          } else if (status.databaseReady) {
            setStep('backend', {
              state: 'ok',
              detail: status.storage.warning
                ? 'SQLite pronto — pouco espaço disponível'
                : 'SQLite local pronto e protegido',
              errorMsg: status.storage.warning ? 'Recomendamos manter pelo menos 3 GB livres.' : '',
            })
          } else {
            setStep('backend', {
              state: 'error',
              detail: 'Banco local indisponível',
              errorMsg: 'Não foi possível inicializar a memória local.',
            })
          }

          if (status.modelInstalled) {
            setStep('ollama', {
              state: 'ok',
              detail: `${status.modelName} no próprio iPhone`,
              errorMsg: status.thermalState === 'critical'
                ? 'O aparelho está criticamente quente. Resfriando...'
                : '',
            })
          } else {
            setStep('ollama', {
              state: status.storage.modelDownloadAllowed ? 'pending' : 'error',
              detail: 'Modelo 4B ainda não instalado',
              errorMsg: status.storage.modelDownloadAllowed
                ? `Baixe ${formatGigabytes(status.modelExpectedBytes)} GB uma vez para usar o Buds totalmente offline.`
                : `Libere cerca de ${formatGigabytes(status.modelRequiredBytes)} GB para baixar e instalar o modelo com segurança.`,
            })
          }

          setHealth(updatedHealth)
          if (status.databaseReady && status.modelInstalled) {
            await new Promise(resolve => setTimeout(resolve, 700))
            if (!cancelled) closeAndReport(updatedHealth)
          }
        } catch (err) {
          if (cancelled) return
          const message = err instanceof Error ? err.message : 'Falha ao inicializar o runtime local.'
          setStep('backend', { state: 'error', detail: 'Runtime local indisponível', errorMsg: message })
          setStep('ollama', { state: 'error', detail: 'Modelo não verificado', errorMsg: '' })
          setHealth(updatedHealth)
        }
        return
      }

      // ── Passo 1: Backend ──────────────────────────────────────────────────
      setStep('backend', { state: 'loading', detail: 'Conectando ao Flask na porta 5050…' })
      const { ok: backendOk, data: healthData, ms } = await timedFetch(`${base}/health`)
      if (cancelled) return

      if (backendOk && healthData) {
        const healthPayload = healthData as {
          ollama?: boolean
          rag?: boolean
          knowledge_graph?: boolean
          authenticated?: boolean
          auth_mode?: string
          user_id?: string
          email?: string
          remote?: { remote_mode?: boolean; auth_required?: boolean; auth_configured?: boolean; local_url?: string }
        }
        updatedHealth.backend = true
        updatedHealth.ollama = Boolean(healthPayload.ollama)
        updatedHealth.rag = Boolean(healthPayload.rag)
        updatedHealth.knowledgeGraph = Boolean(healthPayload.knowledge_graph)
        updatedHealth.remoteMode = Boolean(healthPayload.remote?.remote_mode)
        updatedHealth.authMode = healthPayload.auth_mode || 'local'
        updatedHealth.userId = healthPayload.user_id
        updatedHealth.userEmail = healthPayload.email
        updatedHealth.backendLatency = ms
        setStep('backend', {
          state: 'ok',
          detail: healthPayload.remote?.remote_mode
            ? `Remoto ativo em ${healthPayload.remote?.local_url ?? 'rede privada'}`
            : `Conectado em ${ms}ms`,
        })
        updatedHealth.database = true
        if (healthPayload.remote?.auth_required && !healthPayload.authenticated) {
          const deviceToken = await getLocalDeviceToken().catch(() => '')
          if (deviceToken) {
            try {
              await loginRemote(deviceToken)
              updatedHealth.authMode = 'remote'
            } catch {
              setNeedsAuth(true)
              setHealth(updatedHealth)
              return
            }
          } else {
            setNeedsAuth(true)
            setHealth(updatedHealth)
            return
          }
        }
        if (!getRemoteSessionToken()) {
          await loginLocal().catch(() => undefined)
          updatedHealth.authMode = 'local'
        }
      } else {
        setStep('backend', {
          state: 'error',
          detail: 'Não foi possível conectar',
          errorMsg: 'Inicie o backend local do Buds Memory.',
        })
        setStep('ollama', { state: 'error', detail: 'Não verificado (backend offline)', errorMsg: '' })
        setHealth(updatedHealth)
        return
      }

      const { ok: configOk, data: configData } = await timedFetch(`${base}/config`)
      if (cancelled) return
      const cfg = configOk && configData ? configData as { model?: string; models?: string[] } : { model: '', models: [] }
      updatedHealth.model = cfg.model ?? ''

      // ── Passo 2: Ollama ───────────────────────────────────────────────────
      setStep('ollama', { state: 'loading', detail: 'Verificando modelo de linguagem…' })
      await new Promise(r => setTimeout(r, 300))
      if (cancelled) return

      const hasModels = Array.isArray(cfg.models) && cfg.models.length > 0

      if (updatedHealth.ollama && hasModels) {
        updatedHealth.ollama = true
        setStep('ollama', {
          state: 'ok',
          detail: `Modelo: ${cfg.model ?? cfg.models?.[0] ?? 'desconhecido'}`,
        })
      } else {
        setStep('ollama', {
          state: 'error',
          detail: 'Nenhum modelo carregado',
          errorMsg: 'Inicie o Ollama e carregue um modelo.',
        })
      }

      setHealth(updatedHealth)

      // Auto-fecha se tudo OK
      const allOk = updatedHealth.backend && updatedHealth.ollama
      if (allOk) {
        await new Promise(r => setTimeout(r, 900))
        if (!cancelled) closeAndReport(updatedHealth)
      }
    }

    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authVersion])

  if (!visible) return null

  const allOk = steps.every(s => s.state === 'ok')
  const hasError = steps.some(s => s.state === 'error')
  const allDone = steps.every(s => s.state === 'ok' || s.state === 'error')

  return (
    <div
      className={`${bootScreenStyles.overlay} ${closing ? bootScreenStyles.closing : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Inicializando Buds Memory"
    >
      <div className={bootScreenStyles.modal}>

        {/* Logo / brand */}
        <div className={bootScreenStyles.brand}>
          <div className={bootScreenStyles.logo} aria-hidden="true">
            <Wifi size={26} />
          </div>
          <div>
            <h2 className={bootScreenStyles.title}>Buds Memory</h2>
            <p className={bootScreenStyles.subtitle}>
              {allOk ? 'Tudo pronto!' : hasError ? 'Alguns serviços não responderam' : 'Inicializando serviços…'}
            </p>
          </div>
        </div>

        {needsAuth && (
          <div className={bootScreenStyles.authPanel}>
            <form className={bootScreenStyles.authForm} onSubmit={handleRemoteLogin}>
              <label className={bootScreenStyles.authLabel} htmlFor="nexus-remote-token">
                Código de acesso
              </label>
              <p className={bootScreenStyles.authCopy}>
                No computador, copie o token exibido em “Acesso pelo celular” e cole abaixo.
              </p>
              <input
                className={bootScreenStyles.authInput}
                id="nexus-remote-token"
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                type="text"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="Cole aqui o token mostrado no computador"
              />
              <button
                className={bootScreenStyles.authButton}
                type="submit"
                disabled={authBusy || !authToken.trim()}
              >
                {authBusy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Conectar ao Buds
              </button>
            </form>
            {authError && <p className={bootScreenStyles.authError}>{authError}</p>}
          </div>
        )}

        {nativeIOS && nativeLocalStatus && !nativeLocalStatus.modelInstalled && (
          <div className={bootScreenStyles.authPanel}>
            <div className={bootScreenStyles.authForm}>
              <strong className={bootScreenStyles.authLabel}>Instalar inteligência local 4B</strong>
              <p className={bootScreenStyles.authCopy}>
                O download oficial tem cerca de {formatGigabytes(nativeLocalStatus.modelExpectedBytes)} GB. Depois de instalado, chat, histórico e memória
                funcionam sem Mac, servidor, token ou internet.
              </p>
              {modelDownloadProgress !== null && (
                <p className={bootScreenStyles.authCopy} aria-live="polite">
                  Progresso: <strong>{modelDownloadProgress}%</strong>
                </p>
              )}
              <button
                className={bootScreenStyles.authButton}
                type="button"
                disabled={modelDownloadBusy || !nativeLocalStatus.storage.modelDownloadAllowed}
                onClick={() => void handleNativeModelDownload()}
              >
                {modelDownloadBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {modelDownloadBusy ? 'Baixando modelo…' : 'Baixar Qwen 4B no iPhone'}
              </button>
              <button
                className={`${bootScreenStyles.button} ${bootScreenStyles.secondaryButton}`}
                type="button"
                disabled={modelDownloadBusy}
                onClick={() => setAuthVersion(value => value + 1)}
              >
                Verificar novamente
              </button>
            </div>
            {modelDownloadError && <p className={bootScreenStyles.authError}>{modelDownloadError}</p>}
          </div>
        )}

        {/* Steps */}
        <div className={bootScreenStyles.steps} role="list">
          {steps.map(step => {
            const Icon = step.icon
            const stateStyles = bootStepStyles[step.state]
            return (
              <div
                key={step.id}
                className={`${bootScreenStyles.step} ${stateStyles.row}`}
                role="listitem"
              >
                <div className={`${bootScreenStyles.stepIcon} ${stateStyles.icon}`} aria-hidden="true">
                  <Icon size={16} />
                </div>

                <div className={bootScreenStyles.stepBody}>
                  <div className={bootScreenStyles.stepHead}>
                    <span className={bootScreenStyles.stepLabel}>{step.label}</span>
                    <StepBadge state={step.state} />
                  </div>
                  <p className={bootScreenStyles.stepDetail}>{step.detail}</p>
                  {step.errorMsg && <p className={bootScreenStyles.stepError}>{step.errorMsg}</p>}

                  {/* Barra de progresso */}
                  <div
                    className={bootScreenStyles.bar}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={step.detail}
                  >
                    <div className={`${bootScreenStyles.barFill} ${stateStyles.bar}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Ações */}
        {allDone && (!nativeIOS || allOk) && (
          <div className={bootScreenStyles.actions}>
            {hasError && !allOk && (
              <button
                type="button"
                className={`${bootScreenStyles.button} ${bootScreenStyles.secondaryButton}`}
                onClick={() => closeAndReport(health)}
              >
                Entrar assim mesmo
              </button>
            )}
            <button
              type="button"
              className={`${bootScreenStyles.button} ${bootScreenStyles.primaryButton}`}
              onClick={() => closeAndReport(health)}
            >
              {allOk ? 'Entrar' : 'Continuar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Badge de estado ────────────────────────────────────────────────────────────

function StepBadge({ state }: { state: StepState }) {
  if (state === 'pending') {
    return (
      <span className={`${bootScreenStyles.badge} ${bootBadgeStyles.pending}`}>
        Aguardando
      </span>
    )
  }
  if (state === 'loading') return (
    <span className={`${bootScreenStyles.badge} ${bootBadgeStyles.loading}`}>
      <Loader2 size={11} className="animate-spin" />
      Verificando
    </span>
  )
  if (state === 'ok') return (
    <span className={`${bootScreenStyles.badge} ${bootBadgeStyles.ok}`}>
      <CheckCircle2 size={11} />
      Online
    </span>
  )
  return (
    <span className={`${bootScreenStyles.badge} ${bootBadgeStyles.error}`}>
      <AlertCircle size={11} />
      Erro
    </span>
  )
}
