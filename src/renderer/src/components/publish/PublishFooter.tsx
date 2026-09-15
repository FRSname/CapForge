/**
 * The pinned actions under the Publish panel.
 *
 * "Copy upload package" asks the backend to render the bundled skill's text
 * layout from the record + the brief — the renderer never assembles that text,
 * it only copies it. A platform choice beside it (YouTube first) turns it into
 * "Copy for LinkedIn / X / Instagram": clipboard posts rendered from the same
 * record, nothing is posted. With localized languages stored a language choice
 * joins it, applying to every platform (`?lang=`). "Copy plain transcript" is
 * the paragraph form YouTube Studio's caption auto-sync wants. The SRT/VTT row
 * is the export route that already exists, one pair per caption track, through
 * the same `buildExportParams` the Studio panel uses.
 */

import { api } from '../../lib/api'
import { buildExportParams } from '../../lib/exportParams'
import type { ExportTrack } from '../../lib/exportParams'
import { displayGroupsFor } from '../../lib/tracks'
import type { CaptionTrack } from '../../lib/tracks'
import { plainTranscript } from '../../lib/youtubeRules'
import type { PublishPlatform } from '../../lib/publishTypes'
import {
  DEFAULT_PUBLISH_PLATFORM,
  PUBLISH_PLATFORMS,
  copiedWhat,
  copyButtonText,
  copyButtonTitle,
  isPublishPlatform,
  packageCopiedToast,
  platformLabel,
} from '../../lib/publishPlatforms'
import type { Segment } from '../../types/app'
import { useState } from 'react'
import type { PackageLanguage } from '../../lib/publishLocalized'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'

/** No clipboard (an old webview, a denied permission) — say so, never swallow. */
const NO_CLIPBOARD_MESSAGE = 'This window has no clipboard access.'
/** Each choice's width beside the package button (`.field-input` would take 100%). */
const CHOICE_SELECT_WIDTH = '30%'
/** The `<select>` value standing for the source package. */
const SOURCE_VALUE = ''
/** No localized language stored: the source package only, no choice drawn. */
const NO_LANGUAGES: readonly PackageLanguage[] = []

interface PublishFooterProps {
  /** The open record — null disables the two package actions. */
  videoId: string | null
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
      className="field-input text-[11px]"
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

interface PackagePlatformSelectProps {
  value: PublishPlatform
  onChange: (value: PublishPlatform) => void
}

/** Where the copied text is going: the YouTube package or a platform post. */
function PackagePlatformSelect({ value, onChange }: PackagePlatformSelectProps) {
  return (
    <select
      className="field-input text-[11px]"
      style={{ width: CHOICE_SELECT_WIDTH }}
      aria-label="Copy for platform"
      value={value}
      onChange={(e) => {
        if (isPublishPlatform(e.target.value)) onChange(e.target.value)
      }}
    >
      {PUBLISH_PLATFORMS.map((p) => (
        <option key={p} value={p}>
          {platformLabel(p)}
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
  languages = NO_LANGUAGES,
  segments,
  tracks,
  outputDir,
}: PublishFooterProps) {
  const { toast } = useToast()
  const [picked, setPicked] = useState(SOURCE_VALUE)
  // Remembered for the session only (component state), never persisted.
  const [platform, setPlatform] = useState<PublishPlatform>(DEFAULT_PUBLISH_PLATFORM)
  // A language removed since it was picked falls back to the source package.
  const lang = languages.some((l) => l.lang === picked) ? picked : SOURCE_VALUE
  const choosing = languages.length > 1

  /** True once the text is on the clipboard; every failure is toasted here. */
  async function writeClipboard(text: string, what: string): Promise<boolean> {
    if (!navigator.clipboard) {
      toast(NO_CLIPBOARD_MESSAGE, 'error')
      return false
    }
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      toast(err instanceof Error ? err.message : `Could not copy ${what}`, 'error')
      return false
    }
  }

  async function copy(text: string, what: string) {
    if (await writeClipboard(text, what)) toast(`Copied ${what}`, 'success')
  }

  function copyPackage() {
    if (!videoId) return
    const chosen = platform
    const label = lang ? (languages.find((l) => l.lang === lang)?.label ?? null) : null
    const what = copiedWhat(chosen, label)
    api
      .getUploadPackage(videoId, chosen, lang || undefined)
      .then(async (pkg) => {
        if (!(await writeClipboard(pkg.text, what))) return
        const done = packageCopiedToast(chosen, pkg.violations, what)
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
            className="flex-1 min-w-0 text-[11px] py-1 justify-center"
            onClick={copyPackage}
            disabled={!videoId}
            title={copyButtonTitle(platform)}
          >
            {copyButtonText(platform)}
          </Button>
          <PackagePlatformSelect value={platform} onChange={setPlatform} />
          {choosing && (
            <PackageLanguageSelect languages={languages} value={lang} onChange={setPicked} />
          )}
        </div>
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
