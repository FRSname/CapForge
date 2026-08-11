/**
 * The `endEdited` claim — "the user placed this group's end by hand".
 *
 * The flag itself lives on a group `Segment` and is set by the edit surfaces
 * (timeline right-edge/body drag, the Groups editor's end field); it exempts the
 * group from automatic gap closing and from the final-group hold
 * (`lib/groups.ts` `closeGroupGaps`). This module holds the one piece of logic
 * that has to *infer* the claim rather than record it: the legacy-project
 * retrofit, kept here — next to `wordIds.ts`'s `adoptWordIds`, its counterpart —
 * so it is unit-testable without pulling in the results screen.
 */

import type { Segment } from '../types/app'

/**
 * Tolerance for "this group's end is not just its last word's end".
 *
 * Group ends are seconds carried through JSON and arithmetic, so an end that was
 * only ever derived from a word can come back a few ULPs off. Comparing with
 * `!==` would then flag every group as hand-edited and exempt the whole
 * transcript from gap closing.
 */
export const END_MATCH_EPSILON = 1e-6

/**
 * Retrofit the `endEdited` claim onto groups restored from a project file.
 *
 * A project saved before automatic gap closing existed has no `endEdited` flag,
 * but it may well contain hand-shaped ends — a timeline drag or a Groups-editor
 * end edit that carved out a deliberate gap. Without this the first render after
 * reopening would close those gaps back up, silently undoing the user's work.
 *
 * The evidence available in an old file is the end itself: a group whose `end`
 * is not (within a float epsilon) its last word's end was placed by hand, since
 * that natural end is what every automatic path derives. Mirrors `adoptWordIds`
 * — same "retrofit identity onto legacy groups on restore" role, same
 * reference-stable return so an already-flagged project passes through untouched.
 *
 * Note it also flags groups stretched by the old "Fill gaps" bake. That is
 * harmless: those ends already meet the next group's start, so gap closing is a
 * no-op on them either way, and the last group is left alone by that bake.
 */
export function adoptEndEdited(groups: readonly Segment[]): Segment[] {
  const isHandPlaced = (g: Segment): boolean => {
    if (g.endEdited) return false // already claimed — nothing to retrofit
    if (g.words.length === 0) return false // no natural end to compare against
    const natural = Math.max(...g.words.map((w) => w.end))
    if (!Number.isFinite(natural) || !Number.isFinite(g.end)) return false
    return Math.abs(g.end - natural) > END_MATCH_EPSILON
  }

  if (!groups.some(isHandPlaced)) return groups as Segment[]
  return groups.map((g) => (isHandPlaced(g) ? { ...g, endEdited: true } : g))
}
