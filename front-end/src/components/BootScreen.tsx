import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, KeyRound, Loader2, Server, Wifi } from 'lucide-react'
import { authFetch, getBase, getLocalDeviceToken, getRemoteSessionToken, loginLocal, loginRemote } from '../services/api'
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

// ── Componente principal ───────────────────────────────────────────────────────

export function BootScreen({ onDone }: BootScreenProps) {
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

  const [steps, setSteps] = useState<BootStep[]>([
    {
      id: 'backend',
      icon: Server,
      label: 'Servidor backend',
      detail: 'Conectando ao Flask na porta 5050…',
      state: 'pending',
    },
    {
      id: 'ollama',
      icon: Bot,
      label: 'Motor de IA (Ollama)',
      detail: 'Verificando modelo de linguagem…',
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
          errorMsg: 'Inicie o backend local do Aether Memory.',
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
      aria-label="Inicializando Aether Memory"
    >
      <div className={bootScreenStyles.modal}>

        {/* Logo / brand */}
        <div className={bootScreenStyles.brand}>
          <div className={bootScreenStyles.logo} aria-hidden="true">
            <Wifi size={26} />
          </div>
          <div>
            <h2 className={bootScreenStyles.title}>Aether Memory</h2>
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
                Conectar ao Aether
              </button>
            </form>
            {authError && <p className={bootScreenStyles.authError}>{authError}</p>}
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
        {allDone && (
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
