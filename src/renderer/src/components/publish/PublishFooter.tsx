/**
 * The pinned actions under the Publish panel.
 *
 * The copy button copies the **active channel tab's** package, rendered by the
 * backend from that channel's post (`GET …/package?channel=`) — the renderer
 * never assembles that text, it only copies it. Its label follows the tab's
 * platform ("Copy YouTube package", "Copy Instagram caption", …). A YouTube tab
 * with stored translations adds a language choice (`&lang=`). A video on no
 * channel has nothing to copy, so the button waits with a hint.
 *
 * "Copy plain transcript" is the paragraph form YouTube Studio's caption
 * auto-sync wants. The SRT/VTT row is the export route that already exists, one
 * pair per caption track, through the same `buildExportParams` the Studio
 * panel uses.
 */

import { useState } from 'react'
import { api } from '../../lib/api'
import type { Platform } from '../../lib/channelTypes'
import { buildExportParams } from '../../lib/exportParams'
import type { ExportTrack } from '../../lib/exportParams'
import { getChannelPackage } from '../../lib/postsApi'
import {
  channelCopiedWhat,
  channelCopyText,
  channelCopyTitle,
  channelPackageCopiedToast,
} from '../../lib/publishPlatforms'
import type { PackageLanguage } from '../../lib/publishLocalized'
import { displayGroupsFor } from '../../lib/tracks'
import type { CaptionTrack } from '../../lib/tracks'
import { plainTranscript } from '../../lib/youtubeRules'
import type { Segment } from '../../types/app'
import { writeClipboard } from '../../lib/clipboard'
import { useCopyText } from '../../hooks/useCopyText'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'

/** The language choice's width beside the package button (`.field-input` would take 100%). */
const CHOICE_SELECT_WIDTH = '30%'
/** The `<select>` value standing for the source package. */
const SOURCE_VALUE = ''
/** No localized language stored: the source package only, no choice drawn. */
const NO_LANGUAGES: readonly PackageLanguage[] = []

const NO_CHANNEL_LABEL = 'Copy package'
export const NO_CHANNEL_HINT = 'Add this video to a channel above to copy its post.'

/** The active tab, as far as the copy button needs it. */
export interface FooterChannel {
  id: string
  platform: Platform
}

interface PublishFooterProps {
  /** The open record — null disables the package action. */
  videoId: string | null
  /** The active channel tab; null (no post, or a channel not in Settings) disables the copy. */
  channel: FooterChannel | null
  /** The package languages, source first (`packageLanguages`); one or none hides the choice. */
  languages?: readonly PackageLanguage[]
  /** The source transcript, for the plain-transcript copy. */
  segments: readonly Segment[]
  /** Every caption track; the source exports with no `track` field at all. */
  tracks: readonly CaptionTrack[]
  /** Where subtitle files land; empty means "same as source". */
  outputDir: string
}

interface PackageLanguageSelectProps {
  languages: readonly PackageLanguage[]
  value: string
  onChange: (value: string) => void
}

/** Which language's package the button copies. */
function PackageLanguageSelect({ languages, value, onChange }: PackageLanguageSelectProps) {
  return (
    <select
      className="field-input text-xs-plus"
      style={{ width: CHOICE_SELECT_WIDTH }}
      aria-label="Upload package language"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {languages.map((l) => (
        <option key={l.lang ?? SOURCE_VALUE} value={l.lang ?? SOURCE_VALUE}>
          {l.label}
        </option>
      ))}
    </select>
  )
}

function exportTrackFor(track: CaptionTrack): ExportTrack | null {
  if (track.isSource) return null
  return { id: track.id, lang: track.lang, segments: displayGroupsFor(track) }
}

export function PublishFooter({
  videoId,
  channel,
  languages = NO_LANGUAGES,
  segments,
  tracks,
  outputDir,
}: PublishFooterProps) {
  const { toast } = useToast()
  const copy = useCopyText()
  const [picked, setPicked] = useState(SOURCE_VALUE)
  const youtube = channel?.platform === 'youtube'
  // A language removed since it was picked falls back to the source package.
  const lang = youtube && languages.some((l) => l.lang === picked) ? picked : SOURCE_VALUE
  const choosing = youtube && languages.length > 1

  function copyPackage() {
    if (!videoId || !channel) return
    const { id, platform } = channel
    const label = lang ? (languages.find((l) => l.lang === lang)?.label ?? null) : null
    const what = channelCopiedWhat(platform, label)
    getChannelPackage(videoId, id, lang || undefined)
      .then(async (pkg) => {
        // Not `copy`: the toast here also reports the package's findings.
        const outcome = await writeClipboard(pkg.text, what)
        if (!outcome.ok) {
          toast(outcome.message, 'error')
          return
        }
        const done = channelPackageCopiedToast(id, pkg.violations, what)
        toast(done.message, done.type)
      })
      .catch((err) => toast(err.message || `Could not build ${what}`, 'error'))
  }

  function exportSubtitles(track: CaptionTrack, format: string, label: string) {
    api
      .exportResult(buildExportParams([format], outputDir, exportTrackFor(track)))
      .then(() => toast(`Exported ${label}`, 'success'))
      .catch((err) => toast(err.message || 'Export failed', 'error'))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          <Button
            variant="primary"
            className="flex-1 min-w-0 text-xs-plus py-1 justify-center"
            onClick={copyPackage}
            disabled={!videoId || !channel}
            title={channel ? channelCopyTitle(channel.platform) : NO_CHANNEL_HINT}
          >
            {channel ? channelCopyText(channel.platform) : NO_CHANNEL_LABEL}
          </Button>
          {choosing && (
            <PackageLanguageSelect languages={languages} value={lang} onChange={setPicked} />
          )}
        </div>
        {videoId && !channel && (
          <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
            {NO_CHANNEL_HINT}
          </p>
        )}
        <Button
          variant="ghost"
          className="flex-1 text-xs-plus py-1 justify-center"
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
            className="text-xs-plus py-1 px-2 shrink-0"
            onClick={() => exportSubtitles(track, 'srt_standard', `${track.label} SRT`)}
          >
            .SRT
          </Button>
          <Button
            variant="ghost"
            className="text-xs-plus py-1 px-2 shrink-0"
            onClick={() => exportSubtitles(track, 'vtt', `${track.label} VTT`)}
          >
            .VTT
          </Button>
        </div>
      ))}
    </div>
  )
}
