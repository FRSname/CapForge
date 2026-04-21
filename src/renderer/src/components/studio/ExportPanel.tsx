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
import { useToast } from '../../hooks/useToast'

interface ExportPanelProps {
  audioPath:       string
  sourceVideoInfo: VideoInfo | null
  render:          RenderController
  outputDir:       string
  onOutputDir:     (dir: string) => void
}

export function ExportPanel({ audioPath, sourceVideoInfo, render, outputDir, onOutputDir }: ExportPanelProps) {
  const { busy, startRender } = render
  const { toast } = useToast()

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
          onClick={() => api.exportResult(buildExportParams(['srt_word'], effectiveOutputDir))
            .then(() => toast('Exported SRT (word-aligned)', 'success'))
            .catch(e => toast(e.message || 'Export failed', 'error'))}
          disabled={busy}
          title="Word-aligned SRT (per-word timing)"
        >
          .SRT (Word)
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult(buildExportParams(['srt_standard'], effectiveOutputDir))
            .then(() => toast('Exported SRT', 'success'))
            .catch(e => toast(e.message || 'Export failed', 'error'))}
          disabled={busy}
          title="Classic SRT (sentence timing)"
        >
          .SRT
        </button>
        <button
          className="btn-ghost flex-1 text-[11px] py-1 justify-center"
          onClick={() => api.exportResult(buildExportParams(['vtt'], effectiveOutputDir))
            .then(() => toast('Exported VTT', 'success'))
            .catch(e => toast(e.message || 'Export failed', 'error'))}
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
      <span>{icon}</span>
      <span className="text-xs font-semibold text-[var(--color-text)]">{title}</span>
      <span className="text-[10px] text-[var(--color-text-3)]">{sub}</span>
    </button>
  )
}

function VideoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {/* Clapperboard body */}
      <rect x="2" y="8" width="20" height="13" rx="2.5" fill="#F59E0B" />
      {/* Clapperboard clapper */}
      <path d="M2 8h20V6.5A2.5 2.5 0 0 0 19.5 4H4.5A2.5 2.5 0 0 0 2 6.5V8Z" fill="#D97706" />
      {/* Clapper stripes */}
      <path d="M5.5 4 8 8M10 4l2.5 4M14.5 4 17 8" stroke="#FDE68A" strokeWidth="1" strokeLinecap="round" />
      {/* Play triangle */}
      <path d="M10 12.5l5 2.5-5 2.5v-5Z" fill="#FEF3C7" />
    </svg>
  )
}

function OverlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {/* Film frame */}
      <rect x="2" y="3" width="20" height="18" rx="2.5" stroke="#F59E0B" strokeWidth="1.5" />
      {/* Dashed centre (transparent feel) */}
      <rect x="4" y="5" width="16" height="8" rx="1" stroke="#F59E0B" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5" />
      {/* Subtitle bar */}
      <rect x="4" y="15" width="16" height="4" rx="1.5" fill="#F59E0B" />
      {/* Text lines */}
      <line x1="6" y1="17" x2="14" y2="17" stroke="#FEF3C7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
