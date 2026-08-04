import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import type { AiState } from '../types'
import {
  cancelIOSSpeechRecognition,
  startIOSSpeechRecognition,
  stopIOSSpeechRecognition,
} from '../services/iosLocal'
import { AsyncOperationGate, RecordingChunkBuffer, VoiceEndpointDetector } from '../utils/controleOperacoes'

interface UseRecorderOptions {
  onStop: (blob: Blob) => void
  onTranscript?: (text: string) => void
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
          console.info('[BudsPerf]', {
            stage: 'voice_capture', recording_id: recordingId, capture_ms: captureMs,
            transcription_chars: transcript.length, emitted: Boolean(emit && transcript),
          })
          if (emit && transcript) onTranscript?.(transcript)
          else onStateChange('idle')
        } catch (error) {
          if (!operationGateRef.current.isActive(recordingId)) return
          console.error('[Recorder] Falha ao encerrar reconhecimento nativo:', error)
          onStateChange('error')
          window.setTimeout(() => onStateChange('idle'), 1_800)
        } finally {
          await listener?.remove().catch(() => {})
          emitByOperationRef.current.delete(recordingId)
          nativeTranscriptRef.current = ''
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

  const start = useCallback(async () => {
    if (isRecordingRef.current || isStoppingRef.current || operationGateRef.current.current) return
    const recordingId = operationGateRef.current.begin('recording')
    const detector = new VoiceEndpointDetector({
      speechThreshold,
      silenceMs: silenceSeconds * 1_000,
      activationMs: 160,
      minimumSpeechMs: 320,
    })
    detectorRef.current = detector
    startedAtRef.current = performance.now()
    nativeTranscriptRef.current = ''

    const startTimer = () => {
      timerRef.current = setInterval(() => {
        if (!operationGateRef.current.isActive(recordingId)) return
        const elapsedMs = performance.now() - startedAtRef.current
        const nextSeconds = Math.floor(elapsedMs / 1_000)
        setSeconds(previous => previous === nextSeconds ? previous : nextSeconds)
        if (autoStopOnSilence && detector.tick(performance.now())) {
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
          if (detector.observeTranscript(transcript, now)) nativeTranscriptRef.current = transcript
          detector.observeVolume(Math.min(1, Math.max(0, event.volume)), now)
          setVolume(Math.min(1, Math.max(0, event.volume)))
          if (event.isFinal && transcript) stop(true)
        })
        if (!operationGateRef.current.isActive(recordingId)) {
          await listener.remove()
          await cancelIOSSpeechRecognition(recordingId)
          return
        }
        nativeListenerRef.current = listener
        isRecordingRef.current = true
        setIsRecording(true)
        onStateChange('listening')
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
        if (shouldEmit && isCurrent && blob.size > 0) onStop(blob)
        emitByOperationRef.current.delete(recordingId)
        operationGateRef.current.complete(recordingId)
        if (mediaRecorderIdRef.current === recordingId) {
          mediaRecorderRef.current = null
          mediaRecorderIdRef.current = null
        }
        isStoppingRef.current = false
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
            detector.observeVolume(normalized, performance.now())
            if (detector.tick(performance.now())) {
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
      onStateChange('listening')
      startTimer()
    } catch (error) {
      operationGateRef.current.complete(recordingId)
      isRecordingRef.current = false
      isStoppingRef.current = false
      console.error('[Recorder] Falha ao iniciar captura:', error)
      onStateChange('error')
      window.setTimeout(() => onStateChange('idle'), 2_000)
    }
  }, [autoStopOnSilence, isNativeIOS, maxSeconds, noSpeechTimeoutSeconds, onStateChange, onStop, silenceSeconds, speechThreshold, stop])

  const toggle = useCallback(() => {
    if (isRecordingRef.current) stop(!autoStopOnSilence || Boolean(detectorRef.current?.hasConfirmedSpeech))
    else void start()
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
    void nativeListenerRef.current?.remove().catch(() => {})
    nativeListenerRef.current = null
    operationGateRef.current.cancel()
  }, [clearRealtimeResources, isNativeIOS])

  return { isRecording, seconds, volume, toggle, stop, cancel }
}
