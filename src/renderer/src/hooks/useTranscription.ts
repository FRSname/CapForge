/**
 * Manages a transcription job: connects to the backend WebSocket, streams
 * progress events, and resolves with the final TranscriptionResult.
 *
 * Usage:
 *   const { progress, start, cancel } = useTranscription()
 *   await start(filePath, options)
 */

import { useCallback, useRef, useState } from 'react'
import type { ProgressEvent, TranscriptionResult } from '../types/app'

interface TranscriptionOptions {
  language?: string
  model?: string
  diarize?: boolean
}

interface UseTranscriptionReturn {
  progress: ProgressEvent | null
  start: (filePath: string, options?: TranscriptionOptions) => Promise<TranscriptionResult>
  cancel: () => void
}

export function useTranscription(): UseTranscriptionReturn {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const cancel = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const start = useCallback(async (
    filePath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> => {
    const port = await window.subforge.getBackendPort()
    const baseUrl = `http://127.0.0.1:${port}`

    // POST to kick off the job
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, ...options }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail ?? 'Transcription failed')
    }

    const { job_id } = await res.json() as { job_id: string }

    // Stream progress over WebSocket
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/progress/${job_id}`)
      wsRef.current = ws

      ws.onmessage = (e: MessageEvent) => {
        const event = JSON.parse(e.data as string) as ProgressEvent
        setProgress(event)

        if (event.step === 'done') {
          ws.close()
          // Fetch final result
          fetch(`${baseUrl}/result/${job_id}`)
            .then(r => r.json() as Promise<TranscriptionResult>)
            .then(resolve)
            .catch(reject)
        } else if (event.step === 'error') {
          ws.close()
          reject(new Error(event.message))
        }
      }

      ws.onerror = () => reject(new Error('WebSocket error'))
      ws.onclose = (e) => { if (!e.wasClean) reject(new Error('WebSocket closed unexpectedly')) }
    })
  }, [])

  return { progress, start, cancel }
}
