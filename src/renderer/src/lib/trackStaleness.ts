/**
 * "Has the source changed under this translation?" — the staleness model (§D of
 * `docs/plans/multi-language-caption-tracks-plan.md`).
 *
 * Two questions, deliberately at two different levels:
 *
 * - **Per group, exact:** the translation was written from a specific set of
 *   source words (`Segment.sourceWords`). If any of those words is gone, or its
 *   text changed, or a *new* word landed inside the group's span, the
 *   translation may no longer say what the source says → `stale`. A group with
 *   no text at all is `untranslated`, which is reported instead of staleness
 *   because "write something here" outranks "check this again".
 * - **Per track, coarse:** `reflowNeeded` — "the source's *chunking* has changed
 *   since this track was created or re-flowed". It is deliberately not a
 *   per-group state: a manual merge/split on the translated tab is legitimate,
 *   and comparing boundaries per group would mark such a track re-flowed
 *   forever.
 *
 * Two rules this module exists to get right:
 *
 * 1. **Compare `{wid, text}` pairs, never wid sets.** `retimeWords` carries a
 *    word's `wid` through a one-for-one rewrite ("teh" → "the") on purpose, so a
 *    wid-only comparison would never notice a typo fix — the single most common
 *    reason a translation goes stale. Text is compared through `normalizeToken`,
 *    so a pure punctuation/casing fix is *not* stale.
 * 2. **Identity is all-or-nothing**, matching `reconcileGroups`: if any source
 *    word lacks a `wid`, every group is reported `stale` and `reflowNeeded` is
 *    true rather than half-classifying against words that cannot be named.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment, Word } from '../types/app'
import type { CaptionTrack, TrackGroupState } from './tracks'
import { normalizeToken } from './wordTiming'

/** Where one source word sits, as the source's *groups* see it. */
export interface SourceWordRef {
  word: Word
  groupIdx: number
  wordIdx: number
  isFirstInGroup: boolean
  isLastInGroup: boolean
  /** Position in source document order across every group. */
  order: number
}

/** The source track, indexed for staleness and timing questions. */
export interface SourceIndex {
  byId: ReadonlyMap<string, SourceWordRef>
  /** Every source wid, in document order. */
  order: readonly string[]
  /** The source's RAW groups, so a linked span can take a group's own bounds. */
  groups: readonly Segment[]
  /** False when any source word lacks a `wid` — nothing may be classified. */
  complete: boolean
}

export interface TrackClassification {
  byGroup: Map<string, TrackGroupState>
  staleCount: number
  untranslatedCount: number
  reflowNeeded: boolean
}

/** Context an attribution needs beyond the group itself. */
export interface AttributionContext {
  /** Every wid recorded by *any* group of the track (`recordedWids`) — it is
   *  what makes a source word "new", and therefore attributable. **Omit it and
   *  no insertion is attributed at all**: a group cannot tell, on its own,
   *  whether a word it never recorded is new or simply belongs to its
   *  neighbour, and claiming the neighbour's words would be far worse than
   *  missing an insertion. Any caller working inside a track should pass it. */
  allRecorded?: ReadonlySet<string>
  /** True for the track's first group, which adopts an insertion that lands
   *  ahead of every recorded word (`reconcileGroups`'s `leading` rule). */
  isFirstGroup?: boolean
}

/**
 * Index the source track's groups by word identity.
 *
 * Built from the **groups**, not the segments: the group is the unit a
 * translation is written against, and it is a group's own `start`/`end` that a
 * linked translated group borrows (`lib/trackTiming.ts`).
 */
export function buildSourceIndex(source: CaptionTrack): SourceIndex {
  const byId = new Map<string, SourceWordRef>()
  const order: string[] = []
  let complete = true

  source.groups.forEach((group, groupIdx) => {
    group.words.forEach((word, wordIdx) => {
      if (!word.wid) {
        complete = false
        return
      }
      byId.set(word.wid, {
        word,
        groupIdx,
        wordIdx,
        isFirstInGroup: wordIdx === 0,
        isLastInGroup: wordIdx === group.words.length - 1,
        order: order.length,
      })
      order.push(word.wid)
    })
  })

  return { byId, order, groups: source.groups, complete }
}

/** Every source wid this track's groups have recorded. */
export function recordedWids(track: CaptionTrack): ReadonlySet<string> {
  const out = new Set<string>()
  for (const g of track.groups) {
    for (const s of g.sourceWords ?? []) out.add(s.wid)
  }
  return out
}

/**
 * The source wids this group currently owns: its own surviving records, plus
 * any **insertion** attributed to it.
 *
 * An insertion is a source word no group of the track has recorded. It belongs
 * to the group that owns the word before it in source document order — the same
 * attribution rule `reconcileGroups` Rule 3 uses, so the marker a user sees
 * lines up with where a re-flow would actually put the new word. A run of
 * consecutive insertions all attributes to the same predecessor, and an
 * insertion ahead of every recorded word goes to the track's first group.
 *
 * Returned in source document order.
 */
export function attributedWids(
  group: Segment,
  index: SourceIndex,
  ctx: AttributionContext = {}
): string[] {
  const recorded = new Set((group.sourceWords ?? []).map((s) => s.wid))
  if (recorded.size === 0) return []

  // Without the track-level record there is no way to tell an insertion from a
  // neighbour's word, so nothing is attributed — only survivors are returned.
  const allRecorded = ctx.allRecorded
  if (!allRecorded) return index.order.filter((wid) => recorded.has(wid))

  const out: string[] = []
  // null until the first recorded word is seen — that window belongs to the
  // first group, if this is it.
  let ownedByThisGroup: boolean | null = ctx.isFirstGroup ? true : null

  for (const wid of index.order) {
    if (allRecorded.has(wid)) {
      ownedByThisGroup = recorded.has(wid)
      if (ownedByThisGroup) out.push(wid)
      continue
    }
    if (ownedByThisGroup) out.push(wid)
  }
  return out
}

/**
 * What the source says *now* for this group — the current text of the words it
 * owns, in source order. This is the `sourceText` an agent reads next to a
 * stale marker, so it must reflect corrections and pick up insertions.
 */
export function sourceTextFor(
  group: Segment,
  index: SourceIndex,
  ctx: AttributionContext = {}
): string {
  return attributedWids(group, index, ctx)
    .map((wid) => index.byId.get(wid)?.word.word ?? '')
    .filter((t) => t.trim())
    .join(' ')
}

/** §D's per-group test, in order. */
function classifyGroup(
  group: Segment,
  index: SourceIndex,
  ctx: AttributionContext
): TrackGroupState {
  if (group.text.trim() === '') return 'untranslated'

  const recorded = group.sourceWords ?? []
  // Nothing recorded — there is no claim about the source to invalidate.
  if (recorded.length === 0) return 'clean'

  for (const { wid, text } of recorded) {
    const ref = index.byId.get(wid)
    if (!ref) return 'stale'
    if (normalizeToken(text) !== normalizeToken(ref.word.word)) return 'stale'
  }

  // An insertion attributed here is a word the translation never saw.
  const recordedSet = new Set(recorded.map((s) => s.wid))
  return attributedWids(group, index, ctx).some((wid) => !recordedSet.has(wid))
    ? 'stale'
    : 'clean'
}

/** Deep equality for the wid-list-of-lists grouping fingerprint. */
function sameGrouping(a: readonly string[][], b: readonly string[][]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.length === b[i].length && row.every((wid, j) => wid === b[i][j]))
  )
}

/**
 * Classify every group of a translated track against the current source, and
 * decide whether the track's skeleton needs re-flowing.
 *
 * `reflowNeeded` compares wid lists only, so a source *text* edit never sets it
 * — that is per-group staleness's job. A track with no recorded snapshot (one
 * assembled by hand, or the source track itself) reports `false`: there is no
 * chunking claim to have been broken.
 */
export function classifyTrack(track: CaptionTrack, source: CaptionTrack): TrackClassification {
  const index = buildSourceIndex(source)
  const byGroup = new Map<string, TrackGroupState>()

  if (!index.complete) {
    // All-or-nothing: better a whole track flagged for review than a half
    // classification against words that cannot be identified.
    for (const g of track.groups) byGroup.set(g.id, 'stale')
    return {
      byGroup,
      staleCount: track.groups.length,
      untranslatedCount: 0,
      reflowNeeded: true,
    }
  }

  const allRecorded = recordedWids(track)
  let staleCount = 0
  let untranslatedCount = 0

  track.groups.forEach((group, i) => {
    const state = classifyGroup(group, index, { allRecorded, isFirstGroup: i === 0 })
    byGroup.set(group.id, state)
    if (state === 'stale') staleCount += 1
    else if (state === 'untranslated') untranslatedCount += 1
  })

  const current = index.groups.map((g) => g.words.map((w) => w.wid as string))
  const reflowNeeded = track.sourceSnapshot
    ? !sameGrouping(current, track.sourceSnapshot.groupWids)
    : false

  return { byGroup, staleCount, untranslatedCount, reflowNeeded }
}
