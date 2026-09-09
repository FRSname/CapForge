/**
 * Sentences — the *text* unit of a translated caption track.
 *
 * A translated track has two levels, exactly like the source track has two:
 *
 * | Level | Source track | Translated track |
 * |---|---|---|
 * | text unit | `Segment` (a WhisperX sentence) | **a sentence** — the source segment its captions were written from |
 * | caption | a group chunked out of that segment | a group chunked out of that sentence |
 *
 * Before this module a translated track had only the caption level: it was
 * created 1:1 with the *source groups*, so its Text view listed 41 caption-sized
 * fragments where the source listed 12 sentences, and an agent translating
 * fragment by fragment ("And would you like" / "to give it a try?") produced
 * captions that could never be re-chunked into anything else — `wordsPerGroup`
 * could only cut *inside* a fragment.
 *
 * The link back to the source is `Segment.sourceWords`, so the sentence a
 * translated group belongs to is recoverable from the group list alone, given a
 * `wid → source segment index` map:
 *
 * > **`sentenceIndexOf`** = the source segment index of the group's *first*
 * > recorded source wid.
 *
 * The first wid only, deliberately: a caption never spans two sentences (the
 * source's own grouping does not cross a segment boundary), and a group whose
 * first wid the user has since deleted must not be quietly re-homed into its
 * neighbour's sentence. Such a group is **unresolvable** — it forms a unit of
 * its own and is never coalesced with anything.
 *
 * Everything here is a pure function of `(groups, widToSegment)`. No React, no
 * `window`, no I/O.
 */

import type { Segment } from '../types/app'
import { joinWords } from './wordTiming'

/** The `:${i}` chunk suffix `trackChunking` adds, stripped off a unit id. */
const CHUNK_ID_SUFFIX = /:\d+$/

/** The `:s${index}` sentence suffix this module adds, stripped off a unit id. */
const SENTENCE_ID_SUFFIX = /:s\d+$/

/**
 * `wid → the index of the source segment holding it`.
 *
 * Built from the source track's **segments** (its sentences), not its groups —
 * groups are the caption level and are exactly what this is here to see past.
 * App derives it once per source-segments change and hands it down; it is the
 * only argument every function in this module needs beyond the groups.
 */
export function buildWidToSegment(segments: readonly Segment[]): Map<string, number> {
  const map = new Map<string, number>()
  segments.forEach((segment, index) => {
    for (const word of segment.words) {
      if (word.wid) map.set(word.wid, index)
    }
  })
  return map
}

/**
 * Which source sentence this translated group belongs to, or `undefined` when
 * it cannot be told (no source record, or its first recorded word is gone).
 */
export function sentenceIndexOf(
  group: Segment,
  widToSegment: ReadonlyMap<string, number>
): number | undefined {
  const first = group.sourceWords?.[0]
  return first ? widToSegment.get(first.wid) : undefined
}

/** A maximal run of consecutive groups belonging to one sentence. */
export interface SentenceRun {
  /** The source segment index, or `undefined` for an unresolvable group. */
  index: number | undefined
  start: number
  length: number
}

/**
 * Split a group list into sentence runs, in order — the shared spine of both
 * "what does the Text view show?" and "what does `wordsPerGroup` re-chunk?".
 *
 * A group with no resolvable sentence is a run of one, so the result always
 * covers the whole list exactly once and a caption whose source words vanished
 * can never be merged into a sentence it may not belong to.
 */
export function sentenceRuns(
  groups: readonly Segment[],
  widToSegment: ReadonlyMap<string, number>
): SentenceRun[] {
  const runs: SentenceRun[] = []
  let i = 0
  while (i < groups.length) {
    const index = sentenceIndexOf(groups[i], widToSegment)
    let j = i + 1
    if (index !== undefined) {
      while (j < groups.length && sentenceIndexOf(groups[j], widToSegment) === index) j += 1
    }
    runs.push({ index, start: i, length: j - i })
    i = j
  }
  return runs
}

/**
 * The id prefix a group id was built from: the track id, plus its reflow
 * generation when it has one.
 *
 * `t1:4` → `t1`, `t1:s2:1` → `t1`, `t1:r3:4` → `t1:r3`, `t1:r3:s2` → `t1:r3`.
 * Keeping the `:r${n}` is what stops a sentence unit id minted after a re-flow
 * from colliding with one an agent read before it.
 */
export function trackPrefixOf(groupId: string): string {
  return groupId.replace(CHUNK_ID_SUFFIX, '').replace(SENTENCE_ID_SUFFIX, '')
}

/** The id of sentence `index` under `prefix` — the unit id chunks hang off. */
export function sentenceUnitId(prefix: string, index: number): string {
  return prefix ? `${prefix}:s${index}` : `s${index}`
}

/**
 * One sentence as a text-view `Segment`: its groups' words concatenated in
 * order, its text re-joined from them, its span from the words it actually has.
 *
 * A word-less placeholder contributes no words but still produces a row — an
 * untranslated sentence must be visible and editable, which is the whole reason
 * `reconcileGroups` has a Rule 4 exception for `sourceWords`.
 */
function sentenceSegment(members: readonly Segment[], id: string): Segment {
  const first = members[0]
  const last = members[members.length - 1]
  // One member: hand its own array back, so a re-derivation that changed
  // nothing is reference-equal word for word.
  const words = members.length === 1 ? first.words : members.flatMap((m) => m.words)
  return {
    id,
    start: words.length > 0 ? words[0].start : first.start,
    end: words.length > 0 ? words[words.length - 1].end : last.end,
    text: joinWords(words),
    words,
    ...(first.speaker !== undefined ? { speaker: first.speaker } : {}),
  }
}

/**
 * A translated track's Text view: one segment per **sentence**, derived from
 * the track's groups.
 *
 * This is the invariant `withSentenceSegments` (`lib/tracks.ts`) enforces after
 * every group write — a translated track's `segments` are never authored, they
 * are always this function of its `groups`. Editing one of them flows back the
 * ordinary way: `retimeWords` inside the sentence's own span, then
 * `reconcileGroups` by `wid` into whatever chunking the groups currently have.
 *
 * `trackId` names the unit ids (`${trackId}:s${index}`); without it the prefix
 * is taken from the first group's id, which is the same thing for a track whose
 * groups this module minted.
 */
export function sentenceSegmentsFor(
  groups: readonly Segment[],
  widToSegment: ReadonlyMap<string, number>,
  trackId?: string
): Segment[] {
  if (groups.length === 0) return []
  const prefix = trackId ?? trackPrefixOf(groups[0].id)
  return sentenceRuns(groups, widToSegment).map((run) => {
    const members = groups.slice(run.start, run.start + run.length)
    // An unresolvable group keeps its own id: there is no sentence to name it
    // after, and its id is still unique within the list.
    const id = run.index === undefined ? members[0].id : sentenceUnitId(prefix, run.index)
    return sentenceSegment(members, id)
  })
}

/** Same word, as far as a text-view row is concerned. */
function sameWord(a: Segment['words'][number], b: Segment['words'][number]): boolean {
  return (
    a === b ||
    (a.word === b.word &&
      a.start === b.start &&
      a.end === b.end &&
      a.wid === b.wid &&
      a.overrides === b.overrides)
  )
}

/**
 * Content equality for two derived segment lists.
 *
 * `sentenceSegmentsFor` builds fresh arrays every call, so identity comparison
 * would report "changed" forever and the ResultsScreen effect that re-derives
 * segments from groups would ping-pong with the effect that reconciles groups
 * from segments. This is the guard that makes that pair converge.
 */
export function sameSentenceSegments(a: readonly Segment[], b: readonly Segment[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const other = b[i]
    return (
      seg.id === other.id &&
      seg.start === other.start &&
      seg.end === other.end &&
      seg.text === other.text &&
      seg.words.length === other.words.length &&
      seg.words.every((w, j) => sameWord(w, other.words[j]))
    )
  })
}
