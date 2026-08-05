import { useEffect, useRef } from 'react'
import { isIOSRuntime } from '../core/ambiente'

interface BrowserMemorySnapshot {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

export function useMobilePerformanceMonitor(surface: string) {
  const renderCountRef = useRef(0)
  const rendersAtLastSampleRef = useRef(0)
  renderCountRef.current += 1

  useEffect(() => {
    // Monitor de performance só roda em dev. Em produção ele desperdiça CPU
    // e bateria no iPhone com PerformanceObserver + setInterval a cada 30s.
    if (!isIOSRuntime() || !import.meta.env.DEV) return
    let longTaskCount = 0
    let longTaskMilliseconds = 0
    let expectedTick = performance.now() + 30_000
    let observer: PerformanceObserver | null = null

    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            longTaskCount += 1
            longTaskMilliseconds += entry.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch { /* WebKit nem sempre oferece longtask */ }
    }

    const interval = window.setInterval(() => {
      const now = performance.now()
      const memory = (performance as Performance & { memory?: BrowserMemorySnapshot }).memory
      const renders = renderCountRef.current - rendersAtLastSampleRef.current
      rendersAtLastSampleRef.current = renderCountRef.current
      console.info('[BudsPerf]', {
        stage: 'ui_health',
        surface,
        sample_ms: 30_000,
        event_loop_lag_ms: Math.max(0, Math.round(now - expectedTick)),
        react_renders: renders,
        long_tasks: longTaskCount,
        long_task_ms: Math.round(longTaskMilliseconds),
        js_heap_used_bytes: memory?.usedJSHeapSize,
        js_heap_total_bytes: memory?.totalJSHeapSize,
      })
      longTaskCount = 0
      longTaskMilliseconds = 0
      expectedTick = now + 30_000
    }, 30_000)

    return () => {
      window.clearInterval(interval)
      observer?.disconnect()
    }
  }, [surface])
}
