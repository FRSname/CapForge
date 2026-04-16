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
  model?: string
  diarize?: boolean
  outputDir?: string
}

interface UseTranscriptionReturn {
  progress: ProgressUpdate | null
  start: (filePath: string, options?: TranscriptionOptions) => Promise<TranscriptionResult>
  cancel: () => void
}

export function useTranscription(): UseTranscriptionReturn {
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const resolveRef = useRef<((result: TranscriptionResult) => void) | null>(null)
  const rejectRef  = useRef<((err: Error) => void) | null>(null)
  const cancelledRef = useRef(false)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    api.disconnectProgress()
    api.cancelJob().catch(() => {/* best-effort */})
    rejectRef.current?.(new Error('Cancelled'))
    resolveRef.current = null
    rejectRef.current = null
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

    // Kick off the job
    await api.startTranscription({
      file_path: filePath,
      language:  options.language,
      model:     options.model,
      diarize:   options.diarize,
      output_dir: options.outputDir,
    })

    return new Promise<TranscriptionResult>((resolve, reject) => {
      resolveRef.current = resolve
      rejectRef.current  = reject

      api.connectProgress((update: ProgressUpdate) => {
        if (cancelledRef.current) return

        setProgress(update)

        if (update.step === 'done') {
          api.disconnectProgress()
          // Map from API result shape to our app types
          api.getResult().then(raw => {
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
            resolve(result)
          }).catch(reject)
        } else if (update.step === 'error') {
          api.disconnectProgress()
          reject(new Error(update.message))
        }
      })
    })
  }, [])

  return { progress, start, cancel }
}
