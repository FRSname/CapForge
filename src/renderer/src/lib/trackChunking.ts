/**
 * "How many words per caption?" — on a **translated** track.
 *
 * On the source track `wordsPerGroup` re-chunks the transcript: the words are
 * the unit and `buildStudioGroups` slices each *segment* — a sentence — into
 * N-word groups. A translated track has the same two levels
 * (`lib/trackSentences.ts`), so it re-chunks the same way: the unit is the
 * **sentence**, and the one rule that may never bend is:
 *
 * > A sentence boundary is never crossed.
 *
 * The sentence of a translated group is the source segment its first recorded
 * source word lives in (`sentenceIndexOf`). Consecutive groups of one sentence
 * are coalesced into a unit — words concatenated, records concatenated — and
 * the unit is then sliced by N. That is what lets a translation the agent wrote
 * fragment by fragment ("And would you like" / "to give it a try?") become one
 * six-word caption; slicing per *fragment*, as this module first did, never
 * could.
 *
 * Chunking is therefore a function of N alone: 3 → 2 → 6 lands back on the
 * sentence, with the sentence's own id, because a chunk id is
 * `` `${unit.id}:${i}` `` and coalescing peels that suffix off again.
 *
 * The **record**-based `siblingRuns` / `coalesceSiblingRuns` stay, unchanged:
 * every chunk of a sentence carries the same (concatenated) `sourceWords`
 * record, so they are one sibling run, which is the unit `propagateSourceTiming`
 * and `reflowTrack` walk.
 *
 * Both exported passes are **reference-stable**: input that needs no change
 * comes back as the same array, so this can sit in an effect without churning
 * React identities.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'
import { joinWords } from './wordTiming'
import { sentenceRuns, sentenceUnitId, trackPrefixOf } from './trackSentences'

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
 * The **record**-based pass: it folds the chunks of one caption back together
 * by their `sourceWords` record, which is what `propagateSourceTiming` moves as
 * one unit and what `reflowTrack` matches against the source (one carry-over,
 * not N). Re-chunking does *not* start here — it starts from the sentence
 * (`sentenceRuns`), which is coarser. Groups that are not part of a run —
 * every source-track group, and every unchunked translated caption — come back
 * untouched, and a list with no runs at all comes back as the same array.
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

/**
 * Fold the groups of one sentence into the unit `wordsPerGroup` slices.
 *
 * Unlike `coalesceRun` this merges groups that record *different* source words
 * — the fragments of one sentence — so the unit's record is their concatenation
 * (de-duplicated, order kept: a manual merge can record the same word twice).
 * `endEdited` comes from the last member, which is the one that owns the
 * sentence's end; position, link and speaker from the first.
 */
function coalesceSentence(run: readonly Segment[], id: string): Segment {
  const first = run[0]
  const last = run[run.length - 1]
  const words = run.flatMap((g) => g.words)

  const seen = new Set<string>()
  const sourceWords: Array<{ wid: string; text: string }> = []
  for (const g of run) {
    for (const s of g.sourceWords ?? []) {
      if (seen.has(s.wid)) continue
      seen.add(s.wid)
      sourceWords.push(s)
    }
  }

  return {
    id,
    start: words.length > 0 ? words[0].start : first.start,
    end: words.length > 0 ? words[words.length - 1].end : last.end,
    text: joinWords(words),
    words,
    ...(first.speaker !== undefined ? { speaker: first.speaker } : {}),
    ...(first.positionOverride ? { positionOverride: first.positionOverride } : {}),
    ...(last.endEdited ? { endEdited: true } : {}),
    ...(first.timingLinked !== undefined ? { timingLinked: first.timingLinked } : {}),
    ...(first.previousText !== undefined ? { previousText: first.previousText } : {}),
    sourceWords,
  }
}

/** Slice one caption into chunks of at most `n` words (`buildStudioGroups`'s rule). */
function chunkCaption(unit: Segment, n: number, baseId: string): Segment[] {
  // No record → not an inherited caption; nothing here may touch it.
  if (!unit.sourceWords) return [unit]
  const words = unit.words
  if (words.length <= n) return [unit]

  const chunks: Segment[] = []
  for (let i = 0; i < words.length; i += n) {
    const slice = words.slice(i, i + n)
    const isLast = i + n >= words.length
    chunks.push({
      id: `${baseId}:${chunks.length}`,
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
 * Re-chunk a translated track's groups so every **sentence** becomes captions
 * of at most `wordsPerGroup` words.
 *
 * Sentences are coalesced first, so this is a function of N alone: the result
 * does not depend on how the list happened to be chunked before, and a
 * sentence the agent translated in three fragments becomes one caption when N
 * is wide enough. A sentence short enough to stay whole is returned as the
 * *same object*, and a list where nothing changed as the same array.
 *
 * `wordsPerGroup <= 0` is the identity — "no limit" — rather than
 * `buildStudioGroups`'s fallback of 3, because the caller (`syncSegmentsIntoTrack`)
 * must never invent a chunking the user did not ask for on a translated track.
 *
 * With an empty `widToSegment` (a source whose words carry no ids yet) no group
 * resolves to a sentence, every group is its own unit, and this is the identity.
 */
export function chunkTranslatedGroups(
  groups: readonly Segment[],
  wordsPerGroup: number,
  widToSegment: ReadonlyMap<string, number>
): Segment[] {
  if (!Number.isFinite(wordsPerGroup) || wordsPerGroup <= 0) return groups as Segment[]
  if (groups.length === 0) return groups as Segment[]
  const n = Math.max(1, Math.floor(wordsPerGroup))

  // One pass: fold each sentence's groups into the unit N slices, then slice
  // it. A sentence that is already one group is handed back **as it is** — with
  // its own id and by reference — so a slider move that changes nothing changes
  // nothing; only a sentence that is actually cut (or spans several groups) is
  // named after the sentence, which is what closes the 3 → 2 → 6 round trip.
  const prefix = trackPrefixOf(groups[0].id)
  const next = sentenceRuns(groups, widToSegment).flatMap((run) => {
    const members = groups.slice(run.start, run.start + run.length)
    const sentenceId = run.index === undefined ? null : sentenceUnitId(prefix, run.index)
    const unit =
      run.length === 1 ? members[0] : coalesceSentence(members, sentenceId ?? members[0].id)
    return chunkCaption(unit, n, sentenceId ?? unit.id)
  })

  // Reference-stable: nothing moved → hand back the caller's own array.
  const unchanged = next.length === groups.length && next.every((g, i) => g === groups[i])
  return unchanged ? (groups as Segment[]) : next
}
