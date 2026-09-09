/**
 * Shared fixtures for the caption-track suites (`tracks.test.ts`,
 * `trackStaleness.test.ts`, `trackTiming.test.ts`, `project.test.ts`).
 *
 * **Not imported by app code.** One builder, so the three suites cannot drift
 * into testing subtly different source transcripts — the staleness table and the
 * timing table have to describe the *same* six words to be comparable.
 *
 * Fixture-builder style copied from `groups.test.ts:15-37`: plain literals, no
 * factories-of-factories, every timing readable at a glance.
 */

import type { Segment, Word } from '../types/app'
import { buildStudioGroups } from './groups'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { SOURCE_TRACK_ID, type CaptionTrack } from './tracks'

/** The six source words every track fixture is built from. */
export const SOURCE_TOKENS = ['the', 'quick', 'brown', 'fox', 'jumps', 'over'] as const

/** One word, 0.5 s long, with an explicit `wid` (identity is the point here). */
export const word = (text: string, start: number, end: number, wid?: string): Word => ({
  word: text,
  start,
  end,
  ...(wid ? { wid } : {}),
})

/** `SOURCE_TOKENS` as words at 0.5 s each, wids `s1w0`…`s1w5`. */
export function sourceWords(tokens: readonly string[] = SOURCE_TOKENS): Word[] {
  return tokens.map((t, i) => word(t, i * 0.5, i * 0.5 + 0.5, `s1w${i}`))
}

/** One segment holding `words`, id `s1`. */
export function sourceSegment(words: Word[] = sourceWords(), id = 's1'): Segment {
  return {
    id,
    start: words[0]?.start ?? 0,
    end: words[words.length - 1]?.end ?? 0,
    text: words.map((w) => w.word).join(' '),
    words,
  }
}

/**
 * A source track: one segment, its groups chunked at `wordsPerGroup` (3 → two
 * groups of three). `groups` are RAW, exactly as `ResultsScreen` holds them.
 */
export function makeSourceTrack(
  words: Word[] = sourceWords(),
  wordsPerGroup = 3,
  patch: Partial<CaptionTrack> = {}
): CaptionTrack {
  const segments = [sourceSegment(words)]
  return {
    id: SOURCE_TRACK_ID,
    label: 'Original',
    lang: 'en',
    isSource: true,
    segments,
    groups: buildStudioGroups(segments, wordsPerGroup),
    groupsEdited: false,
    segmentsEdited: false,
    settings: { ...STUDIO_DEFAULTS, wordsPerGroup },
    appliedPreset: null,
    ...patch,
  }
}
