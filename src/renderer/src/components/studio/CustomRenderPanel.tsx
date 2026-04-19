/**
 * Custom Render — full-control render settings + "Render with current settings"
 * button. Sits below Export/Render and shares the render controller so progress
 * is shown in one consistent place (StudioPanel renders the progress bar).
 */

import { StudioCard } from './StudioCard'
import { dirname } from '../../lib/render'
import type { StudioSettings } from './StudioPanel'
import type { RenderController } from '../../hooks/useRender'

const RESOLUTION_PRESETS: Array<{ value: [number, number]; label: string }> = [
  { value: [1920, 1080], label: '1920×1080 (16:9 1080p)' },
  { value: [3840, 2160], label: '3840×2160 (16:9 4K)' },
  { value: [1280, 720],  label: '1280×720 (16:9 720p)' },
  { value: [1080, 1920], label: '1080×1920 (9:16 1080p)' },
  { value: [2160, 3840], label: '2160×3840 (9:16 4K)' },
  { value: [1080, 1350], label: '1080×1350 (4:5 Instagram)' },
  { value: [1080, 1080], label: '1080×1080 (1:1 Square)' },
]

const FPS_PRESETS = [24, 25, 30, 48, 50, 60]

function buildResolutionOptions(current: [number, number], isSource: boolean) {
  const key = (w: number, h: number) => `${w}x${h}`
  const currentKey = key(current[0], current[1])
  const preset = RESOLUTION_PRESETS.find(p => key(p.value[0], p.value[1]) === currentKey)
  const opts: Array<{ value: string; label: string }> = []
  if (!preset && isSource) {
    opts.push({ value: currentKey, label: `${current[0]}×${current[1]} (Source)` })
  }
  for (const p of RESOLUTION_PRESETS) {
    opts.push({ value: key(p.value[0], p.value[1]), label: p.label })
  }
  return opts
}

interface CustomRenderPanelProps {
  settings:  StudioSettings
  onChange:  (s: StudioSettings) => void
  audioPath: string
  outputDir: string
  render:    RenderController
}

export function CustomRenderPanel({ settings, onChange, audioPath, outputDir, render }: CustomRenderPanelProps) {
  const s = settings
  function set<K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) {
    onChange({ ...s, [key]: val })
  }

  const { busy, startRender } = render
  const effectiveOutputDir = outputDir || dirname(audioPath)

  return (
    <StudioCard title="Custom Render" defaultOpen={false}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Resolution</span>
        <select
          className="field-input flex-1 min-w-0 text-xs"
          value={`${s.resolution[0]}x${s.resolution[1]}`}
          onChange={e => {
            const [w, h] = e.target.value.split('x').map(Number) as [number, number]
            const picked = RESOLUTION_PRESETS.some(p => p.value[0] === w && p.value[1] === h)
            const nextIsSource = !picked && s.resolutionIsSource
            onChange({ ...s, resolution: [w, h] as [number, number], resolutionIsSource: nextIsSource })
          }}
        >
          {buildResolutionOptions(s.resolution, s.resolutionIsSource).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">FPS</span>
        <select
          className="field-input flex-1 min-w-0 text-xs"
          value={String(s.fps)}
          onChange={e => set('fps', Number(e.target.value))}
        >
          {FPS_PRESETS.map(f => <option key={f} value={f}>{f} fps</option>)}
        </select>
      </div>
      <div className="divider" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Format</span>
        <select
          className="field-input flex-1 min-w-0 text-xs"
          value={s.format}
          onChange={e => set('format', e.target.value as StudioSettings['format'])}
        >
          <option value="webm">WebM (VP9 + Alpha)</option>
          <option value="mov">MOV (ProRes 4444)</option>
          <option value="mp4">MP4 (H.264)</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Mode</span>
        <select
          className="field-input flex-1 min-w-0 text-xs"
          value={s.renderMode}
          onChange={e => set('renderMode', e.target.value as StudioSettings['renderMode'])}
        >
          <option value="overlay">Transparent Overlay</option>
          <option value="baked">Baked into Video</option>
        </select>
      </div>
      {s.renderMode === 'baked' && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Bitrate</span>
          <select
            className="field-input flex-1 min-w-0 text-xs"
            value={s.bitrate}
            onChange={e => set('bitrate', e.target.value)}
          >
            <option value="8M">8 Mbps (Good)</option>
            <option value="15M">15 Mbps (High)</option>
            <option value="25M">25 Mbps (Very High)</option>
            <option value="40M">40 Mbps (Maximum)</option>
          </select>
        </div>
      )}

      <button
        className="btn-primary w-full justify-center mt-2"
        disabled={busy}
        onClick={() => startRender({}, effectiveOutputDir)}
      >
        Render with current settings
      </button>
      <p className="text-[10px] text-[var(--color-text-3)] text-center">
        {s.resolution[0]}×{s.resolution[1]} · {s.fps}fps · {s.format.toUpperCase()} · {s.renderMode}
      </p>
    </StudioCard>
  )
}
