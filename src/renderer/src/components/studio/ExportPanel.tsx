/**
 * Export / Render panel — quick-render buttons, SRT/VTT exports, output picker.
 *
 * Custom Render (the controls + "Render with current settings" button) lives
 * in CustomRenderPanel below this card.
 *
 * The render lifecycle is owned by useRender() in StudioPanel — both panels
 * share one controller so progress is consistent regardless of which button
 * triggered the render.
 */

import { StudioCard } from './StudioCard'
import { api } from '../../lib/api'
import { dirname } from '../../lib/render'
import type { VideoInfo } from '../../lib/api'
import type { RenderController } from '../../hooks/useRender'

interface ExportPanelProps {
  audioPath:       string
  sourceVideoInfo: VideoInfo | null
  render:          RenderController
  outputDir:       string
  onOutputDir:     (dir: string) => void
}

export function ExportPanel({ audioPath, sourceVideoInfo, render, outputDir, onOutputDir }: ExportPanelProps) {
  const { busy, startRender } = render

  // Empty outputDir means "Same as source" — derive the source file's folder.
  const effectiveOutputDir = outputDir || dirname(audioPath)

  // Quick-render uses source resolution + fps when available, falls back to
  // 1080p/30fps for audio-only files.
  const srcRes: [number, number] = (sourceVideoInfo?.width && sourceVideoInfo?.height)
    ? [sourceVideoInfo.width, sourceVideoInfo.height]
    : [1920, 1080]
  const srcFps = sourceVideoInfo?.fps ? Math.round(sourceVideoInfo.fps) : 30

  const hasVideo = !!(sourceVideoInfo?.width && sourceVideoInfo?.height)

  function quickBaked() {
    startRender(
      { renderMode: 'baked', format: 'mp4', resolution: srcRes, fps: srcFps, bitrate: '40M' },
      effectiveOutputDir,
    )
  }
  function quickOverlay() {
    startRender(
      { renderMode: 'overlay', format: 'mov', resolution: srcRes, fps: srcFps, bitrate: '40M' },
      effectiveOutputDir,
    )
  }

  return (
    <StudioCard title="Export / Render" defaultOpen>

      {/* Output folder picker */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-[var(--color-text-3)] shrink-0">Output:</span>
        <span
          className="flex-1 min-w-0 text-[11px] text-[var(--color-text-2)] truncate px-1.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
          title={outputDir || `Same as source (${effectiveOutputDir})`}
        >
          {outputDir
            ? outputDir.split(/[\\/]/).pop() || outputDir
            : 'Same as source'}
        </span>
        <button
          className="btn-ghost text-[11px] py-1 px-2 shrink-0"
          onClick={async () => {
            const dir = await window.subforge.pickOutputDir()
            if (dir) onOutputDir(dir)
          }}
          disabled={busy}
        >
          Browse
        </button>
        {outputDir && (
          <button
            className="btn-ghost text-[11px] py-1 px-2 shrink-0"
            onClick={() => onOutputDir('')}
            disabled={busy}
            title="Reset to Same as source"
          >
            ✕
          </button>
        )}
      </div>

      {/* Quick render buttons — source resolution/fps + max bitrate. */}
      <div className="grid grid-cols-2 gap-2">
        <QuickRenderBtn
          icon={<VideoIcon />}
          title="Render Video"
          sub={hasVideo ? `MP4 · ${srcRes[0]}×${srcRes[1]} · ${srcFps}fps` : 'MP4 · audio-only fallback'}
          disabled={busy || !hasVideo}
          onClick={quickBaked}
        />
        <QuickRenderBtn
          icon={<OverlayIcon />}
          title="Subtitles Only"
          sub={`MOV · ${srcRes[0]}×${srcRes[1]} · ${srcFps}fps`}
          disabled={busy}
          onClick={quickOverlay}
        />
      </div>

      {/* SRT / VTT export row */}
      <div className="flex gap-1.5 mt-1">
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult(buildExportParams(['srt_word'], effectiveOutputDir)).catch(() => {})}
          disabled={busy}
          title="Word-aligned SRT (per-word timing)"
        >
          .SRT (Word)
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult(buildExportParams(['srt_standard'], effectiveOutputDir)).catch(() => {})}
          disabled={busy}
          title="Classic SRT (sentence timing)"
        >
          .SRT
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult(buildExportParams(['vtt'], effectiveOutputDir)).catch(() => {})}
          disabled={busy}
        >
          .VTT
        </button>
      </div>
    </StudioCard>
  )
}

/** Backend rejects empty output_dir; only include the field when set. */
function buildExportParams(formats: string[], outputDir: string) {
  return outputDir ? { formats, output_dir: outputDir } : { formats }
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
