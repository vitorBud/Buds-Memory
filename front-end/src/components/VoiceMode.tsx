import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import type { AiState, ThemeMode } from '../types'

interface VoiceModeProps {
  aiState: AiState
  theme: ThemeMode
  isRecording: boolean
  recSeconds: number
  micVolume: number
  isProcessing: boolean
  onMicToggle: () => void
  onExit: () => void
}

const STATUS_LABEL: Record<AiState, string> = {
  idle: 'Aguardando...',
  listening: 'Ouvindo...',
  transcribing: 'Conectando...',
  thinking: 'Pensando...',
  speaking: 'Respondendo...',
  error: 'Microfone desativado',
}

function getVoiceTone(theme: ThemeMode) {
  switch (theme) {
    case 'gold':
      return { a: '#fbbf24', b: '#f59e0b', c: '#fff7d6' }
    case 'silver':
      return { a: '#e5e7eb', b: '#94a3b8', c: '#ffffff' }
    case 'white':
      return { a: '#38bdf8', b: '#e5e7eb', c: '#ffffff' }
    case 'black':
    default:
      return { a: '#22d3ee', b: '#8b5cf6', c: '#f8fafc' }
  }
}

// Tela dedicada de voz: minima, imersiva e controlada pelo estado real do chat.
export function VoiceMode({
  aiState,
  theme,
  isRecording,
  recSeconds,
  micVolume,
  isProcessing,
  onMicToggle,
  onExit,
}: VoiceModeProps) {
  const tone = useMemo(() => getVoiceTone(theme), [theme])
  const volume = Math.max(0.04, Math.min(1, micVolume))
  const status = STATUS_LABEL[aiState]
  const canToggleMic = !isProcessing || isRecording

  return (
    <section
      className={`voice-mode voice-mode-${theme} voice-state-${aiState}`}
      style={{
        '--voice-a': tone.a,
        '--voice-b': tone.b,
        '--voice-c': tone.c,
        '--voice-volume': volume.toFixed(3),
      } as CSSProperties}
      aria-label="Modo Conversacao"
    >
      <div className="voice-ambient" aria-hidden="true" />

      <button
        type="button"
        className="voice-core"
        onClick={canToggleMic ? onMicToggle : undefined}
        disabled={!canToggleMic}
        aria-label={isRecording ? 'Enviar fala' : 'Ativar microfone'}
        title={isRecording ? 'Enviar fala' : 'Ativar microfone'}
      >
        <span className="voice-core-halo" />
        <span className="voice-core-orb">
          <i />
          <i />
          <i />
          <b />
        </span>
        <span className="voice-core-grid" />
        <span className="voice-core-particles">
          {Array.from({ length: 18 }).map((_, index) => (
            <em key={index} style={{ '--p': index } as CSSProperties} />
          ))}
        </span>
      </button>

      <div className="voice-status" aria-live="polite">
        <strong>{status}</strong>
        <span>
          {isRecording ? `${recSeconds}s` : aiState === 'error' ? 'Verifique permissao do microfone' : 'Toque no nucleo para falar'}
        </span>
      </div>

      <button type="button" className="voice-end-button" onClick={onExit}>
        <PhoneOff size={17} />
        <span>Encerrar conversa</span>
      </button>

      <div className="voice-mic-indicator" aria-hidden="true">
        {isRecording ? <Mic size={16} /> : <MicOff size={16} />}
      </div>
    </section>
  )
}
