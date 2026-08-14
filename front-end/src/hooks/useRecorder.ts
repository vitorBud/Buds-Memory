import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import type { AiState } from '../types'
import {
  cancelIOSSpeechRecognition,
  startIOSSpeechRecognition,
  stopIOSSpeechRecognition,
} from '../plataformas'
import { transcribeAudioPartial } from '../services/api'
import {
  AdaptiveBargeInGate,
  AsyncOperationGate,
  RecordingChunkBuffer,
  TranscriptSilenceGate,
  VoiceEndpointDetector,
} from '../utils/controleOperacoes'
import type { VoiceCaptureMetrics, VoiceRecordingMode } from '../utils/controleOperacoes'

interface UseRecorderOptions {
  onStop: (blob: Blob, metrics: VoiceCaptureMetrics) => void
  onTranscript?: (text: string, metrics: VoiceCaptureMetrics) => void
  onSpeechStart?: (mode: VoiceRecordingMode) => void
  onStateChange: (s: AiState) => void
  autoStopOnSilence?: boolean
  silenceSeconds?: number
  speechThreshold?: number
  maxSeconds?: number
  noSpeechTimeoutSeconds?: number
}

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
]

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return AUDIO_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

// Cada captura possui ID, detector e buffer próprios. Callbacks atrasados de
// uma gravação anterior nunca podem alterar a gravação seguinte.
export function useRecorder({
  onStop,
  onTranscript,
  onSpeechStart,
  onStateChange,
  autoStopOnSilence = false,
  silenceSeconds = 1.45,
  speechThreshold = 0.08,
  maxSeconds = 30,
  noSpeechTimeoutSeconds = 8,
}: UseRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [volume, setVolume] = useState(0)
  const [partialTranscript, setPartialTranscript] = useState('')
  const [recordingMode, setRecordingMode] = useState<VoiceRecordingMode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaRecorderIdRef = useRef<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const volumeFrameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nativeListenerRef = useRef<PluginListenerHandle | null>(null)
  const detectorRef = useRef<VoiceEndpointDetector | null>(null)
  const operationGateRef = useRef(new AsyncOperationGate())
  const isRecordingRef = useRef(false)
  const isStoppingRef = useRef(false)
  const startedAtRef = useRef(0)
  const emitByOperationRef = useRef(new Map<string, boolean>())
  const nativeTranscriptRef = useRef('')
  const recordingModeRef = useRef<VoiceRecordingMode>('turn')
  const captureMetricsRef = useRef<VoiceCaptureMetrics | null>(null)
  const partialAbortRef = useRef<AbortController | null>(null)
  const partialInFlightRef = useRef(false)
  const lastPartialRequestAtRef = useRef(0)
  const mountedRef = useRef(true)
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

  const clearRealtimeResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (volumeFrameRef.current !== null) {
      cancelAnimationFrame(volumeFrameRef.current)
      volumeFrameRef.current = null
    }
    void audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
  }, [])

  const updateStoppedUI = useCallback(() => {
    isRecordingRef.current = false
    if (!mountedRef.current) return
    setIsRecording(false)
    setSeconds(0)
    setVolume(0)
  }, [])

  const stop = useCallback((emit = true) => {
    const recordingId = operationGateRef.current.current
    if (!recordingId || isStoppingRef.current) return
    isStoppingRef.current = true
    emitByOperationRef.current.set(recordingId, emit)
    clearRealtimeResources()
    updateStoppedUI()
    const metrics = captureMetricsRef.current ?? {
      recordingId,
      mode: recordingModeRef.current,
      captureStartedAt: startedAtRef.current,
    }
    metrics.speechEndedAt = performance.now()
    partialAbortRef.current?.abort()
    partialAbortRef.current = null

    if (isNativeIOS) {
      const listener = nativeListenerRef.current
      nativeListenerRef.current = null
      const captureMs = Math.round(performance.now() - startedAtRef.current)
      void (async () => {
        try {
          const result = emit
            ? await stopIOSSpeechRecognition(recordingId)
            : (await cancelIOSSpeechRecognition(recordingId), { text: '', recordingId })
          if (!operationGateRef.current.isActive(recordingId) || result.recordingId !== recordingId) return
          const transcript = (result.text || nativeTranscriptRef.current).trim()
          if (transcript) metrics.sttFinalAt = performance.now()
          console.info('[BudsPerf]', {
            stage: 'voice_capture', recording_id: recordingId, capture_ms: captureMs,
            transcription_chars: transcript.length, emitted: Boolean(emit && transcript),
          })
          if (emit && transcript) onTranscript?.(transcript, metrics)
          else if (metrics.mode !== 'barge-in') onStateChange('idle')
        } catch (error) {
          if (!operationGateRef.current.isActive(recordingId)) return
          console.error('[Recorder] Falha ao encerrar reconhecimento nativo:', error)
          onStateChange('error')
          window.setTimeout(() => onStateChange('idle'), 1_800)
        } finally {
          await listener?.remove().catch(() => {})
          emitByOperationRef.current.delete(recordingId)
          nativeTranscriptRef.current = ''
          captureMetricsRef.current = null
          operationGateRef.current.complete(recordingId)
          isStoppingRef.current = false
        }
      })()
      return
    }

    const recorder = mediaRecorderRef.current
    if (recorder && mediaRecorderIdRef.current === recordingId && recorder.state !== 'inactive') {
      try { recorder.requestData() } catch { /* Safari pode não suportar requestData neste estado */ }
      recorder.stop()
    } else {
      operationGateRef.current.complete(recordingId)
      emitByOperationRef.current.delete(recordingId)
      isStoppingRef.current = false
    }
  }, [clearRealtimeResources, isNativeIOS, onStateChange, onTranscript, updateStoppedUI])

  const start = useCallback(async (mode: VoiceRecordingMode = 'turn') => {
    if (isRecordingRef.current || isStoppingRef.current || operationGateRef.current.current) return
    const recordingId = operationGateRef.current.begin('recording')
    recordingModeRef.current = mode
    setRecordingMode(mode)
    lastPartialRequestAtRef.current = 0
    const detector = new VoiceEndpointDetector({
      speechThreshold: mode === 'barge-in' ? Math.max(0.22, speechThreshold * 2.8) : speechThreshold,
      silenceMs: silenceSeconds * 1_000,
      activationMs: mode === 'barge-in' ? 720 : 160,
      minimumSpeechMs: mode === 'barge-in' ? 650 : 320,
    })
    const bargeInGate = new AdaptiveBargeInGate()
    const nativeTranscriptGate = new TranscriptSilenceGate()
    detectorRef.current = detector
    startedAtRef.current = performance.now()
    captureMetricsRef.current = {
      recordingId,
      mode,
      captureStartedAt: startedAtRef.current,
    }
    nativeTranscriptRef.current = ''
    setPartialTranscript('')
    let speechStartNotified = false
    let hasBargeTranscriptEvidence = false

    const startTimer = () => {
      timerRef.current = setInterval(() => {
        if (!operationGateRef.current.isActive(recordingId)) return
        const now = performance.now()
        const elapsedMs = now - startedAtRef.current
        const nextSeconds = Math.floor(elapsedMs / 1_000)
        setSeconds(previous => previous === nextSeconds ? previous : nextSeconds)
        // No iPhone, ruído contínuo não pode segurar o turno indefinidamente.
        // Após uma transcrição real parar de evoluir, finalizamos mesmo que o
        // medidor ambiente continue acima do limiar.
        if (autoStopOnSilence
          && isNativeIOS
          && mode === 'turn'
          && nativeTranscriptGate.shouldFinalize(now, silenceSeconds * 1_000)) {
          stop(true)
        } else if (autoStopOnSilence && detector.tick(now)) {
          stop(true)
        } else if (autoStopOnSilence && !detector.hasConfirmedSpeech && elapsedMs >= noSpeechTimeoutSeconds * 1_000) {
          stop(false)
        } else if (elapsedMs >= maxSeconds * 1_000) {
          stop(!autoStopOnSilence || detector.hasConfirmedSpeech)
        }
      }, 200)
    }

    try {
      if (isNativeIOS) {
        const listener = await startIOSSpeechRecognition(recordingId, event => {
          if (event.recordingId !== recordingId || !operationGateRef.current.isActive(recordingId)) return
          const now = performance.now()
          const transcript = event.text.trim()
          const insideBargeInGuard = mode === 'barge-in' && now - startedAtRef.current < 1_100
          const inputVolume = Math.min(1, Math.max(0, event.volume))
          nativeTranscriptGate.observe(transcript, now)
          if (insideBargeInGuard) bargeInGate.calibrate(inputVolume)
          const acceptedVolume = mode !== 'barge-in' || bargeInGate.accepts(inputVolume)
            ? inputVolume
            : 0
          if (!insideBargeInGuard) detector.observeVolume(acceptedVolume, now)
          // Em barge-in, uma transcrição isolada pode ser eco do próprio TTS.
          // Ela só vira evidência após energia sustentada confirmar voz humana.
          const canUseTranscript = mode !== 'barge-in' || detector.hasConfirmedSpeech
          const acceptedTranscript = canUseTranscript && detector.observeTranscript(transcript, now)
          if (acceptedTranscript) {
            if (mode === 'barge-in' && transcript.length >= 3) hasBargeTranscriptEvidence = true
            nativeTranscriptRef.current = transcript
            setPartialTranscript(transcript)
            const metrics = captureMetricsRef.current
            if (metrics && !metrics.sttFirstPartialAt) metrics.sttFirstPartialAt = now
          }
          const shouldNotifySpeech = !speechStartNotified
            && detector.hasConfirmedSpeech
            && (mode !== 'barge-in' || (hasBargeTranscriptEvidence && acceptedVolume > 0))
          if (shouldNotifySpeech) {
            speechStartNotified = true
            const metrics = captureMetricsRef.current
            if (metrics && !metrics.speechStartedAt) metrics.speechStartedAt = now
            onSpeechStart?.(mode)
          }
          setVolume(Math.min(1, Math.max(0, event.volume)))
          if (event.isFinal && transcript && (mode !== 'barge-in' || speechStartNotified)) stop(true)
        }, mode)
        if (!operationGateRef.current.isActive(recordingId)) {
          await listener.remove()
          await cancelIOSSpeechRecognition(recordingId)
          return
        }
        nativeListenerRef.current = listener
        isRecordingRef.current = true
        setIsRecording(true)
        if (mode !== 'barge-in') onStateChange('listening')
        startTimer()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (!operationGateRef.current.isActive(recordingId)) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      const chunkBuffer = new RecordingChunkBuffer(recordingId)
      const preferredMimeType = getSupportedAudioMimeType()
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream)
      const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm'
      mediaRecorderRef.current = recorder
      mediaRecorderIdRef.current = recordingId

      recorder.ondataavailable = event => {
        chunkBuffer.append(recordingId, event.data)
        if (mode === 'barge-in' || !autoStopOnSilence || !detector.hasConfirmedSpeech || partialInFlightRef.current) return
        const now = performance.now()
        if (now - startedAtRef.current < 4_000) return
        if (now - lastPartialRequestAtRef.current < 1_800) return
        const snapshot = chunkBuffer.snapshot(recordingId, mimeType)
        if (!snapshot || snapshot.size < 8_000) return
        lastPartialRequestAtRef.current = now
        partialInFlightRef.current = true
        const partialController = new AbortController()
        partialAbortRef.current = partialController
        void transcribeAudioPartial(snapshot, partialController.signal).then(result => {
          if (!operationGateRef.current.isActive(recordingId) || !result.text) return
          setPartialTranscript(result.text)
          const metrics = captureMetricsRef.current
          if (metrics && !metrics.sttFirstPartialAt) metrics.sttFirstPartialAt = performance.now()
          console.info('[BudsVoicePerf]', {
            event: 'stt_partial', recording_id: recordingId,
            provider: result.provider, latency_ms: result.latencyMs,
          })
        }).catch(error => {
          if (!partialController.signal.aborted) console.warn('[Recorder] STT parcial indisponível:', error)
        }).finally(() => {
          if (partialAbortRef.current === partialController) partialAbortRef.current = null
          partialInFlightRef.current = false
        })
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        const chunkCount = chunkBuffer.chunkCount
        const blob = chunkBuffer.finalize(recordingId, mimeType) ?? new Blob([], { type: mimeType })
        const shouldEmit = emitByOperationRef.current.get(recordingId) !== false
        const isCurrent = operationGateRef.current.isActive(recordingId)
        console.info('[BudsPerf]', {
          stage: 'voice_capture', recording_id: recordingId,
          capture_ms: Math.round(performance.now() - startedAtRef.current),
          chunks: chunkCount, audio_bytes: blob.size, emitted: shouldEmit && isCurrent,
        })
        const metrics = captureMetricsRef.current ?? {
          recordingId,
          mode,
          captureStartedAt: startedAtRef.current,
          speechEndedAt: performance.now(),
        }
        if (shouldEmit && isCurrent && blob.size > 0) onStop(blob, metrics)
        emitByOperationRef.current.delete(recordingId)
        operationGateRef.current.complete(recordingId)
        if (mediaRecorderIdRef.current === recordingId) {
          mediaRecorderRef.current = null
          mediaRecorderIdRef.current = null
        }
        isStoppingRef.current = false
        captureMetricsRef.current = null
      }

      const AudioContextClass = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        const audioContext = new AudioContextClass()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.78
        audioContext.createMediaStreamSource(stream).connect(analyser)
        audioContextRef.current = audioContext
        const samples = new Uint8Array(analyser.frequencyBinCount)
        const measureVolume = () => {
          if (!operationGateRef.current.isActive(recordingId)) return
          analyser.getByteTimeDomainData(samples)
          let sum = 0
          for (const sample of samples) {
            const centered = (sample - 128) / 128
            sum += centered * centered
          }
          const normalized = Math.min(1, Math.sqrt(sum / samples.length) * 5.5)
          setVolume(normalized)
          if (autoStopOnSilence) {
            const now = performance.now()
            const insideBargeInGuard = mode === 'barge-in' && now - startedAtRef.current < 1_100
            const hadSpeech = detector.hasConfirmedSpeech
            if (insideBargeInGuard) bargeInGate.calibrate(normalized)
            const acceptedVolume = mode !== 'barge-in' || bargeInGate.accepts(normalized)
              ? normalized
              : 0
            if (!insideBargeInGuard) detector.observeVolume(acceptedVolume, now)
            if (!speechStartNotified && !hadSpeech && detector.hasConfirmedSpeech) {
              speechStartNotified = true
              const metrics = captureMetricsRef.current
              if (metrics && !metrics.speechStartedAt) metrics.speechStartedAt = now
              onSpeechStart?.(mode)
            }
            if (detector.tick(now)) {
              stop(true)
              return
            }
          }
          volumeFrameRef.current = requestAnimationFrame(measureVolume)
        }
        measureVolume()
      }

      recorder.start(200)
      isRecordingRef.current = true
      setIsRecording(true)
      setSeconds(0)
      setVolume(0)
      if (mode !== 'barge-in') onStateChange('listening')
      startTimer()
    } catch (error) {
      operationGateRef.current.complete(recordingId)
      isRecordingRef.current = false
      isStoppingRef.current = false
      console.error('[Recorder] Falha ao iniciar captura:', error)
      onStateChange('error')
      window.setTimeout(() => onStateChange('idle'), 2_000)
    }
  }, [autoStopOnSilence, isNativeIOS, maxSeconds, noSpeechTimeoutSeconds, onSpeechStart, onStateChange, onStop, silenceSeconds, speechThreshold, stop])

  const toggle = useCallback(() => {
    if (isRecordingRef.current) stop(!autoStopOnSilence || Boolean(detectorRef.current?.hasConfirmedSpeech))
    else void start('turn')
  }, [autoStopOnSilence, start, stop])

  const cancel = useCallback(() => {
    if (operationGateRef.current.current) stop(false)
  }, [stop])

  useEffect(() => () => {
    mountedRef.current = false
    const id = operationGateRef.current.current
    if (id) {
      emitByOperationRef.current.set(id, false)
      if (isNativeIOS) void cancelIOSSpeechRecognition(id)
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }
    clearRealtimeResources()
    partialAbortRef.current?.abort()
    void nativeListenerRef.current?.remove().catch(() => {})
    nativeListenerRef.current = null
    operationGateRef.current.cancel()
  }, [clearRealtimeResources, isNativeIOS])

  return { isRecording, recordingMode, seconds, volume, partialTranscript, toggle, start, stop, cancel }
}
