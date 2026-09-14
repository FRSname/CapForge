/**
 * The renderer's half of the YouTube rules: **formatting, snapping and
 * suggesting only**.
 *
 * Validation lives in Python once (`backend/library/validate.py`,
 * `POST /api/library/validate`) — vision §3.3. Nothing here decides whether a
 * field is acceptable; the limits below are re-declared purely so a meter can
 * be drawn next to a field without a round trip, and the backend remains the
 * only thing that refuses a write.
 *
 * `formatTimestamp` is the one **twin** in this file: the package rendered by
 * `backend/library/package.py` and the chapter rows drawn here must agree
 * character for character, so the two are pinned against the shared fixture
 * `backend/tests/fixtures/timestamp_cases.json` (the RSVP precedent).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment, Word } from '../types/app'
import type { Chapter, Moment } from './publishTypes'

/** YouTube's title limit — displayed by the meter, enforced in Python. */
export const TITLE_MAX_CHARS = 100
/** YouTube's description limit, in **UTF-8 bytes** (not characters). */
export const DESCRIPTION_MAX_BYTES = 5000
/** YouTube's combined tag limit over `", ".join(tags)`. */
export const TAGS_MAX_CHARS = 500
/** "Above the fold": what a viewer sees before "…more". */
export const HOOK_CHARS = 150
/** Chapters closer together than this are not chapters. */
export const CHAPTER_MIN_GAP_S = 10

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
/** Zero-padding width for minutes and seconds. */
const PAD = 2

/** How many words of a moment's text become a suggested chapter label. */
const SUGGESTION_LABEL_WORDS = 6
/** The opener the first-chapter rule requires when nothing covers 00:00. */
export const OPENING_CHAPTER_TITLE = 'Intro'

function pad(n: number): string {
  return String(n).padStart(PAD, '0')
}

/**
 * `MM:SS`, or `H:MM:SS` past the hour — the format YouTube parses out of a
 * description and the one the bundled publish skill writes.
 *
 * Seconds are floored (a chapter starting at 9.9 s is still in the 9th second),
 * negatives and non-finite values clamp to `00:00`.
 */
export function formatTimestamp(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(total / SECONDS_PER_HOUR)
  const m = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const s = total % SECONDS_PER_MINUTE
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** The five URL shapes a user can paste out of YouTube. */
const YOUTUBE_ID_PATTERNS: readonly RegExp[] = [
  /youtu\.be\/([A-Za-z0-9_-]+)/,
  /[?&]v=([A-Za-z0-9_-]+)/,
  /\/shorts\/([A-Za-z0-9_-]+)/,
  /\/live\/([A-Za-z0-9_-]+)/,
  /\/embed\/([A-Za-z0-9_-]+)/,
]

/**
 * The video id inside a YouTube URL, or null when there is none. Shared with
 * the MCP `mark_published` tool's reading of the same paste, so the panel and
 * the agent record the same id for the same link.
 */
export function youtubeIdFromUrl(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  for (const pattern of YOUTUBE_ID_PATTERNS) {
    const match = pattern.exec(raw)
    if (match?.[1]) return match[1]
  }
  return null
}

/**
 * The greatest word `start` at or before `t` — a chapter inserted at the
 * playhead lands on a word boundary instead of mid-syllable.
 *
 * `t` is returned unchanged when no word starts at or before it (the playhead
 * is in the lead-in) or when there are no words: snapping *forward* would push
 * the opening chapter off `00:00`, which is a hard rule.
 */
export function snapToWordStart(t: number, words: readonly Word[]): number {
  let best: number | null = null
  for (const word of words) {
    if (word.start <= t && (best === null || word.start > best)) best = word.start
  }
  return best === null ? Math.max(0, t) : best
}

/** The first few words of a moment, as a chapter label. */
function labelFor(moment: Moment): string {
  const words = moment.text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, SUGGESTION_LABEL_WORDS).join(' ')
}

/**
 * Chapter candidates from the library's moments (`pause` + `speaker_change`).
 *
 * Nothing here validates — the backend does. This only picks a spread: moments
 * are taken in time order, each dropped when it falls within `minGapS` of an
 * already-taken start or of one of the `existing` chapters, and the `00:00`
 * opener the first-chapter rule needs is prepended when nothing covers it.
 */
export function chapterSuggestions(
  moments: readonly Moment[],
  existing: readonly Chapter[],
  minGapS: number = CHAPTER_MIN_GAP_S
): Chapter[] {
  const taken: number[] = existing.map((c) => c.start_s).sort((a, b) => a - b)
  // YouTube reads the first chapter at 00:00, so a moment near the start can
  // never stand in for the opener: the 00:00 row is claimed first and every
  // candidate is spread out from it.
  const opener: Chapter[] = taken.includes(0) ? [] : [{ start_s: 0, title: OPENING_CHAPTER_TITLE }]
  if (opener.length > 0) taken.push(0)
  const tooClose = (start: number) => taken.some((t) => Math.abs(t - start) < minGapS)

  const picked: Chapter[] = []
  for (const moment of [...moments].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, moment.start)
    const title = labelFor(moment)
    if (!title || tooClose(start)) continue
    taken.push(start)
    picked.push({ start_s: start, title })
  }

  return [...opener, ...picked].sort((a, b) => a.start_s - b.start_s)
}

/**
 * The transcript as plain prose — one sentence per paragraph, blank line
 * between. This is what YouTube Studio's caption auto-sync wants pasted in;
 * the timed exports (SRT/VTT) are a different button.
 */
export function plainTranscript(segments: readonly Segment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n\n')
}
