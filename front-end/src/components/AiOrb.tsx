import { useEffect, useRef } from 'react'
import type { AiState } from '../types'

interface AiOrbProps {
  state: AiState
  size?: number
}

const STATE_COLORS: Record<AiState, { core: string; ring1: string; ring2: string }> = {
  idle:         { core: 'rgba(0,212,255,0.22)',  ring1: 'rgba(0,212,255,0.5)',  ring2: 'rgba(123,47,247,0.4)' },
  listening:    { core: 'rgba(0,212,255,0.55)',  ring1: 'rgba(0,212,255,0.9)',  ring2: 'rgba(0,212,255,0.5)' },
  transcribing: { core: 'rgba(255,179,71,0.5)',  ring1: 'rgba(255,179,71,0.8)', ring2: 'rgba(255,179,71,0.4)' },
  thinking:     { core: 'rgba(123,47,247,0.55)', ring1: 'rgba(123,47,247,0.9)', ring2: 'rgba(0,212,255,0.4)' },
  speaking:     { core: 'rgba(0,255,159,0.5)',   ring1: 'rgba(0,255,159,0.85)', ring2: 'rgba(0,212,255,0.4)' },
  error:        { core: 'rgba(255,68,102,0.5)',  ring1: 'rgba(255,68,102,0.8)', ring2: 'rgba(255,68,102,0.3)' },
}

// Orbe visual que reflete o estado atual da IA: ouvindo, pensando, falando ou erro.
export function AiOrb({ state, size = 180 }: AiOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef(0)
  const stateRef  = useRef<AiState>(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const CX = size / 2
    const CY = size / 2
    let animId: number

    function draw(frame: number) {
      ctx.clearRect(0, 0, size, size)
      const st = stateRef.current
      const colors = STATE_COLORS[st]
      const pulse = Math.sin(frame * 0.04)
      const intensity = st === 'idle' ? 0.5 : 1.0

      // Outer glow
      const glowR = (size * 0.35) + pulse * (st !== 'idle' ? 10 : 4)
      const grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, glowR)
      grad.addColorStop(0, colors.core)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath(); ctx.arc(CX, CY, glowR, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()

      // Rotating arc 1
      ctx.save(); ctx.translate(CX, CY); ctx.rotate(frame * 0.018)
      ctx.beginPath(); ctx.arc(0, 0, size * 0.245, 0, Math.PI * 1.6)
      ctx.strokeStyle = colors.ring1; ctx.lineWidth = 2 * intensity; ctx.stroke()
      ctx.restore()

      // Rotating arc 2 (reverse)
      ctx.save(); ctx.translate(CX, CY); ctx.rotate(-frame * 0.013)
      ctx.beginPath(); ctx.arc(0, 0, size * 0.3, Math.PI * 0.3, Math.PI * 1.3)
      ctx.strokeStyle = colors.ring2; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.restore()

      // Inner core dot
      const coreR = (size * 0.1) + pulse * (st !== 'idle' ? 4 : 2)
      const coreGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, coreR)
      coreGrad.addColorStop(0, 'rgba(0,212,255,1)')
      coreGrad.addColorStop(0.4, 'rgba(0,212,255,0.5)')
      coreGrad.addColorStop(1, 'rgba(0,212,255,0)')
      ctx.beginPath(); ctx.arc(CX, CY, coreR, 0, Math.PI * 2)
      ctx.fillStyle = coreGrad; ctx.fill()

      frameRef.current = frame + 1
      animId = requestAnimationFrame(() => draw(frameRef.current))
    }

    draw(0)
    return () => cancelAnimationFrame(animId)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  )
}
