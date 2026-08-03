// ─── useHealthPolling ─────────────────────────────────────────────────────────
// Hook que substitui o setInterval fixo de 8s para monitorar saúde do backend.
//
// Melhorias em relação ao polling anterior:
// 1. Pausa quando a aba não está visível (visibilitychange).
// 2. Backoff exponencial em falhas: 8s → 16s → 32s (máx 60s).
// 3. Reseta para 8s assim que o backend responde com sucesso.
// 4. AbortController cancela fetch pendente ao parar.

import { useEffect, useCallback, useRef } from 'react'
import { getBackendConfig } from '../services/api'
import type { SystemHealth } from '../components/BootScreen'
import { isIOSRuntime } from '../utils/runtime'

const BASE_INTERVAL_MS = 8_000
const IOS_INTERVAL_MS = 30_000
const MAX_INTERVAL_MS = 60_000

interface UseHealthPollingOptions {
  enabled: boolean
  onHealthChange: (updater: (prev: SystemHealth | null) => SystemHealth | null) => void
}

export function useHealthPolling({ enabled, onHealthChange }: UseHealthPollingOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const intervalRef = useRef(isIOSRuntime() ? IOS_INTERVAL_MS : BASE_INTERVAL_MS)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const poll = useCallback(async () => {
    // Não faz nada se a aba estiver oculta
    if (document.hidden) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const start = Date.now()
      const config = await getBackendConfig()
      const latency = Date.now() - start

      // Sucesso → reseta o intervalo
      intervalRef.current = isIOSRuntime() ? IOS_INTERVAL_MS : BASE_INTERVAL_MS

      onHealthChange(prev => {
        const current = prev ?? { backend: false, ollama: false, database: false, model: '', backendLatency: null }
        const next = {
          ...current,
          backend: true,
          backendLatency: isIOSRuntime() ? current.backendLatency ?? latency : latency,
          ollama: Boolean(config.models && config.models.length > 0),
          model: config.model || current.model,
          database: true,
        }
        if (
          prev
          && prev.backend === next.backend
          && prev.ollama === next.ollama
          && prev.database === next.database
          && prev.model === next.model
          && prev.backendLatency === next.backendLatency
        ) return prev
        return next
      })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return

      // Falha → backoff exponencial, capped em MAX_INTERVAL_MS
      intervalRef.current = Math.min(intervalRef.current * 2, MAX_INTERVAL_MS)

      onHealthChange(prev => prev ? { ...prev, backend: false, backendLatency: null } : null)
    }
  }, [onHealthChange])

  useEffect(() => {
    if (!enabled) return

    // Agenda a próxima rodada com o intervalo atual (backoff ou normal)
    const schedule = () => {
      clearTimer()
      timerRef.current = setTimeout(async () => {
        await poll()
        schedule()
      }, intervalRef.current)
    }

    // Retoma/pausa quando a visibilidade da aba muda
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer()
      } else {
        // Ao voltar, dispara imediatamente e reagenda
        poll().then(schedule)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()

    return () => {
      clearTimer()
      abortRef.current?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, poll])
}
