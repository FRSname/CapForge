/**
 * "Where does this translation sit in time?" — the track timing model (§C of
 * `docs/plans/multi-language-caption-tracks-plan.md`).
 *
 * A translated caption has no audio of its own, so its timing is *derived* from
 * the source, in two steps that must never fight each other:
 *
 * - **Bake** (`bakeTranslation`) turns text into words inside the group's own
 *   span, proportional to character count. It is a `retimeWords` call and
 *   nothing else — the LCS diff there is what keeps a word the translator did
 *   not touch byte-identical, which is the same locality invariant the source
 *   transcript enjoys. Every word it *derives* is marked `timingDerived`; a word
 *   the user pinned by dragging it on the timeline stays pinned.
 * - **Link** (`propagateSourceTiming`) moves the group's span when the source
 *   span behind it moves, then re-lays the derived words between the pinned
 *   ones. A group the user dragged on the translated tab is `timingLinked:
 *   false` and is never moved again.
 *
 * There is exactly one text→timing implementation in the codebase and this
 * module does not add a second: both paths go through `wordTiming.ts`
 * (`retimeWords` / `distribute`).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment, Word } from '../types/app'
import type { CaptionTrack } from './tracks'
import { withWordIds } from './wordIds'
import { siblingRuns } from './trackChunking'
import { MIN_WORD_DUR, distribute, joinWords, retimeWords, tokenize } from './wordTiming'
import {
  attributedWids,
  buildSourceIndex,
  type AttributionContext,
  type SourceIndex,
} from './trackStaleness'

/**
 * Re-record which source words this group is written from, from the source as
 * it is *now* — surviving records plus anything inserted into the span.
 *
 * This is what clears a `stale` marker: the translator has just read the current
 * source and written a translation of it, so that is the new reference.
 * A group that never had a record (one assembled by hand) does not get one.
 */
function reRecordSource(
  group: Segment,
  index: SourceIndex,
  ctx: AttributionContext
): Array<{ wid: string; text: string }> | undefined {
  if (!group.sourceWords) return undefined
  return attributedWids(group, index, ctx).map((wid) => ({
    wid,
    text: index.byId.get(wid)?.word.word ?? '',
  }))
}

/**
 * Write `text` into a translated group, deriving word timings across the
 * group's own span.
 *
 * The group's `start`/`end` never move — the span is the contract with the
 * source, and only `propagateSourceTiming` (or a deliberate drag) changes it.
 * Words carried through the edit keep their exact timing *and* their pinned
 * status; freshly derived words are marked `timingDerived` and get a `wid`.
 * Empty text leaves a placeholder: no words, but the span and the source record
 * survive so the group can be translated later and still knows what it is for.
 */
export function bakeTranslation(
  group: Segment,
  text: string,
  index: SourceIndex,
  ctx: AttributionContext = {}
): Segment {
  const sourceWords = reRecordSource(group, index, ctx)
  // A reflow's context is spent the moment someone writes over it.
  const { previousText: _spent, ...rest } = group
  const base = sourceWords ? { ...rest, sourceWords } : rest

  const tokens = tokenize(text)
  if (tokens.length === 0) return { ...base, text: '', words: [] }

  const previousById = new Map<string, Word>()
  for (const w of group.words) if (w.wid) previousById.set(w.wid, w)

  const retimed = retimeWords(group.words, tokens, { start: group.start, end: group.end })
  const marked = retimed.map((w) => {
    const previous = w.wid ? previousById.get(w.wid) : undefined
    if (!previous) return { ...w, timingDerived: true }
    // Carried word: whatever it was before, it still is. A pinned word that was
    // only re-spelled stays pinned (D3).
    const { timingDerived: _stale, ...bare } = w
    return previous.timingDerived ? { ...bare, timingDerived: true } : bare
  })

  const words = withWordIds(marked)
  return { ...base, text: joinWords(words), words }
}

/** Keep a word's span non-degenerate, mirroring `retimeWords`'s safety net. */
function widen(words: readonly Word[]): Word[] {
  return words.map((w) => (w.end > w.start ? w : { ...w, end: w.start + MIN_WORD_DUR }))
}

/**
 * Re-lay a group's words inside a new `[start, end]`: pinned words are clamped
 * into the span in order, and each run of derived words is re-distributed
 * between its pinned neighbours (or the span edges).
 */
function relayWords(words: readonly Word[], start: number, end: number): Word[] {
  if (words.length === 0) return words as Word[]

  const out: Word[] = words.map((w) => ({ ...w }))
  const pinned: number[] = []
  out.forEach((w, i) => {
    if (!w.timingDerived) pinned.push(i)
  })

  // Clamp the pinned words first — they are the fixed points everything else is
  // laid out between, and they must stay in order. A word squeezed against the
  // far edge is pulled back far enough to keep `MIN_WORD_DUR` *inside* the span
  // rather than left zero-length for `widen` to push back out of it.
  let floor = start
  for (const i of pinned) {
    const lowest = Math.max(floor, start)
    const latest = Math.max(end - MIN_WORD_DUR, lowest)
    const s = Math.min(Math.max(out[i].start, lowest), latest)
    const e = Math.min(Math.max(out[i].end, s + MIN_WORD_DUR), end)
    out[i] = { ...out[i], start: s, end: e }
    floor = e
  }

  // Then every maximal run of derived words, between its fixed neighbours.
  let i = 0
  while (i < out.length) {
    if (!out[i].timingDerived) {
      i += 1
      continue
    }
    let j = i
    while (j < out.length && out[j].timingDerived) j += 1
    const from = i > 0 ? out[i - 1].end : start
    const to = j < out.length ? out[j].start : end
    distribute(
      out.slice(i, j).map((w) => w.word),
      from,
      to
    ).forEach((span, k) => {
      out[i + k] = { ...out[i + k], start: span.start, end: span.end }
    })
    i = j
  }

  return widen(out)
}

/** The source span a linked group should occupy, or null when it has none. */
function linkedSpan(
  group: Segment,
  index: SourceIndex
): { start: number; end: number; endEdited: boolean } | null {
  const recorded = group.sourceWords ?? []
  if (recorded.length === 0) return null

  const surviving = recorded
    .map((s) => index.byId.get(s.wid))
    .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined)
  if (surviving.length === 0) return null

  const first = surviving[0]
  const last = surviving[surviving.length - 1]
  const firstGroup = index.groups[first.groupIdx]
  const lastGroup = index.groups[last.groupIdx]

  // Taking the *group's* bound at a group boundary is what carries a manual
  // timeline drag and a hand-placed end across to the translation; mid-group,
  // the word's own bound is the honest answer.
  return {
    start: first.isFirstInGroup ? firstGroup.start : first.word.start,
    end: last.isLastInGroup ? lastGroup.end : last.word.end,
    endEdited: last.isLastInGroup ? Boolean(lastGroup.endEdited) : Boolean(group.endEdited),
  }
}

/**
 * Where chunk `i` of a run lands inside the caption's new span.
 *
 * The run's chunks divide one caption, so they are rescaled *proportionally*
 * rather than each snapped to the whole span (which would stack them on top of
 * one another). The two outer bounds are taken verbatim so the caption starts
 * and ends exactly where the source says, floating-point drift and all; a
 * degenerate caption (zero-length, so nothing to scale) is divided evenly.
 */
function chunkSpan(
  run: readonly Segment[],
  i: number,
  span: { start: number; end: number }
): { start: number; end: number } {
  const from = run[0].start
  const length = run[run.length - 1].end - from
  const target = span.end - span.start
  const scale = (t: number): number =>
    length > 0 ? span.start + ((t - from) / length) * target : span.start
  const even = (k: number): number => span.start + (k / run.length) * target
  return {
    start: i === 0 ? span.start : length > 0 ? scale(run[i].start) : even(i),
    end: i === run.length - 1 ? span.end : length > 0 ? scale(run[i].end) : even(i + 1),
  }
}

/** Move one group onto a span already decided for it, or return it untouched. */
function moveGroup(
  group: Segment,
  span: { start: number; end: number },
  endEdited: boolean
): Segment {
  if (
    span.start === group.start &&
    span.end === group.end &&
    endEdited === Boolean(group.endEdited)
  ) {
    return group
  }
  const { endEdited: _previousClaim, ...rest } = group
  return {
    ...rest,
    start: span.start,
    end: span.end,
    words: relayWords(group.words, span.start, span.end),
    ...(endEdited ? { endEdited: true } : {}),
  }
}

/**
 * Move a whole sibling run — the chunks of one inherited caption
 * (`lib/trackChunking.ts`) — onto the caption's linked span.
 *
 * The link is with the *caption*, not with a chunk: every chunk carries the
 * same `sourceWords` record, so asking each one separately would give them all
 * the same span. The run's own end claim is the **last** chunk's, and that is
 * where a hand-placed source end lands. A run holding a chunk the user pinned
 * is not a unit any more, so it falls back to per-group linking.
 */
function relinkRun(run: readonly Segment[], index: SourceIndex): Segment[] {
  if (run.length === 1) return [relinkGroup(run[0], index)]
  if (run.some((g) => g.timingLinked === false)) return run.map((g) => relinkGroup(g, index))

  const span = linkedSpan(run[run.length - 1], index)
  if (!span) return run as Segment[]

  return run.map((g, i) =>
    moveGroup(g, chunkSpan(run, i, span), i === run.length - 1 ? span.endEdited : false)
  )
}

/** Move one group onto its linked span, or return it untouched. */
function relinkGroup(group: Segment, index: SourceIndex): Segment {
  if (group.timingLinked === false) return group

  const span = linkedSpan(group, index)
  if (!span) return group
  return moveGroup(group, span, span.endEdited)
}

/**
 * Move every linked group of a translated track onto the source span it records
 * (D4). Run whenever the source track's segments or groups change.
 *
 * Reference-stable: a track where nothing moved comes back as the *same object*,
 * and so does every group inside one where only a neighbour moved — so this can
 * sit in an effect without churning React identities.
 *
 * A group whose recorded source words have all vanished is left where it is
 * rather than collapsed: `classifyTrack` will already be reporting it stale, and
 * a translation the user can still see and re-anchor beats one that silently
 * jumped to zero.
 */
export function propagateSourceTiming(track: CaptionTrack, source: CaptionTrack): CaptionTrack {
  if (track.isSource) return track

  const index = buildSourceIndex(source)
  // Identity is all-or-nothing — with an unidentifiable source there is nothing
  // to link against, so nothing moves.
  if (!index.complete) return track

  let changed = false
  const groups: Segment[] = []
  for (const run of siblingRuns(track.groups)) {
    const slice = track.groups.slice(run.start, run.start + run.length)
    relinkRun(slice, index).forEach((g, i) => {
      if (g !== slice[i]) changed = true
      groups.push(g)
    })
  }

  return changed ? { ...track, groups } : track
}
