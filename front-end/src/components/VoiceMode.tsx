import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Volume2 } from 'lucide-react'
import type { AiState, ThemeMode } from '../types'
import { voiceHaloStateStyles, voiceModeStyles, voiceRingStateStyles } from '../styles/modoVoz'

interface VoiceModeProps {
  aiState: AiState
  theme: ThemeMode
  isRecording: boolean
  recSeconds: number
  micVolume: number
  partialTranscript?: string
  isProcessing: boolean
  availableVoices: SpeechSynthesisVoice[]
  selectedVoiceURI: string
  usesNeuralVoice?: boolean
  onMicToggle: () => void
  onStopOutput: () => void
  onVoiceChange: (voiceURI: string) => void
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
  partialTranscript = '',
  isProcessing,
  availableVoices,
  selectedVoiceURI,
  usesNeuralVoice = false,
  onMicToggle,
  onStopOutput,
  onVoiceChange,
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
  const isListeningTurn = isRecording && aiState === 'listening'
  const statusHint = isListeningTurn
    ? partialTranscript || `${recSeconds}s · pode falar naturalmente`
    : aiState === 'error'
      ? 'Toque no núcleo e permita o microfone nos Ajustes'
      : aiState === 'speaking'
        ? 'Toque no núcleo para interromper e falar'
      : canInterrupt
        ? 'Toque no núcleo para interromper e falar'
        : 'Toque no núcleo para falar'

  const handleCoreClick = () => {
    if (canInterrupt) {
      // O toque corta a reprodução imediatamente. No iPhone, damos um pequeno
      // intervalo para a AVAudioSession sair de playback antes de abrir o STT;
      // isso evita a disputa entre os dois motores sem reativar escuta passiva.
      onStopOutput()
      window.setTimeout(onMicToggle, aiState === 'speaking' ? 220 : 0)
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
          aria-label={canInterrupt ? 'Interromper resposta e começar a ouvir' : isListeningTurn ? 'Enviar fala' : 'Começar a ouvir'}
          title={canInterrupt ? 'Interromper resposta e começar a ouvir' : isListeningTurn ? 'Enviar fala' : 'Começar a ouvir'}
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
              <span className={voiceModeStyles.neuralVoiceLabel}>Dora natural · pt-BR · no aparelho</span>
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

        </div>
      </div>
    </section>
  )
}
