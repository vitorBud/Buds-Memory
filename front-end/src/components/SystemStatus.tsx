import { useEffect, useRef, useState } from 'react'
import { Bot, Database, Server } from 'lucide-react'
import type { SystemHealth } from './BootScreen'

interface SystemStatusProps {
  health: SystemHealth | null
}

// ── Indicador compacto de saúde dos serviços no TopBar ────────────────────────
export function SystemStatus({ health }: SystemStatusProps) {
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
      detail: health?.model || null,
    },
    {
      id: 'database',
      icon: Database,
      label: 'Banco de dados',
      ok: health?.database ?? null,
      detail: null,
    },
  ]

  function dotClass(ok: boolean | null) {
    if (ok === null) return 'sys-dot sys-dot--unknown'
    return ok ? 'sys-dot sys-dot--ok' : 'sys-dot sys-dot--error'
  }

  const allOk = health != null && health.backend && health.ollama && health.database
  const anyError = health != null && (!health.backend || !health.ollama || !health.database)

  return (
    <div className="sys-status-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`sys-status-btn ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Status dos serviços"
        aria-label="Status dos serviços"
        aria-expanded={open}
      >
        {dots.map(d => (
          <span key={d.id} className={dotClass(d.ok)} aria-hidden="true" />
        ))}
        <span className={`sys-status-label ${allOk ? 'tone-ok' : anyError ? 'tone-err' : ''}`}>
          {health == null ? 'Verificando…' : allOk ? 'Online' : anyError ? 'Degradado' : 'Online'}
        </span>
      </button>

      {open && (
        <div className="sys-popover" role="tooltip" aria-label="Detalhes dos serviços">
          <p className="sys-popover-title">Status do sistema</p>
          {dots.map(d => {
            const Icon = d.icon
            return (
              <div key={d.id} className="sys-popover-row">
                <Icon size={13} />
                <span className="sys-popover-name">{d.label}</span>
                <span className={`sys-popover-badge ${d.ok === null ? 'sys-badge--unknown' : d.ok ? 'sys-badge--ok' : 'sys-badge--error'}`}>
                  {d.ok === null ? '…' : d.ok ? 'Online' : 'Offline'}
                </span>
                {d.detail && <span className="sys-popover-detail">{d.detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
