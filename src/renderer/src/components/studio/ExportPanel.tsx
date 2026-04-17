/**
 * Export / Render panel — quick-render buttons + full custom render flow.
 * Ports renderSubtitleVideo() from app.js:3644-3760.
 *
 * The payload sent to /api/render-video is assembled by buildRenderBody()
 * (lib/render.ts). This component is just UI + progress wiring.
 */

import { useRef, useState } from 'react'
import { StudioCard } from './StudioCard'
import { api } from '../../lib/api'
import { buildRenderBody, type RenderOverrides } from '../../lib/render'
import type { StudioSettings } from './StudioPanel'
import type { Segment } from '../../types/app'

interface ExportPanelProps {
  settings:     StudioSettings
  groups:       Segment[]
  groupsEdited: boolean
}

type RenderStatus = 'idle' | 'rendering' | 'done' | 'error'

export function ExportPanel({ settings, groups, groupsEdited }: ExportPanelProps) {
  const [status,    setStatus]    = useState<RenderStatus>('idle')
  const [progress,  setProgress]  = useState(0)
  const [elapsed,   setElapsed]   = useState('')
  const [message,   setMessage]   = useState<string>('')
  const [outputDir, setOutputDir] = useState<string>('')
  const timerRef                  = useRef<number | null>(null)

  function stopTimer() {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function startRender(overrides: RenderOverrides = {}) {
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

    api.connectProgress(update => {
      setProgress(update.pct)
      if (update.message)     setMessage(update.message)
      if (update.step === 'done')  { stopTimer(); setStatus('done');  api.disconnectProgress() }
      if (update.step === 'error') { stopTimer(); setStatus('error'); api.disconnectProgress() }
    })

    try {
      const body = buildRenderBody(settings, groups, groupsEdited, overrides, outputDir || undefined)
      await api.renderVideo(body)
    } catch (err) {
      stopTimer()
      const msg = err instanceof Error ? err.message : 'Render failed'
      const cancelled = msg.toLowerCase().includes('cancel')
      setMessage(cancelled ? 'Cancelled.' : `Error: ${msg}`)
      setStatus(cancelled ? 'idle' : 'error')
      api.disconnectProgress()
    }
  }

  function cancelRender() {
    api.cancelJob().catch(() => { /* ignore */ })
    api.disconnectProgress()
    stopTimer()
    setStatus('idle')
    setMessage('Cancelled.')
  }

  const busy = status === 'rendering'

  return (
    <StudioCard title="Export / Render" defaultOpen>

      {/* Output folder picker */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-[var(--color-text-3)] shrink-0">Output:</span>
        <span
          className="flex-1 min-w-0 text-[11px] text-[var(--color-text-2)] truncate px-1.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
          title={outputDir || 'Same as source file'}
        >
          {outputDir ? outputDir.split('/').pop() || outputDir : 'Same as source'}
        </span>
        <button
          className="btn-ghost text-[11px] py-1 px-2 shrink-0"
          onClick={async () => {
            const dir = await window.subforge.pickOutputDir()
            if (dir) setOutputDir(dir)
          }}
          disabled={busy}
        >
          Browse
        </button>
      </div>

      {/* Quick render buttons — fixed 1080p MP4 baked / MOV overlay. */}
      <div className="grid grid-cols-2 gap-2">
        <QuickRenderBtn
          icon={<VideoIcon />}
          title="Render Video"
          sub="MP4 · baked in"
          disabled={busy}
          onClick={() => startRender({ renderMode: 'baked', format: 'mp4', resolution: [1920, 1080] })}
        />
        <QuickRenderBtn
          icon={<OverlayIcon />}
          title="Subtitles Only"
          sub="MOV · transparent"
          disabled={busy}
          onClick={() => startRender({ renderMode: 'overlay', format: 'mov', resolution: [1920, 1080] })}
        />
      </div>

      {/* SRT / ASS / VTT export row */}
      <div className="flex gap-1.5 mt-1">
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult({ formats: ['srt_word'] }).catch(() => {})}
          disabled={busy}
          title="Word-aligned SRT (per-word timing)"
        >
          .SRT (Word)
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult({ formats: ['srt_standard'] }).catch(() => {})}
          disabled={busy}
          title="Classic SRT (sentence timing)"
        >
          .SRT
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult({ formats: ['vtt'] }).catch(() => {})}
          disabled={busy}
        >
          .VTT
        </button>
      </div>

      {/* Custom render — uses everything from the Render card above. */}
      <button
        className="btn-primary w-full justify-center mt-2"
        disabled={busy}
        onClick={() => startRender()}
      >
        Render with current settings
      </button>
      <p className="text-[10px] text-[var(--color-text-3)] text-center">
        {settings.resolution[0]}×{settings.resolution[1]} · {settings.fps}fps · {settings.format.toUpperCase()} · {settings.renderMode}
      </p>

      {/* Render progress */}
      {busy && (
        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
          <div className="w-full h-1 rounded-full overflow-hidden bg-[var(--color-surface-3)]">
            <div
              className="h-full rounded-full transition-all duration-300 bg-[var(--color-accent)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-[var(--color-text-2)]">{progress}%</span>
            <span className="text-[10px] text-[var(--color-text-3)] truncate flex-1">{message}</span>
            <span className="text-xs tabular-nums text-[var(--color-text-3)]">{elapsed}</span>
            <button className="btn-danger text-[11px] py-0.5 px-2.5" onClick={cancelRender}>Cancel</button>
          </div>
        </div>
      )}

      {status === 'done' && (
        <p className="text-xs mt-2 text-[var(--color-success)]">✓ Render complete</p>
      )}
      {status === 'error' && (
        <p className="text-xs mt-2 text-[var(--color-danger)]">{message || 'Render failed — check logs'}</p>
      )}
    </StudioCard>
  )
}

// ── Sub-components ──────────────────────────────────────────

function QuickRenderBtn({ icon, title, sub, onClick, disabled }: {
  icon:     React.ReactNode
  title:    string
  sub:      string
  onClick:  () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border transition-all bg-[var(--color-surface-2)] border-[var(--color-border-2)] disabled:opacity-50"
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-3)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-2)' }}
    >
      <span className="text-[var(--color-accent)]">{icon}</span>
      <span className="text-xs font-semibold text-[var(--color-text)]">{title}</span>
      <span className="text-[10px] text-[var(--color-text-3)]">{sub}</span>
    </button>
  )
}

function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1ZM1.5 2.75v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25ZM6.5 5a.75.75 0 0 1 .4.114l4 2.667a.75.75 0 0 1 0 1.248l-4 2.667A.75.75 0 0 1 5.75 11V5.75A.75.75 0 0 1 6.5 5Z"/>
    </svg>
  )
}

function OverlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm6-2.19 3.5 2.19-3.5 2.19V5.81Z"/>
    </svg>
  )
}
