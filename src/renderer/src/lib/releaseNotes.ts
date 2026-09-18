/**
 * What the "What's new" card says, per release.
 *
 * Deliberately a typed list in the renderer rather than CHANGELOG.md parsed at
 * runtime: the card shows a handful of highlights, not the full prose, and the
 * changelog's markdown is not a stable data format. `releaseNotes.test.ts`
 * pins this list to `package.json`'s version and to the CHANGELOG's headings,
 * so bumping the version without writing notes fails the frontend CI job.
 */

import { compareVersions } from './version'

export interface ReleaseHighlight {
  title: string
  body: string
}

export interface ReleaseNotes {
  version: string
  headline: string
  highlights: ReleaseHighlight[]
}

/** Where "Full changelog" goes. */
export const RELEASES_URL = 'https://github.com/FRSname/CapForge/releases'

/** Newest first. One entry per shipped version, six highlights at most. */
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '3.0.0',
    headline:
      'The biggest CapForge release yet, and worth the update for the fixes alone: more than two dozen, plus a library for your videos, a Publish workspace, captions in other languages and Claude workflows. Take the tour from Settings → General → About.',
    highlights: [
      {
        title: 'A library for your videos',
        body: 'CapForge opens on your videos now: folders, search, grid or list, and a status on every card from imported to published. Every session saves itself into its record. Your last project was imported for you.',
      },
      {
        title: 'The Publish workspace',
        body: "Beside Captions: title options, a description with chapters, tags, speakers and a thumbnail, checked against YouTube's limits as you type. Copy the whole upload package, or one field at a time.",
      },
      {
        title: 'A post per channel',
        body: 'Set up your YouTube, TikTok, Instagram, LinkedIn and X channels in Settings. Each gets its own tab in Publish, metered to that platform\'s limits, with "Start from…" to adapt another channel\'s text.',
      },
      {
        title: 'Captions in other languages',
        body: 'A tab per language above the editor. Translations are written a sentence at a time onto the original timing, and the tab tells you when the source moved underneath them.',
      },
      {
        title: 'Claude does the writing',
        body: 'Seven bundled skills and 61 tools let Claude read the library, draft descriptions, translate captions and check a video before upload. Edit any skill in Settings → Claude & Skills before installing it.',
      },
      {
        title: 'More than two dozen fixes, and a new look',
        body: 'The .ass export, word timings after an edit, Windows file swaps, the empty library after launch, forgotten panel widths. Plus one accent colour, AA contrast, Light / Dark / System and press-and-hold scrubbing.',
      },
    ],
  },
  {
    version: '2.6.0',
    headline: 'Mostly new ways to read a caption, plus colours and cues.',
    highlights: [
      {
        title: 'RSVP speed-reading captions',
        body: 'A reading mode that lays the caption out as one unwrapped line, sliding so the active word stays pinned to a fixed column. The new Reading card sets everything about it.',
      },
      {
        title: 'Captions held across short gaps',
        body: 'A brief silence between two captions no longer blanks the screen. The Layout card sets the gap to close and how long the last caption is held. An end you placed by hand is left alone.',
      },
      {
        title: 'Choose your transcription model',
        body: 'The first-run wizard lists every model with its download size, from Tiny at 75 MB to Large Turbo, and installs only the one you pick. Settings changes it afterwards.',
      },
      {
        title: 'Gradient caption colours',
        body: 'Text and the background box can each take a linear gradient, with sliders for the angle and each stop. It renders the same in the preview, the export and HyperFrames.',
      },
      {
        title: 'Favorite fonts',
        body: 'Star a font to pin it to the top of the picker, in the main font list and in the per-word override popup.',
      },
      {
        title: 'Readable .srt and .vtt cues',
        body: 'Exported subtitles are split at sentences, at most two lines of 42 characters and seven seconds, instead of one cue per transcription chunk. Cue times are copied, never recomputed.',
      },
    ],
  },
]

/**
 * The releases to show: every entry newer than `lastSeen` and no newer than
 * `current`, newest first. A `lastSeen` of null shows `current` alone, because
 * an update from an unknown version should not replay the whole history. A
 * `current` this build has no notes for shows nothing.
 */
export function notesSince(lastSeen: string | null, current: string): ReleaseNotes[] {
  const known = RELEASE_NOTES.some((notes) => compareVersions(notes.version, current) === 0)
  if (!known) return []
  if (lastSeen === null) {
    return RELEASE_NOTES.filter((notes) => compareVersions(notes.version, current) === 0)
  }
  return RELEASE_NOTES.filter(
    (notes) =>
      compareVersions(notes.version, lastSeen) > 0 && compareVersions(notes.version, current) <= 0
  )
}
