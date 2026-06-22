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
import type { EffectClip, Segment } from '../types/app'
import { useToast } from './useToast'

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error'

/** Which renderer fulfils the job: CapForge's Pillow renderer or HyperFrames (GSAP). */
export type RenderEngine = 'pillow' | 'hyperframes'

export interface RenderController {
  status: RenderStatus
  progress: number
  message: string
  elapsed: string
  busy: boolean
  /** Absolute path of the most recent successful render, for "Reveal in Finder". */
  lastOutputFile: string | null
  startRender: (
    overrides?: RenderOverrides,
    outputDir?: string,
    engine?: RenderEngine
  ) => Promise<void>
  /** Generate a HyperFrames project (no render) and open it in the local Studio webapp. */
  openStudio: (outputDir?: string) => Promise<void>
  cancelRender: () => void
  reset: () => void
}

interface UseRenderArgs {
  settings: StudioSettings
  groups: Segment[]
  groupsEdited: boolean
  effects: EffectClip[]
}

export function useRender({
  settings,
  groups,
  groupsEdited,
  effects,
}: UseRenderArgs): RenderController {
  const [status, setStatus] = useState<RenderStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState('')
  const [message, setMessage] = useState<string>('')
  const [lastOutputFile, setLastOutputFile] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const { toast } = useToast()

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
    setLastOutputFile(null)
  }, [stopTimer])

  const startRender = useCallback(
    async (
      overrides: RenderOverrides = {},
      outputDir?: string,
      engine: RenderEngine = 'pillow'
    ) => {
      setStatus('rendering')
      setProgress(0)
      setElapsed('00:00')
      setMessage('Starting…')
      setLastOutputFile(null)

      const t0 = Date.now()
      stopTimer()
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000)
        setElapsed(
          `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        )
      }, 1000)

      // Track when the user actually started the render, so the WS replay of
      // the prior job's cached status doesn't pollute progress.
      const startedAt = Date.now()

      api.connectProgress((update) => {
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
        const body = buildRenderBody(settings, groups, groupsEdited, overrides, outputDir, effects)
        const res = (await (engine === 'hyperframes'
          ? api.exportHyperframes(body)
          : api.renderVideo(body))) as { file?: string | null }
        // HTTP response only resolves once the render actually finishes.
        stopTimer()
        setProgress(100)
        setLastOutputFile(res?.file ?? null)
        setStatus('done')
        api.disconnectProgress()
        toast(
          engine === 'hyperframes' ? 'HyperFrames render complete' : 'Render complete',
          'success'
        )
      } catch (err) {
        stopTimer()
        const msg = err instanceof Error ? err.message : 'Render failed'
        const cancelled = msg.toLowerCase().includes('cancel')
        setMessage(cancelled ? 'Cancelled.' : `Error: ${msg}`)
        setStatus(cancelled ? 'idle' : 'error')
        api.disconnectProgress()
        if (!cancelled) toast(msg, 'error')
      }
    },
    [settings, groups, groupsEdited, effects, stopTimer, toast]
  )

  // Generate the HyperFrames project folder (render:false) and hand it to the
  // Electron-managed `npx hyperframes preview` studio. Separate from startRender
  // because this never renders — it only scaffolds + opens the preview webapp.
  const openStudio = useCallback(
    async (outputDir?: string) => {
      try {
        toast('Building HyperFrames project…', 'info')
        const body = buildRenderBody(settings, groups, groupsEdited, {}, outputDir, effects)
        const res = (await api.exportHyperframes({ ...body, render: false })) as {
          project?: string
        }
        if (!res?.project) throw new Error('No project folder was generated.')
        const opened = await window.subforge.openStudio(res.project)
        if (opened?.error) throw new Error(opened.error)
        toast('HyperFrames Studio opened in your browser', 'success')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not open HyperFrames Studio'
        toast(msg, 'error')
      }
    },
    [settings, groups, groupsEdited, effects, toast]
  )

  const cancelRender = useCallback(() => {
    api.cancelJob().catch(() => {
      /* ignore */
    })
    api.disconnectProgress()
    stopTimer()
    setStatus('idle')
    setMessage('Cancelled.')
  }, [stopTimer])

  return {
    status,
    progress,
    message,
    elapsed,
    busy: status === 'rendering',
    lastOutputFile,
    startRender,
    openStudio,
    cancelRender,
    reset,
  }
}
