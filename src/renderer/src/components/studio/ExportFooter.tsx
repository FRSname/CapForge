/**
 * Pinned export actions — the two primary quick-render buttons, shown in a
 * non-scrolling footer at the bottom of the StudioPanel aside so "Render" is
 * always reachable regardless of scroll position.
 *
 * The render lifecycle is owned by useRender() in StudioPanel — this footer,
 * ExportPanel, and CustomRenderPanel all share one controller so progress is
 * consistent regardless of which button triggered the render. Render status
 * (done/error) is displayed here, next to the actions that triggered it.
 */

import { dirname } from '../../lib/render'
import type { VideoInfo } from '../../lib/api'
import type { RenderController } from '../../hooks/useRender'

interface ExportFooterProps {
  audioPath: string
  sourceVideoInfo: VideoInfo | null
  render: RenderController
  outputDir: string
}

export function ExportFooter({ audioPath, sourceVideoInfo, render, outputDir }: ExportFooterProps) {
  const { busy, startRender } = render

  // Empty outputDir means "Same as source" — derive the source file's folder.
  const effectiveOutputDir = outputDir || dirname(audioPath)

  // Quick-render uses source resolution + fps when available, falls back to
  // 1080p/30fps for audio-only files.
  const srcRes: [number, number] =
    sourceVideoInfo?.width && sourceVideoInfo?.height
      ? [sourceVideoInfo.width, sourceVideoInfo.height]
      : [1920, 1080]
  const srcFps = sourceVideoInfo?.fps ? Math.round(sourceVideoInfo.fps) : 30

  const hasVideo = !!(sourceVideoInfo?.width && sourceVideoInfo?.height)

  function quickBaked() {
    startRender(
      { renderMode: 'baked', format: 'mp4', resolution: srcRes, fps: srcFps, bitrate: '40M' },
      effectiveOutputDir
    )
  }
  function quickOverlay() {
    startRender(
      { renderMode: 'overlay', format: 'mov', resolution: srcRes, fps: srcFps, bitrate: '40M' },
      effectiveOutputDir
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Quick render buttons — source resolution/fps + max bitrate. */}
      <div className="grid grid-cols-2 gap-2">
        <QuickRenderBtn
          icon={<VideoIcon />}
          title="Render Video"
          sub={
            hasVideo
              ? `MP4 · ${srcRes[0]}×${srcRes[1]} · ${srcFps}fps`
              : 'MP4 · audio-only fallback'
          }
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

      {render.status === 'done' && (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs shrink-0" style={{ color: 'var(--color-success)' }}>
            ✓ Render complete
          </span>
          {render.lastOutputFile && (
            <button
              type="button"
              onClick={() => window.subforge.showInFolder(render.lastOutputFile!)}
              className="text-xs underline truncate text-left min-w-0 hover:text-[var(--color-text-2)]"
              style={{ color: 'var(--color-text-3)' }}
              title={`Reveal in file browser:\n${render.lastOutputFile}`}
            >
              Reveal {render.lastOutputFile.split(/[\\/]/).pop()}
            </button>
          )}
        </div>
      )}
      {render.status === 'error' && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {render.message || 'Render failed — check logs'}
        </p>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function QuickRenderBtn({
  icon,
  title,
  sub,
  onClick,
  disabled,
}: {
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
      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border transition-all bg-[var(--color-surface-2)] border-[var(--color-border-2)] disabled:opacity-50"
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-3)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-2)'
      }}
    >
      <span>{icon}</span>
      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
        {title}
      </span>
      <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {sub}
      </span>
    </button>
  )
}

function VideoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {/* Clapperboard body */}
      <rect x="2" y="8" width="20" height="13" rx="2.5" fill="var(--color-brand)" />
      {/* Clapperboard clapper */}
      <path
        d="M2 8h20V6.5A2.5 2.5 0 0 0 19.5 4H4.5A2.5 2.5 0 0 0 2 6.5V8Z"
        fill="color-mix(in srgb, var(--color-brand) 80%, black)"
      />
      {/* Clapper stripes */}
      <path
        d="M5.5 4 8 8M10 4l2.5 4M14.5 4 17 8"
        stroke="color-mix(in srgb, var(--color-brand) 35%, white)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Play triangle */}
      <path d="M10 12.5l5 2.5-5 2.5v-5Z" fill="color-mix(in srgb, var(--color-brand) 18%, white)" />
    </svg>
  )
}

function OverlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      {/* Film frame */}
      <rect
        x="2"
        y="3"
        width="20"
        height="18"
        rx="2.5"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
      />
      {/* Dashed centre (transparent feel) */}
      <rect
        x="4"
        y="5"
        width="16"
        height="8"
        rx="1"
        stroke="var(--color-brand)"
        strokeWidth="0.8"
        strokeDasharray="2 2"
        opacity="0.5"
      />
      {/* Subtitle bar */}
      <rect x="4" y="15" width="16" height="4" rx="1.5" fill="var(--color-brand)" />
      {/* Text lines */}
      <line
        x1="6"
        y1="17"
        x2="14"
        y2="17"
        stroke="color-mix(in srgb, var(--color-brand) 18%, white)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
