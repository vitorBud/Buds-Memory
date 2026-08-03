import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Laptop,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react'
import { getLocalDeviceToken } from '../services/api'
import { mobileAccessStyles } from '../styles/acessoCelular'
import type { BackendConfig } from '../types'

interface AcessoCelularProps {
  config: BackendConfig | null
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
  return Promise.resolve()
}

export function AcessoCelular({ config }: AcessoCelularProps) {
  const [token, setToken] = useState('')
  const [loadingToken, setLoadingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [copied, setCopied] = useState<'link' | 'api' | 'token' | ''>('')
  const remote = config?.remote
  const mobileUrl = remote?.recommended_url || remote?.frontend_dev_url || ''
  const nativeApiUrl = remote?.recommended_api_url || remote?.local_url || ''
  const remoteEnabled = Boolean(remote?.remote_mode && remote?.auth_required)

  const loadToken = useCallback(async () => {
    if (!remoteEnabled) {
      setToken('')
      setTokenError('')
      return
    }
    setLoadingToken(true)
    setTokenError('')
    try {
      const localToken = await getLocalDeviceToken()
      setToken(localToken)
      if (!localToken) {
        setTokenError('O backend não informou um token. Reinicie o python app.py.')
      }
    } catch {
      setToken('')
      setTokenError('O token só pode ser exibido no computador principal.')
    } finally {
      setLoadingToken(false)
    }
  }, [remoteEnabled])

  useEffect(() => {
    let cancelled = false

    window.queueMicrotask(() => {
      if (!cancelled) void loadToken()
    })

    return () => {
      cancelled = true
    }
  }, [loadToken])

  async function handleCopy(value: string, kind: 'link' | 'api' | 'token') {
    if (!value) return
    await copyText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(''), 1800)
  }

  return (
    <section className={mobileAccessStyles.page} aria-label="Acesso pelo celular">
      <div className={mobileAccessStyles.shell}>
        <div className={mobileAccessStyles.hero}>
          <div className={mobileAccessStyles.heroHead}>
            <div>
              <span className={mobileAccessStyles.eyebrow}>
                <Smartphone size={15} />
                Acesso local compartilhado
              </span>
              <h1 className={mobileAccessStyles.title}>Use o Aether no seu celular.</h1>
              <p className={mobileAccessStyles.description}>
                O processamento, as conversas e as memórias continuam no computador.
                O celular funciona como uma interface segura conectada pela mesma rede Wi-Fi.
              </p>
            </div>
            <span
              className={`${mobileAccessStyles.state} ${
                remoteEnabled ? mobileAccessStyles.stateOnline : mobileAccessStyles.stateOffline
              }`}
            >
              <span />
              {remoteEnabled ? 'Acesso ativo' : 'Acesso indisponível'}
            </span>
          </div>

          <div className={mobileAccessStyles.accessGrid}>
            <div className={mobileAccessStyles.field}>
              <div className={mobileAccessStyles.fieldHead}>
                <span className={mobileAccessStyles.fieldLabel}>
                  <Wifi size={15} />
                  Link do celular
                </span>
                {copied === 'link' && <small className={mobileAccessStyles.feedback}>Copiado</small>}
              </div>
              <code className={mobileAccessStyles.code}>
                {mobileUrl || 'Aguardando o backend informar o endereço da rede…'}
              </code>
              <div className={mobileAccessStyles.actionRow}>
                <button
                  type="button"
                  className={`${mobileAccessStyles.action} ${mobileAccessStyles.primaryAction}`}
                  onClick={() => void handleCopy(mobileUrl, 'link')}
                  disabled={!mobileUrl}
                >
                  {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
                  Copiar link
                </button>
                {mobileUrl && (
                  <a
                    className={mobileAccessStyles.action}
                    href={mobileUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} />
                    Testar link
                  </a>
                )}
              </div>
            </div>

            <div className={mobileAccessStyles.field}>
              <div className={mobileAccessStyles.fieldHead}>
                <span className={mobileAccessStyles.fieldLabel}>
                  <Server size={15} />
                  Backend/API do app iPhone
                </span>
                {copied === 'api' && <small className={mobileAccessStyles.feedback}>Copiado</small>}
              </div>
              <code className={mobileAccessStyles.code}>
                {nativeApiUrl || 'Aguardando o backend informar o endereço da rede…'}
              </code>
              <div className={mobileAccessStyles.actionRow}>
                <button
                  type="button"
                  className={`${mobileAccessStyles.action} ${mobileAccessStyles.primaryAction}`}
                  onClick={() => void handleCopy(nativeApiUrl, 'api')}
                  disabled={!nativeApiUrl}
                >
                  {copied === 'api' ? <Check size={14} /> : <Copy size={14} />}
                  Copiar para o app iPhone
                </button>
              </div>
            </div>

            <div className={mobileAccessStyles.field}>
              <div className={mobileAccessStyles.fieldHead}>
                <span className={mobileAccessStyles.fieldLabel}>
                  <KeyRound size={15} />
                  Token de acesso
                </span>
                {copied === 'token' && <small className={mobileAccessStyles.feedback}>Copiado</small>}
              </div>
              <code className={mobileAccessStyles.code}>
                {loadingToken ? 'Consultando token local…' : token || 'Token disponível somente no computador principal'}
              </code>
              <div className={mobileAccessStyles.actionRow}>
                <button
                  type="button"
                  className={`${mobileAccessStyles.action} ${token ? mobileAccessStyles.primaryAction : ''}`}
                  onClick={() => void handleCopy(token, 'token')}
                  disabled={!token}
                >
                  {copied === 'token' ? <Check size={14} /> : <Copy size={14} />}
                  Copiar token
                </button>
                <button
                  type="button"
                  className={mobileAccessStyles.action}
                  onClick={() => void loadToken()}
                  disabled={loadingToken}
                >
                  <RefreshCw size={14} className={loadingToken ? 'animate-spin' : ''} />
                  Atualizar
                </button>
              </div>
              {tokenError && <p className={mobileAccessStyles.warning}>{tokenError}</p>}
            </div>
          </div>
        </div>

        <div className={mobileAccessStyles.infoGrid}>
          <article className={mobileAccessStyles.panel}>
            <h2 className={mobileAccessStyles.panelTitle}>
              <Router size={20} />
              Como conectar
            </h2>
            <p className={mobileAccessStyles.panelCopy}>
              Com backend e frontend ligados normalmente, siga estes passos:
            </p>
            <div className={mobileAccessStyles.steps}>
              <div className={mobileAccessStyles.step}>
                <span className={mobileAccessStyles.stepNumber}>1</span>
                <strong className={mobileAccessStyles.stepTitle}>Use a mesma rede</strong>
                <small className={mobileAccessStyles.stepCopy}>Conecte computador e celular ao mesmo Wi-Fi.</small>
              </div>
              <div className={mobileAccessStyles.step}>
                <span className={mobileAccessStyles.stepNumber}>2</span>
                <strong className={mobileAccessStyles.stepTitle}>Escolha o endereço correto</strong>
                <small className={mobileAccessStyles.stepCopy}>No app instalado, use “Backend/API”. No Safari, abra “Link do celular”.</small>
              </div>
              <div className={mobileAccessStyles.step}>
                <span className={mobileAccessStyles.stepNumber}>3</span>
                <strong className={mobileAccessStyles.stepTitle}>Cole o token</strong>
                <small className={mobileAccessStyles.stepCopy}>Na tela “Código de acesso”, cole o token mostrado nesta página.</small>
              </div>
            </div>
          </article>

          <article className={mobileAccessStyles.panel}>
            <h2 className={mobileAccessStyles.panelTitle}>
              <ShieldCheck size={20} />
              Segurança e funcionamento
            </h2>
            <div className={mobileAccessStyles.securityList}>
              <div className={mobileAccessStyles.securityItem}>
                <Laptop size={18} />
                <span>Banco SQLite, Ollama, documentos e memórias permanecem no computador.</span>
              </div>
              <div className={mobileAccessStyles.securityItem}>
                <KeyRound size={18} />
                <span>O token completo só pode ser consultado pela interface aberta no computador principal.</span>
              </div>
              <div className={mobileAccessStyles.securityItem}>
                <Wifi size={18} />
                <span>O app iOS acessa diretamente a API protegida na porta 5050; o acesso pelo navegador usa o frontend na porta 5174.</span>
              </div>
            </div>
            <div className={mobileAccessStyles.command}>
              <div>Back-end: python app.py</div>
              <div>Front-end: npm run dev</div>
            </div>
            <p className={mobileAccessStyles.panelCopy}>
              Se o link não abrir, confirme o Wi-Fi, reinicie os dois processos e verifique se o firewall permite a rede local.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}
