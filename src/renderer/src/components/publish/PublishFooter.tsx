/**
 * The pinned actions under the Publish panel.
 *
 * "Copy upload package" asks the backend to render the bundled skill's text
 * layout from the record + the brief — the renderer never assembles that text,
 * it only copies it. "Copy plain transcript" is the paragraph form YouTube
 * Studio's caption auto-sync wants. The SRT/VTT row is the export route that
 * already exists, one pair per caption track, through the same
 * `buildExportParams` the Studio panel uses.
 */

import { api } from '../../lib/api'
import { buildExportParams } from '../../lib/exportParams'
import type { ExportTrack } from '../../lib/exportParams'
import { displayGroupsFor } from '../../lib/tracks'
import type { CaptionTrack } from '../../lib/tracks'
import { plainTranscript } from '../../lib/youtubeRules'
import type { Segment } from '../../types/app'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'

/** No clipboard (an old webview, a denied permission) — say so, never swallow. */
const NO_CLIPBOARD_MESSAGE = 'This window has no clipboard access.'

interface PublishFooterProps {
  /** The open record — null disables the two package actions. */
  videoId: string | null
  /** The source transcript, for the plain-transcript copy. */
  segments: readonly Segment[]
  /** Every caption track; the source exports with no `track` field at all. */
  tracks: readonly CaptionTrack[]
  /** Where subtitle files land; empty means "same as source". */
  outputDir: string
}

function exportTrackFor(track: CaptionTrack): ExportTrack | null {
  if (track.isSource) return null
  return { id: track.id, lang: track.lang, segments: displayGroupsFor(track) }
}

export function PublishFooter({ videoId, segments, tracks, outputDir }: PublishFooterProps) {
  const { toast } = useToast()

  async function copy(text: string, what: string) {
    if (!navigator.clipboard) {
      toast(NO_CLIPBOARD_MESSAGE, 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${what}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : `Could not copy ${what}`, 'error')
    }
  }

  function copyPackage() {
    if (!videoId) return
    api
      .getUploadPackage(videoId)
      .then(async (pkg) => {
        await copy(pkg.text, 'the upload package')
        if (pkg.violations.length > 0) {
          toast(`${pkg.violations.length} finding(s) still open on this record`, 'info')
        }
      })
      .catch((err) => toast(err.message || 'Could not build the upload package', 'error'))
  }

  function exportSubtitles(track: CaptionTrack, format: string, label: string) {
    api
      .exportResult(buildExportParams([format], outputDir, exportTrackFor(track)))
      .then(() => toast(`Exported ${label}`, 'success'))
      .catch((err) => toast(err.message || 'Export failed', 'error'))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button
          variant="primary"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={copyPackage}
          disabled={!videoId}
          title="The whole YouTube Studio paste, rendered from this record and your brief"
        >
          Copy upload package
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-[11px] py-1 justify-center"
          onClick={() => copy(plainTranscript(segments), 'the plain transcript')}
          title="Sentences separated by blank lines — what caption auto-sync wants"
        >
          Copy plain transcript
        </Button>
      </div>

      {tracks.map((track) => (
        <div key={track.id} className="flex items-center gap-1.5">
          <span className="text-2xs truncate flex-1" style={{ color: 'var(--color-text-3)' }}>
            {track.label}
          </span>
          <Button
            variant="ghost"
            className="text-[11px] py-1 px-2 shrink-0"
            onClick={() => exportSubtitles(track, 'srt_standard', `${track.label} SRT`)}
          >
            .SRT
          </Button>
          <Button
            variant="ghost"
            className="text-[11px] py-1 px-2 shrink-0"
            onClick={() => exportSubtitles(track, 'vtt', `${track.label} VTT`)}
          >
            .VTT
          </Button>
        </div>
      ))}
    </div>
  )
}
