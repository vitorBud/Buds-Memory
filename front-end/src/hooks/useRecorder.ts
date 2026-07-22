import { useState, useRef, useCallback } from 'react'
import type { AiState } from '../types'

interface UseRecorderOptions {
  onStop: (blob: Blob) => void
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
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  return AUDIO_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

// Hook de gravação do microfone usado para capturar áudio e enviar ao backend.
export function useRecorder({
  onStop,
  onStateChange,
  autoStopOnSilence = false,
  silenceSeconds = 1.25,
  speechThreshold = 0.08,
  maxSeconds = 30,
  noSpeechTimeoutSeconds = 8,
}: UseRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [volume, setVolume] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const volumeFrameRef = useRef<number | null>(null)
  const emitOnStopRef = useRef(true)
  const startedTalkingRef = useRef(false)
  const silenceStartedAtRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback((emit = true) => {
    emitOnStopRef.current = emit
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (volumeFrameRef.current) {
      cancelAnimationFrame(volumeFrameRef.current)
      volumeFrameRef.current = null
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    analyserRef.current = null
    startedTalkingRef.current = false
    silenceStartedAtRef.current = null
    setIsRecording(false)
    setSeconds(0)
    setVolume(0)
  }, [])

  const start = useCallback(async () => {
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      chunksRef.current = []
      startedTalkingRef.current = false
      silenceStartedAtRef.current = null
      setSeconds(0)
      setVolume(0)

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        const audioContext = new AudioContextClass()
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.78
        source.connect(analyser)
        audioContextRef.current = audioContext
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
        const measureVolume = () => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i += 1) {
            const centered = (data[i] - 128) / 128
            sum += centered * centered
          }
          const rms = Math.sqrt(sum / data.length)
          const normalizedVolume = Math.min(1, rms * 5.5)
          setVolume(normalizedVolume)

          if (autoStopOnSilence) {
            const now = performance.now()
            if (normalizedVolume > speechThreshold) {
              startedTalkingRef.current = true
              silenceStartedAtRef.current = null
            } else if (startedTalkingRef.current) {
              silenceStartedAtRef.current ??= now
              if (now - silenceStartedAtRef.current > silenceSeconds * 1000) {
                stop(true)
                return
              }
            }
          }

          volumeFrameRef.current = requestAnimationFrame(measureVolume)
        }
        measureVolume()
      }

      const preferredMimeType = getSupportedAudioMimeType()
      const mr = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream)
      const mimeType = mr.mimeType || preferredMimeType || 'audio/webm'
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (emitOnStopRef.current && blob.size > 0) onStop(blob)
        emitOnStopRef.current = true
        chunksRef.current = []
      }

      mr.start(200)
      setIsRecording(true)
      onStateChange('listening')

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (autoStopOnSilence && !startedTalkingRef.current && s >= noSpeechTimeoutSeconds) {
            stop(false)
            return s
          }
          if (s >= maxSeconds) {
            stop(!autoStopOnSilence || startedTalkingRef.current)
            return s
          }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      console.error('[Recorder] Permission denied:', err)
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 2000)
    }
  }, [autoStopOnSilence, isRecording, maxSeconds, noSpeechTimeoutSeconds, onStateChange, onStop, silenceSeconds, speechThreshold, stop])

  const toggle = useCallback(() => {
    if (isRecording) {
      stop(!autoStopOnSilence || startedTalkingRef.current)
    } else {
      start()
    }
  }, [autoStopOnSilence, isRecording, start, stop])

  const cancel = useCallback(() => {
    if (isRecording) stop(false)
  }, [isRecording, stop])

  return { isRecording, seconds, volume, toggle, stop, cancel }
}
