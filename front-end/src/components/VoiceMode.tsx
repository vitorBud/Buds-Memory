import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Mic, MicOff, PhoneOff, Square, Volume2 } from 'lucide-react'
import type { AiState, ThemeMode } from '../types'
import { voiceHaloStateStyles, voiceModeStyles, voiceRingStateStyles } from '../styles/modoVoz'

export type VoiceSilenceMode = 'fast' | 'balanced' | 'patient'

interface VoiceModeProps {
  aiState: AiState
  theme: ThemeMode
  isRecording: boolean
  recSeconds: number
  micVolume: number
  isProcessing: boolean
  availableVoices: SpeechSynthesisVoice[]
  selectedVoiceURI: string
  silenceMode: VoiceSilenceMode
  usesNeuralVoice?: boolean
  onMicToggle: () => void
  onStopOutput: () => void
  onVoiceChange: (voiceURI: string) => void
  onSilenceModeChange: (mode: VoiceSilenceMode) => void
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
  availableVoices,
  selectedVoiceURI,
  silenceMode,
  usesNeuralVoice = false,
  onMicToggle,
  onStopOutput,
  onVoiceChange,
  onSilenceModeChange,
  onExit,
}: VoiceModeProps) {
  const tone = useMemo(() => getVoiceTone(theme), [theme])
  const effectiveTone = aiState === 'error'
    ? { a: '#f43f5e', b: '#fb7185', c: tone.c }
    : tone
  const volume = Math.max(0.04, Math.min(1, micVolume))
  const status = STATUS_LABEL[aiState]
  const canInterrupt = isProcessing || aiState === 'speaking' || aiState === 'thinking'
  const voiceOptions = useMemo(() => {
    const ptVoices = availableVoices.filter(voice => voice.lang.toLowerCase().startsWith('pt'))
    return ptVoices.length ? ptVoices : availableVoices
  }, [availableVoices])
  const statusHint = isRecording
    ? `${recSeconds}s · toque para enviar`
    : aiState === 'error'
      ? 'Toque no núcleo e permita o microfone nos Ajustes'
      : canInterrupt
        ? 'Toque no nucleo para interromper e falar'
        : 'Toque no nucleo para falar'

  const handleCoreClick = () => {
    if (isRecording) {
      onMicToggle()
      return
    }

    if (canInterrupt) {
      onStopOutput()
      window.setTimeout(onMicToggle, 80)
      return
    }

    onMicToggle()
  }

  return (
    <section
      className={`voice-mode voice-mode-${theme} voice-state-${aiState} ${voiceModeStyles.root}`}
      style={{
        '--voice-a': effectiveTone.a,
        '--voice-b': effectiveTone.b,
        '--voice-c': effectiveTone.c,
        '--voice-volume': volume.toFixed(3),
      } as CSSProperties}
      aria-label="Modo Conversacao"
    >
      <div className={`voice-ambient ${voiceModeStyles.ambient}`} aria-hidden="true" />

      <div className={`voice-center-stage ${voiceModeStyles.stage}`}>
        <span className={voiceModeStyles.sessionBadge}>
          Conversa por voz · canal independente
        </span>
        <button
          type="button"
          className={`voice-core ${voiceModeStyles.core}`}
          onClick={handleCoreClick}
          aria-label={isRecording ? 'Enviar fala' : canInterrupt ? 'Interromper e falar' : 'Ativar microfone'}
          title={isRecording ? 'Enviar fala' : canInterrupt ? 'Interromper e falar' : 'Ativar microfone'}
        >
          <span className={`voice-core-halo ${voiceModeStyles.coreLayer} ${voiceHaloStateStyles[aiState] ?? ''}`} />
          <span className={`voice-core-orb ${voiceModeStyles.coreLayer} ${voiceModeStyles.orb}`}>
            <i className={`${voiceModeStyles.orbLayer} ${voiceModeStyles.ringOne} ${voiceRingStateStyles[aiState] ?? ''}`} />
            <i className={`${voiceModeStyles.orbLayer} ${voiceModeStyles.ringTwo} ${voiceRingStateStyles[aiState] ?? ''}`} />
            <i className={`${voiceModeStyles.orbLayer} ${voiceModeStyles.flow}`} />
            <b className={`${voiceModeStyles.orbLayer} ${voiceModeStyles.glow}`} />
          </span>
          <span className={`voice-core-grid ${voiceModeStyles.coreLayer} ${voiceModeStyles.grid}`} />
        </button>

        <div className={`voice-status ${voiceModeStyles.status}`} aria-live="polite">
          <strong>{status}</strong>
          <span>{statusHint}</span>
        </div>

        <div className={`voice-controls ${voiceModeStyles.controls}`} aria-label="Controles do modo conversa">
          {usesNeuralVoice ? (
            <div className={`voice-select-wrap ${voiceModeStyles.selectWrap}`} aria-label="Voz neural selecionada">
              <Volume2 size={15} />
              <span className={voiceModeStyles.neuralVoiceLabel}>Dora neural · pt-BR · no aparelho</span>
            </div>
          ) : (
            <label className={`voice-select-wrap ${voiceModeStyles.selectWrap}`}>
              <Volume2 size={15} />
              <select
                className={voiceModeStyles.select}
                value={selectedVoiceURI}
                onChange={(event) => onVoiceChange(event.target.value)}
                aria-label="Selecionar voz"
              >
                <option value="">Automática · melhor voz instalada</option>
                {voiceOptions.map(voice => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={`voice-sensitivity ${voiceModeStyles.sensitivity}`} aria-label="Tempo de resposta">
            {[
              ['fast', 'Rápida'],
              ['balanced', 'Normal'],
              ['patient', 'Paciente'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`${voiceModeStyles.sensitivityButton} ${silenceMode === mode ? `is-active ${voiceModeStyles.sensitivityActive}` : ''}`}
                onClick={() => onSilenceModeChange(mode as VoiceSilenceMode)}
              >
                {label}
              </button>
            ))}
          </div>

          {canInterrupt && (
            <button type="button" className={`voice-interrupt-button ${voiceModeStyles.interrupt}`} onClick={onStopOutput}>
              <Square size={13} />
              <span>Interromper</span>
            </button>
          )}
        </div>

        <button type="button" className={`voice-end-button ${voiceModeStyles.end}`} onClick={onExit}>
          <PhoneOff size={17} />
          <span>Encerrar conversa</span>
        </button>
      </div>

      <div className={`voice-mic-indicator ${voiceModeStyles.micIndicator}`} aria-hidden="true">
        {isRecording ? <Mic size={16} /> : <MicOff size={16} />}
      </div>
    </section>
  )
}
