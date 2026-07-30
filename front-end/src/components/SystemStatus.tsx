import { useEffect, useRef, useState } from 'react'
import { Bot, Database, Server } from 'lucide-react'
import type { SystemHealth } from './BootScreen'
import {
  systemBadgeStyles,
  systemDotStyles,
  systemLabelStyles,
  systemStatusStyles as styles,
} from '../styles/statusSistema'

interface SystemStatusProps {
  health: SystemHealth | null
  selectedModel?: string
}

// ── Indicador compacto de saúde dos serviços na Sidebar ───────────────────────
export function SystemStatus({ health, selectedModel }: SystemStatusProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const dots = [
    {
      id: 'backend',
      icon: Server,
      label: 'Backend',
      ok: health?.backend ?? null,
      detail: health?.backendLatency != null ? `${health.backendLatency}ms` : null,
    },
    {
      id: 'ollama',
      icon: Bot,
      label: 'IA Ollama',
      ok: health?.ollama ?? null,
      detail: selectedModel || health?.model || null,
    },
    {
      id: 'database',
      icon: Database,
      label: 'Banco de dados',
      ok: health?.database ?? null,
      detail: null,
    },
  ]

  function stateKey(ok: boolean | null) {
    if (ok === null) return 'unknown'
    return ok ? 'ok' : 'error'
  }

  const allOk = health != null && health.backend && health.ollama && health.database
  const anyError = health != null && (!health.backend || !health.ollama || !health.database)

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.button} ${open ? styles.buttonOpen : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Status dos serviços"
        aria-label="Status dos serviços"
        aria-expanded={open}
      >
        {dots.map(d => (
          <span
            key={d.id}
            className={`${styles.dot} ${systemDotStyles[stateKey(d.ok)]}`}
            aria-hidden="true"
          />
        ))}
        <span className={`${styles.label} ${systemLabelStyles[allOk ? 'ok' : anyError ? 'error' : 'neutral']}`}>
          {health == null ? 'Verificando…' : allOk ? 'Online' : anyError ? 'Degradado' : 'Online'}
        </span>
        {selectedModel && <span className={styles.model}>{selectedModel.replace('qwen2.5-coder:', '')}</span>}
      </button>

      {open && (
        <div className={styles.popover} role="tooltip" aria-label="Detalhes dos serviços">
          <p className={styles.popoverTitle}>Status do sistema</p>
          {dots.map(d => {
            const Icon = d.icon
            return (
              <div key={d.id} className={styles.popoverRow}>
                <Icon size={13} />
                <span className={styles.popoverName}>{d.label}</span>
                <span className={`${styles.popoverBadge} ${systemBadgeStyles[stateKey(d.ok)]}`}>
                  {d.ok === null ? '…' : d.ok ? 'Online' : 'Offline'}
                </span>
                {d.detail && <span className={styles.popoverDetail}>{d.detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
