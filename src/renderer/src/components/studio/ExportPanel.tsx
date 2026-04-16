/**
 * Export / Render panel — lives at the bottom of StudioPanel.
 * Ports the quick-render buttons + custom render options from the HTML.
 */

import { useState } from 'react'
import { StudioCard } from './StudioCard'
import { api } from '../../lib/api'
import type { StudioSettings } from './StudioPanel'

interface ExportPanelProps {
  settings: StudioSettings
}

type RenderStatus = 'idle' | 'rendering' | 'done' | 'error'

const RESOLUTIONS = [
  { value: '1920x1080', label: '1920×1080 (16:9 1080p)' },
  { value: '3840x2160', label: '3840×2160 (16:9 4K)' },
  { value: '1280x720',  label: '1280×720  (16:9 720p)' },
  { value: '1080x1920', label: '1080×1920 (9:16 1080p)' },
  { value: '1080x1080', label: '1080×1080 (1:1 Square)' },
]

const FORMATS = [
  { value: 'mp4',  label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9 + Alpha)' },
  { value: 'mov',  label: 'MOV (ProRes 4444)' },
]

const MODES = [
  { value: 'overlay', label: 'Transparent Overlay' },
  { value: 'baked',   label: 'Baked into Video' },
]

export function ExportPanel({ settings: _settings }: ExportPanelProps) {
  const [resolution, setResolution] = useState('1920x1080')
  const [format,     setFormat]     = useState('mp4')
  const [mode,       setMode]       = useState('overlay')
  const [status,     setStatus]     = useState<RenderStatus>('idle')
  const [progress,   setProgress]   = useState(0)
  const [elapsed,    setElapsed]    = useState('')
  const [showCustom, setShowCustom] = useState(false)

  async function startRender(quickMode?: 'baked' | 'overlay') {
    setStatus('rendering')
    setProgress(0)

    const params = {
      resolution: quickMode ? '1920x1080' : resolution,
      format:     quickMode ? 'mp4' : format,
      mode:       quickMode ?? mode,
    }

    const t0 = Date.now()
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    }, 1000)

    // Connect to progress WS for render updates
    api.connectProgress(update => {
      setProgress(update.pct)
      if (update.step === 'done')  { clearInterval(timer); setStatus('done')  }
      if (update.step === 'error') { clearInterval(timer); setStatus('error') }
    })

    try {
      await api.renderVideo(params)
    } catch {
      clearInterval(timer)
      setStatus('error')
    }
  }

  function cancelRender() {
    api.cancelJob().catch(() => {/**/})
    api.disconnectProgress()
    setStatus('idle')
  }

  return (
    <StudioCard title="Export / Render" defaultOpen>

      {/* Quick render buttons */}
      <div className="grid grid-cols-2 gap-2">
        <QuickRenderBtn
          icon={<VideoIcon />}
          title="Render Video"
          sub="MP4 · baked in"
          disabled={status === 'rendering'}
          onClick={() => startRender('baked')}
        />
        <QuickRenderBtn
          icon={<OverlayIcon />}
          title="Subtitles Only"
          sub="MOV · transparent"
          disabled={status === 'rendering'}
          onClick={() => startRender('overlay')}
        />
      </div>

      {/* SRT / ASS export row */}
      <div className="flex gap-1.5 mt-1">
        {(['srt', 'ass', 'vtt'] as const).map(fmt => (
          <button
            key={fmt}
            className="btn-ghost flex-1 text-[11px] py-1 justify-center"
            onClick={() => api.exportResult({ format: fmt }).catch(() => {})}
          >
            .{fmt.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Custom render toggle */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs w-full mt-1"
        style={{ color: 'var(--color-text-2)' }}
        onClick={() => setShowCustom(s => !s)}
      >
        <svg
          width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
          className="transition-transform"
          style={{ transform: showCustom ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
        Custom render
      </button>

      {showCustom && (
        <div className="flex flex-col gap-2 mt-1">
          <SelectRow label="Resolution" value={resolution} options={RESOLUTIONS} onChange={setResolution} />
          <SelectRow label="Format"     value={format}     options={FORMATS}      onChange={setFormat} />
          <SelectRow label="Mode"       value={mode}       options={MODES}        onChange={setMode} />
          <button
            className="btn-primary w-full justify-center mt-1"
            disabled={status === 'rendering'}
            onClick={() => startRender()}
          >
            Render with Custom Settings
          </button>
        </div>
      )}

      {/* Render progress */}
      {status === 'rendering' && (
        <div className="flex flex-col gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: 'var(--color-accent)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-2)' }}>{progress}%</span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-3)' }}>{elapsed}</span>
            <button className="btn-danger text-[11px] py-0.5 px-2.5" onClick={cancelRender}>Cancel</button>
          </div>
        </div>
      )}

      {status === 'done' && (
        <p className="text-xs mt-2" style={{ color: 'var(--color-success)' }}>✓ Render complete</p>
      )}
      {status === 'error' && (
        <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>Render failed — check logs</p>
      )}
    </StudioCard>
  )
}

// ── Sub-components ──────────────────────────────────────────

function QuickRenderBtn({ icon, title, sub, onClick, disabled }: {
  icon: React.ReactNode
  title: string
  sub: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border transition-all"
      style={{
        background: 'var(--color-surface-2)',
        borderColor: 'var(--color-border-2)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-3)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-2)' }}
    >
      <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{title}</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>{sub}</span>
    </button>
  )
}

function SelectRow({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>{label}</span>
      <select
        className="field-input flex-1 text-xs"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
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
