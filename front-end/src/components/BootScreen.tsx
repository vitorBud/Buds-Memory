import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Bot, CheckCircle2, Cloud, Database, KeyRound, Loader2, Server, UserRound, Wifi } from 'lucide-react'
import { authFetch, getBase, getRemoteSessionToken, loginLocal, loginRemote, loginSupabase, pullCloudChats, signupSupabase } from '../services/api'

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
  authMode?: 'local' | 'supabase' | 'remote' | 'anonymous' | string
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
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPanel, setAuthPanel] = useState<'supabase' | 'local' | 'token'>('supabase')
  const [supabaseMode, setSupabaseMode] = useState<'login' | 'signup'>('login')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
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

  async function finishAuth(action: () => Promise<unknown>, fallbackError: string) {
    setAuthError('')
    setAuthNotice('')
    setAuthBusy(true)
    try {
      await action()
      setAuthToken('')
      setAuthPassword('')
      setNeedsAuth(false)
      setAuthVersion(value => value + 1)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : fallbackError)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleLocalLogin() {
    await finishAuth(
      () => loginLocal(),
      'Não foi possível liberar o modo local.',
    )
  }

  async function handleSupabaseLogin(event: FormEvent) {
    event.preventDefault()
    if (!authEmail.trim() || !authPassword) return
    await finishAuth(
      async () => {
        await loginSupabase(authEmail.trim(), authPassword)
        await pullCloudChats().catch(() => undefined)
      },
      'Login Supabase inválido.',
    )
  }

  async function handleSupabaseSignup(event: FormEvent) {
    event.preventDefault()
    if (!authEmail.trim() || !authPassword) return
    setAuthError('')
    setAuthNotice('')
    setAuthBusy(true)
    try {
      const result = await signupSupabase(authEmail.trim(), authPassword)
      if (result.access_token) {
        setAuthPassword('')
        await pullCloudChats().catch(() => undefined)
        setNeedsAuth(false)
        setAuthVersion(value => value + 1)
        return
      }
      setAuthPassword('')
      setSupabaseMode('login')
      setAuthNotice(result.message || 'Conta criada. Confirme seu e-mail e depois entre pelo Aether Memory.')
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Não foi possível criar a conta.')
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
        if (!getRemoteSessionToken()) {
          setNeedsAuth(true)
          setStep('database', {
            state: 'pending',
            detail: 'Escolha Supabase ou modo local para carregar o histórico',
          })
          setHealth(updatedHealth)
          return
        }
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
    <div className={`boot-overlay ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Inicializando Aether Memory">
      <div className="boot-modal">

        {/* Logo / brand */}
        <div className="boot-brand">
          <div className="boot-logo" aria-hidden="true">
            <Wifi size={26} />
          </div>
          <div>
            <h2 className="boot-title">Aether Memory</h2>
            <p className="boot-subtitle">
              {allOk ? 'Tudo pronto!' : hasError ? 'Alguns serviços não responderam' : 'Inicializando serviços…'}
            </p>
          </div>
        </div>

        {needsAuth && (
          <div className="boot-auth-form boot-account-panel">
            <div className="boot-auth-tabs" role="tablist" aria-label="Modo de entrada">
              <button type="button" className={authPanel === 'supabase' ? 'is-active' : ''} onClick={() => setAuthPanel('supabase')}>
                <Cloud size={15} /> Supabase
              </button>
              <button type="button" className={authPanel === 'local' ? 'is-active' : ''} onClick={() => setAuthPanel('local')}>
                <UserRound size={15} /> Local
              </button>
              <button type="button" className={authPanel === 'token' ? 'is-active' : ''} onClick={() => setAuthPanel('token')}>
                <KeyRound size={15} /> Token
              </button>
            </div>

            {authPanel === 'supabase' && (
              <form className="boot-auth-stack" onSubmit={supabaseMode === 'login' ? handleSupabaseLogin : handleSupabaseSignup}>
                <label htmlFor="nexus-supabase-email">
                  {supabaseMode === 'login' ? 'Entrar com Supabase' : 'Criar conta Aether'}
                </label>
                <p>
                  {supabaseMode === 'login'
                    ? 'Entre para carregar chats da nuvem e liberar sincronização.'
                    : 'Crie sua conta para usar o Aether Memory em outros dispositivos com Supabase.'}
                </p>
                <input
                  id="nexus-supabase-email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                />
                <input
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  type="password"
                  autoComplete={supabaseMode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Senha"
                />
                <button type="submit" disabled={authBusy || !authEmail.trim() || !authPassword}>
                  {authBusy ? <Loader2 size={15} className="spin" /> : <Cloud size={15} />}
                  {supabaseMode === 'login' ? 'Entrar e baixar chats' : 'Criar conta'}
                </button>
                <button
                  type="button"
                  className="boot-auth-link"
                  onClick={() => {
                    setAuthError('')
                    setAuthNotice('')
                    setSupabaseMode(mode => mode === 'login' ? 'signup' : 'login')
                  }}
                >
                  {supabaseMode === 'login' ? 'Criar uma nova conta' : 'Já tenho conta'}
                </button>
              </form>
            )}

            {authPanel === 'local' && (
              <div className="boot-auth-stack">
                <label>Continuar localmente</label>
                <p>Usa apenas os dados salvos neste Mac/iPhone. Para sincronizar com a nuvem, entre com Supabase.</p>
                <button type="button" onClick={handleLocalLogin} disabled={authBusy}>
                  {authBusy ? <Loader2 size={15} className="spin" /> : <UserRound size={15} />}
                  Liberar modo local
                </button>
              </div>
            )}

            {authPanel === 'token' && (
              <form className="boot-auth-stack" onSubmit={handleRemoteLogin}>
                <label htmlFor="nexus-remote-token">Token técnico remoto</label>
                <input
                  id="nexus-remote-token"
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="NEXUS_AUTH_TOKEN"
                />
                <button type="submit" disabled={authBusy || !authToken.trim()}>
                  {authBusy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
                  Entrar com token
                </button>
              </form>
            )}

            {authNotice && <p className="boot-auth-notice">{authNotice}</p>}
            {authError && <p>{authError}</p>}
          </div>
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
