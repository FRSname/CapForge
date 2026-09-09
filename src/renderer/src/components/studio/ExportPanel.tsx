/**
 * Export panel — output picker + SRT/VTT/ASS subtitle-file exports.
 *
 * The two primary quick-render buttons live in ExportFooter (pinned at the
 * bottom of the StudioPanel aside). Custom Render (the controls + "Render
 * with current settings" button) lives in CustomRenderPanel below this card.
 *
 * The render lifecycle is owned by useRender() in StudioPanel — all panels
 * share one controller so progress is consistent regardless of which button
 * triggered the render.
 */

import type { Segment } from '../../types/app'
import { StudioCard } from './StudioCard'
import { Button } from '../ui/Button'
import { api } from '../../lib/api'
import { dirname } from '../../lib/render'
import type { RenderController } from '../../hooks/useRender'
import { useToast } from '../../hooks/useToast'

/**
 * The active caption track when it is a *translated* one — sent alongside an
 * export so the exporter writes that track's lines instead of the source
 * transcript, and names the file after its language. Null on the source track,
 * where the request body is exactly what it always was.
 */
export interface ExportTrack {
  id: string
  lang: string
  /** The track's display groups (gaps closed) — one cue each. */
  segments: Segment[]
}

interface ExportPanelProps {
  audioPath: string
  render: RenderController
  outputDir: string
  onOutputDir: (dir: string) => void
  track?: ExportTrack | null
}

export function ExportPanel({
  audioPath,
  render,
  outputDir,
  onOutputDir,
  track = null,
}: ExportPanelProps) {
  const { busy } = render
  const { toast } = useToast()

  // Empty outputDir means "Same as source" — derive the source file's folder.
  const effectiveOutputDir = outputDir || dirname(audioPath)

  return (
    <StudioCard title="Export" defaultOpen>
      {/* Output folder picker */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-2xs shrink-0" style={{ color: 'var(--color-text-3)' }}>
          Output:
        </span>
        <span
          className="flex-1 min-w-0 text-[11px] truncate px-1.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-2)' }}
          title={outputDir || `Same as source (${effectiveOutputDir})`}
        >
          {outputDir ? outputDir.split(/[\\/]/).pop() || outputDir : 'Same as source'}
        </span>
        <Button
          variant="ghost"
          className="text-[11px] py-1 px-2 shrink-0"
          onClick={async () => {
            const dir = await window.subforge.pickOutputDir()
            if (dir) onOutputDir(dir)
          }}
          disabled={busy}
        >
          Browse
        </Button>
        {outputDir && (
          <Button
            variant="ghost"
            className="text-[11px] py-1 px-2 shrink-0"
            onClick={() => onOutputDir('')}
            disabled={busy}
            title="Reset to Same as source"
          >
            ✕
          </Button>
        )}
      </div>

      {/* SRT / VTT export row */}
      <div className="flex gap-1.5 mt-1">
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() =>
            api
              .exportResult(buildExportParams(['srt_word'], effectiveOutputDir, track))
              .then(() => toast('Exported SRT (word-aligned)', 'success'))
              .catch((e) => toast(e.message || 'Export failed', 'error'))
          }
          disabled={busy}
          title="Word-aligned SRT (per-word timing)"
        >
          .SRT (Word)
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() =>
            api
              .exportResult(buildExportParams(['srt_standard'], effectiveOutputDir, track))
              .then(() => toast('Exported SRT', 'success'))
              .catch((e) => toast(e.message || 'Export failed', 'error'))
          }
          disabled={busy}
          title="Classic SRT (sentence timing)"
        >
          .SRT
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() =>
            api
              .exportResult(buildExportParams(['vtt'], effectiveOutputDir, track))
              .then(() => toast('Exported VTT', 'success'))
              .catch((e) => toast(e.message || 'Export failed', 'error'))
          }
          disabled={busy}
        >
          .VTT
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() =>
            api
              .exportResult(buildExportParams(['ass'], effectiveOutputDir, track))
              .then(() => toast('Exported ASS (karaoke)', 'success'))
              .catch((e) => toast(e.message || 'Export failed', 'error'))
          }
          disabled={busy}
          title="ASS (karaoke) — per-word highlight timing for Premiere/Resolve/ffmpeg"
        >
          .ASS
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() =>
            api
              .exportResult(buildExportParams(['hyperframes'], effectiveOutputDir, track))
              .then(() => toast('Exported HyperFrames transcript', 'success'))
              .catch((e) => toast(e.message || 'Export failed', 'error'))
          }
          disabled={busy}
          title="HyperFrames transcript ([{text,start,end}] word array) for npx hyperframes"
        >
          HyperFrames
        </Button>
      </div>
    </StudioCard>
  )
}

/**
 * Backend rejects empty output_dir; only include the field when set.
 *
 * `track` rides along only for a translated caption track. Today's backend has
 * no field for it and Pydantic's default `extra='ignore'` drops it, so a source
 * export sends byte-identical params to what it always did.
 */
function buildExportParams(formats: string[], outputDir: string, track: ExportTrack | null) {
  const base = outputDir ? { formats, output_dir: outputDir } : { formats }
  return track ? { ...base, track } : base
}
