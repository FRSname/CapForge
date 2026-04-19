/**
 * Manages a transcription job via the CapForge backend API.
 * Mirrors the flow in renderer/js/app.js: POST /api/transcribe,
 * stream /ws/progress, then GET /api/result.
 */

import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ProgressUpdate } from '../lib/api'
import type { TranscriptionResult } from '../types/app'

interface TranscriptionOptions {
  language?: string
  diarize?: boolean
  hfToken?: string
  outputDir?: string
}

interface UseTranscriptionReturn {
  progress: ProgressUpdate | null
  start: (filePath: string, options?: TranscriptionOptions) => Promise<TranscriptionResult>
  cancel: () => void
}

export function useTranscription(): UseTranscriptionReturn {
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const cancelledRef = useRef(false)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    api.disconnectProgress()
    api.cancelJob().catch(() => {/* best-effort */})
  }, [])

  const start = useCallback(async (
    filePath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> => {
    cancelledRef.current = false
    setProgress(null)

    // Ensure API knows the current port
    const port = await window.subforge.getBackendPort()
    api.setPort(port)

    // Subscribe to progress BEFORE posting — backend's HTTP POST is synchronous
    // (it only returns 200 when the job is fully done), so we must be listening
    // on the WebSocket first or we miss every progress event.
    api.connectProgress((update: ProgressUpdate) => {
      if (cancelledRef.current) return
      setProgress(update)
    })

    try {
      // Blocks until the job is done on the server (possibly minutes)
      await api.startTranscription({
        audio_path:         filePath,
        language:           options.language || undefined,
        enable_diarization: options.diarize ?? false,
        hf_token:           options.hfToken || undefined,
        output_dir:         options.outputDir || undefined,
      })

      if (cancelledRef.current) throw new Error('Cancelled')

      // Job finished successfully — fetch the full result
      const raw = await api.getResult()
      api.disconnectProgress()

      const result: TranscriptionResult = {
        segments: raw.segments.map(s => ({
          id:      s.id ?? crypto.randomUUID(),
          start:   s.start,
          end:     s.end,
          text:    s.text,
          words:   s.words,
          speaker: s.speaker,
        })),
        language:  raw.language,
        duration:  raw.duration,
        audioPath: raw.audio_path,
      }
      return result
    } catch (err) {
      api.disconnectProgress()
      throw err
    }
  }, [])

  return { progress, start, cancel }
}
