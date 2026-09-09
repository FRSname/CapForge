/**
 * "How many words per caption?" — on a **translated** track.
 *
 * On the source track `wordsPerGroup` re-chunks the transcript: the words are
 * the unit and `buildStudioGroups` slices each segment into N-word groups. A
 * translated track has no transcript of its own to slice — its captions were
 * written against *source* groups, and that link (`Segment.sourceWords`) is
 * what every other track rule reads. So here the unit of re-chunking is the
 * **inherited caption**, and the one rule that may never bend is:
 *
 * > A boundary the source set is never crossed.
 *
 * An inherited caption is a **sibling run**: consecutive groups whose
 * `sourceWords` wid lists are *identical*. That is exactly what chunking one
 * caption produces (every chunk keeps the whole record — a translation is not
 * word-aligned to its source, so no chunk can claim a sub-range), and it is
 * also what a manual `splitGroup` on the translated tab produces. Re-chunking
 * is therefore always "coalesce each run back into its caption, then slice it
 * again", which makes the operation idempotent in N and reversible: going 3 → 2
 * → 6 lands back on the original caption, with its original id.
 *
 * Both exported passes are **reference-stable**: input that needs no change
 * comes back as the same array, so this can sit in an effect without churning
 * React identities.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'
import { joinWords } from './wordTiming'

/** Separator for the "same wid list" key — `\0` cannot occur in a wid. */
const WID_KEY_SEP = '\u0000'

/** The `:${i}` a chunk id carries, stripped when its siblings are folded back. */
const CHUNK_ID_SUFFIX = /:\d+$/

/**
 * The identity of the source caption this group was written from, or `null`
 * when it has no record (a source-track group, or one assembled by hand).
 * Two groups are siblings when their keys are equal and non-null.
 */
export function sourceWidKey(group: Segment): string | null {
  const recorded = group.sourceWords
  if (!recorded || recorded.length === 0) return null
  return recorded.map((s) => s.wid).join(WID_KEY_SEP)
}

/** A maximal run of sibling groups, as a slice of the caller's array. */
export interface SiblingRun {
  start: number
  length: number
}

/**
 * Split a group list into sibling runs, in order. A group with no record (or
 * one whose neighbours record something else) is a run of one, so the result
 * always covers the whole list exactly once.
 */
export function siblingRuns(groups: readonly Segment[]): SiblingRun[] {
  const runs: SiblingRun[] = []
  let i = 0
  while (i < groups.length) {
    const key = sourceWidKey(groups[i])
    let j = i + 1
    if (key !== null) {
      while (j < groups.length && sourceWidKey(groups[j]) === key) j += 1
    }
    runs.push({ start: i, length: j - i })
    i = j
  }
  return runs
}

/** Fold one run of chunks back into the caption they were cut from. */
function coalesceRun(run: readonly Segment[]): Segment {
  const first = run[0]
  const last = run[run.length - 1]
  const words = run.flatMap((g) => g.words)
  return {
    // The chunk suffix is this module's own, so peeling it restores the
    // caption's original id rather than nesting a new level on every re-chunk.
    id: first.id.replace(CHUNK_ID_SUFFIX, ''),
    start: words.length > 0 ? words[0].start : first.start,
    end: words.length > 0 ? words[words.length - 1].end : last.end,
    text: joinWords(words),
    words,
    ...(first.speaker !== undefined ? { speaker: first.speaker } : {}),
    ...(first.positionOverride ? { positionOverride: first.positionOverride } : {}),
    // Any sibling's hand-placed end is the caption's — in practice the last,
    // which is the only chunk that owns the caption's own end.
    ...(run.some((g) => g.endEdited) ? { endEdited: true } : {}),
    ...(first.timingLinked !== undefined ? { timingLinked: first.timingLinked } : {}),
    ...(first.previousText !== undefined ? { previousText: first.previousText } : {}),
    sourceWords: [...(first.sourceWords ?? [])],
  }
}

/**
 * Collapse every sibling run into the single caption it came from.
 *
 * The inverse of `chunkTranslatedGroups`: it is how a re-chunk starts, and how
 * `reflowTrack` matches a chunked caption against the source (one carry-over,
 * not N). Groups that are not part of a run — every source-track group, and
 * every unchunked translated caption — come back untouched, and a list with no
 * runs at all comes back as the same array.
 */
export function coalesceSiblingRuns(groups: readonly Segment[]): Segment[] {
  const runs = siblingRuns(groups)
  if (runs.length === groups.length) return groups as Segment[]
  return runs.map((run) =>
    run.length === 1
      ? groups[run.start]
      : coalesceRun(groups.slice(run.start, run.start + run.length))
  )
}

/** Slice one caption into chunks of at most `n` words (`buildStudioGroups`'s rule). */
function chunkCaption(unit: Segment, n: number): Segment[] {
  // No record → not an inherited caption; nothing here may touch it.
  if (!unit.sourceWords) return [unit]
  const words = unit.words
  if (words.length <= n) return [unit]

  const chunks: Segment[] = []
  for (let i = 0; i < words.length; i += n) {
    const slice = words.slice(i, i + n)
    const isLast = i + n >= words.length
    chunks.push({
      id: `${unit.id}:${chunks.length}`,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: joinWords(slice),
      words: slice,
      ...(unit.speaker !== undefined ? { speaker: unit.speaker } : {}),
      ...(unit.positionOverride ? { positionOverride: unit.positionOverride } : {}),
      // Only the final chunk ends where the caption ended, so only it can carry
      // the caption's hand-placed end claim.
      ...(isLast && unit.endEdited ? { endEdited: true } : {}),
      ...(unit.timingLinked !== undefined ? { timingLinked: unit.timingLinked } : {}),
      ...(unit.previousText !== undefined ? { previousText: unit.previousText } : {}),
      // A separate array per chunk, never one shared (the `splitGroup` rule).
      sourceWords: [...unit.sourceWords],
    })
  }
  return chunks
}

/**
 * Re-chunk a translated track's groups so every inherited caption becomes
 * groups of at most `wordsPerGroup` words.
 *
 * Captions are coalesced first, so this is a function of N alone: the result
 * does not depend on how the list happened to be chunked before. A caption
 * short enough to stay whole is returned as the *same object*, and a list where
 * nothing changed as the same array.
 *
 * `wordsPerGroup <= 0` is the identity — "no limit" — rather than
 * `buildStudioGroups`'s fallback of 3, because the caller (`syncSegmentsIntoTrack`)
 * must never invent a chunking the user did not ask for on a translated track.
 */
export function chunkTranslatedGroups(
  groups: readonly Segment[],
  wordsPerGroup: number
): Segment[] {
  if (!Number.isFinite(wordsPerGroup) || wordsPerGroup <= 0) return groups as Segment[]
  const n = Math.max(1, Math.floor(wordsPerGroup))

  const units = coalesceSiblingRuns(groups)
  const next = units.flatMap((unit) => chunkCaption(unit, n))

  // Reference-stable: nothing moved → hand back the caller's own array.
  const unchanged = next.length === groups.length && next.every((g, i) => g === groups[i])
  return unchanged ? (groups as Segment[]) : next
}
