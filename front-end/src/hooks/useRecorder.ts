import { useState, useRef, useCallback } from 'react'
import type { AiState } from '../types'

interface UseRecorderOptions {
  onStop: (blob: Blob) => void
  onStateChange: (s: AiState) => void
}

export function useRecorder({ onStop, onStateChange }: UseRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setIsRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async () => {
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      setSeconds(0)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        onStop(blob)
      }

      mr.start(200)
      setIsRecording(true)
      onStateChange('listening')

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s >= 30) { stop(); return s }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      console.error('[Recorder] Permission denied:', err)
      onStateChange('error')
      setTimeout(() => onStateChange('idle'), 2000)
    }
  }, [isRecording, onStateChange, onStop, stop])

  const toggle = useCallback(() => {
    if (isRecording) stop(); else start()
  }, [isRecording, start, stop])

  return { isRecording, seconds, toggle, stop }
}
