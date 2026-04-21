/**
 * Render orchestration — owns render state so multiple panels (Export/Render
 * quick buttons + Custom Render button) can trigger renders and share one
 * progress display.
 *
 * Done-state is driven by the HTTP response, NOT the WebSocket. The backend
 * replays the cached current_status to every new WS client (main.py:307), so
 * trusting WS for "done" caused the prior job's DONE to mark a fresh render
 * complete before it had even started.
 */

import { useRef, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { buildRenderBody, type RenderOverrides } from '../lib/render'
import type { StudioSettings } from '../components/studio/StudioPanel'
import type { Segment } from '../types/app'
import { useToast } from './useToast'

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error'

export interface RenderController {
  status:    RenderStatus
  progress:  number
  message:   string
  elapsed:   string
  busy:      boolean
  startRender: (overrides?: RenderOverrides, outputDir?: string) => Promise<void>
  cancelRender: () => void
  reset:     () => void
}

interface UseRenderArgs {
  settings:     StudioSettings
  groups:       Segment[]
  groupsEdited: boolean
}

export function useRender({ settings, groups, groupsEdited }: UseRenderArgs): RenderController {
  const [status,   setStatus]   = useState<RenderStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [elapsed,  setElapsed]  = useState('')
  const [message,  setMessage]  = useState<string>('')
  const timerRef                = useRef<number | null>(null)
  const { toast }               = useToast()

  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    stopTimer()
    api.disconnectProgress()
    setStatus('idle')
    setProgress(0)
    setMessage('')
    setElapsed('')
  }, [stopTimer])

  const startRender = useCallback(async (overrides: RenderOverrides = {}, outputDir?: string) => {
    setStatus('rendering')
    setProgress(0)
    setElapsed('00:00')
    setMessage('Starting…')

    const t0 = Date.now()
    stopTimer()
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setElapsed(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`)
    }, 1000)

    // Track when the user actually started the render, so the WS replay of
    // the prior job's cached status doesn't pollute progress.
    const startedAt = Date.now()

    api.connectProgress(update => {
      // Ignore replays of the prior status that arrive in the first 200ms
      // (FastAPI sends current_status on connect — see main.py:307).
      if (Date.now() - startedAt < 200 && update.step === 'done') return
      setProgress(Math.round(update.pct))
      if (update.message) setMessage(update.message)
      if (update.step === 'error') {
        stopTimer()
        setStatus('error')
        api.disconnectProgress()
      }
      // 'done' is intentionally NOT handled here — driven by HTTP response below.
    })

    try {
      const body = buildRenderBody(settings, groups, groupsEdited, overrides, outputDir)
      await api.renderVideo(body)
      // HTTP response only resolves once the render actually finishes.
      stopTimer()
      setProgress(100)
      setStatus('done')
      api.disconnectProgress()
      toast('Render complete', 'success')
    } catch (err) {
      stopTimer()
      const msg = err instanceof Error ? err.message : 'Render failed'
      const cancelled = msg.toLowerCase().includes('cancel')
      setMessage(cancelled ? 'Cancelled.' : `Error: ${msg}`)
      setStatus(cancelled ? 'idle' : 'error')
      api.disconnectProgress()
      if (!cancelled) toast(msg, 'error')
    }
  }, [settings, groups, groupsEdited, stopTimer, toast])

  const cancelRender = useCallback(() => {
    api.cancelJob().catch(() => { /* ignore */ })
    api.disconnectProgress()
    stopTimer()
    setStatus('idle')
    setMessage('Cancelled.')
  }, [stopTimer])

  return {
    status, progress, message, elapsed,
    busy: status === 'rendering',
    startRender, cancelRender, reset,
  }
}
