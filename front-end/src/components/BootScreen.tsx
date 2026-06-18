import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, Database, Loader2, Server, Wifi } from 'lucide-react'
import { authFetch, getBase, loginRemote } from '../services/api'

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
    model: '',
    backendLatency: null,
  })
  const [needsAuth, setNeedsAuth] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [authError, setAuthError] = useState('')
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
    {
      id: 'database',
      icon: Database,
      label: 'Banco de dados',
      detail: 'Carregando histórico de conversas…',
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

  async function handleRemoteLogin(event: FormEvent) {
    event.preventDefault()
    if (!authToken.trim()) return
    setAuthError('')
    try {
      await loginRemote(authToken.trim())
      setAuthToken('')
      setNeedsAuth(false)
      setAuthVersion(value => value + 1)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Token remoto inválido.')
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
          remote?: { remote_mode?: boolean; auth_required?: boolean; auth_configured?: boolean; local_url?: string }
        }
        updatedHealth.backend = true
        updatedHealth.ollama = Boolean(healthPayload.ollama)
        updatedHealth.rag = Boolean(healthPayload.rag)
        updatedHealth.knowledgeGraph = Boolean(healthPayload.knowledge_graph)
        updatedHealth.remoteMode = Boolean(healthPayload.remote?.remote_mode)
        updatedHealth.backendLatency = ms
        setStep('backend', {
          state: 'ok',
          detail: healthPayload.remote?.remote_mode
            ? `Remoto ativo em ${healthPayload.remote?.local_url ?? 'rede privada'}`
            : `Conectado em ${ms}ms`,
        })
        if (healthPayload.remote?.auth_required && !healthPayload.authenticated) {
          setNeedsAuth(true)
          setStep('database', {
            state: 'pending',
            detail: healthPayload.remote.auth_configured
              ? 'Autenticação remota necessária'
              : 'Configure NEXUS_AUTH_TOKEN no Mac',
          })
          setHealth(updatedHealth)
          return
        }
      } else {
        setStep('backend', {
          state: 'error',
          detail: 'Não foi possível conectar',
          errorMsg: 'Execute start_backend.sh para iniciar o servidor.',
        })
        setStep('ollama', { state: 'error', detail: 'Não verificado (backend offline)', errorMsg: '' })
        setStep('database', { state: 'error', detail: 'Não verificado (backend offline)', errorMsg: '' })
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

      // ── Passo 3: Banco de dados ───────────────────────────────────────────
      setStep('database', { state: 'loading', detail: 'Carregando histórico de conversas…' })
      const { ok: dbOk, data: sessions } = await timedFetch(`${base}/sessions`)
      if (cancelled) return

      if (dbOk) {
        const count = Array.isArray(sessions) ? sessions.length : 0
        updatedHealth.database = true
        setStep('database', {
          state: 'ok',
          detail: `${count} conversa${count !== 1 ? 's' : ''} no histórico`,
        })
      } else {
        setStep('database', {
          state: 'error',
          detail: 'Erro ao acessar o banco de dados',
          errorMsg: 'Verifique as permissões do banco SQLite.',
        })
      }

      setHealth(updatedHealth)

      // Auto-fecha se tudo OK
      const allOk = updatedHealth.backend && updatedHealth.ollama && updatedHealth.database
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
    <div className={`boot-overlay ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Inicializando Nexus IA">
      <div className="boot-modal">

        {/* Logo / brand */}
        <div className="boot-brand">
          <div className="boot-logo" aria-hidden="true">
            <Wifi size={26} />
          </div>
          <div>
            <h2 className="boot-title">Nexus IA</h2>
            <p className="boot-subtitle">
              {allOk ? 'Tudo pronto!' : hasError ? 'Alguns serviços não responderam' : 'Inicializando serviços…'}
            </p>
          </div>
        </div>

        {needsAuth && (
          <form className="boot-auth-form" onSubmit={handleRemoteLogin}>
            <label htmlFor="nexus-remote-token">Token remoto</label>
            <div>
              <input
                id="nexus-remote-token"
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="NEXUS_AUTH_TOKEN"
              />
              <button type="submit" disabled={!authToken.trim()}>
                Entrar
              </button>
            </div>
            {authError && <p>{authError}</p>}
          </form>
        )}

        {/* Steps */}
        <div className="boot-steps" role="list">
          {steps.map(step => {
            const Icon = step.icon
            return (
              <div key={step.id} className={`boot-step boot-step--${step.state}`} role="listitem">
                <div className="boot-step-icon" aria-hidden="true">
                  <Icon size={16} />
                </div>

                <div className="boot-step-body">
                  <div className="boot-step-head">
                    <span className="boot-step-label">{step.label}</span>
                    <StepBadge state={step.state} />
                  </div>
                  <p className="boot-step-detail">{step.detail}</p>
                  {step.errorMsg && <p className="boot-step-error">{step.errorMsg}</p>}

                  {/* Barra de progresso */}
                  <div className="boot-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
                    <div className={`boot-bar-fill boot-bar-fill--${step.state}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Ações */}
        {allDone && (
          <div className="boot-actions">
            {hasError && !allOk && (
              <button
                type="button"
                className="boot-btn boot-btn--secondary"
                onClick={() => closeAndReport(health)}
              >
                Entrar assim mesmo
              </button>
            )}
            <button
              type="button"
              className="boot-btn boot-btn--primary"
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
  if (state === 'pending') return <span className="boot-badge boot-badge--pending">Aguardando</span>
  if (state === 'loading') return (
    <span className="boot-badge boot-badge--loading">
      <Loader2 size={11} className="spin" />
      Verificando
    </span>
  )
  if (state === 'ok') return (
    <span className="boot-badge boot-badge--ok">
      <CheckCircle2 size={11} />
      Online
    </span>
  )
  return (
    <span className="boot-badge boot-badge--error">
      <AlertCircle size={11} />
      Erro
    </span>
  )
}
