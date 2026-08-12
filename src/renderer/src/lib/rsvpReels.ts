/**
 * RSVP reels — joining caption groups into one continuously flowing line.
 *
 * In `readingMode: 'rsvp'` the unit of layout is **not** the caption group. A
 * group is a display chunk of `wordsPerGroup` words; laying the RSVP line out per
 * group means that at every chunk boundary the line is rebuilt from zero and snaps
 * to its first word (`lineOffsetAt` never eases index 0), the previous words vanish
 * and the group entry animation fires again. The reading line should cross a group
 * boundary exactly the way it crosses a word boundary: one more slide.
 *
 * So before the overlay sees them, consecutive groups that are already
 * **continuous in time** are merged into a *reel* — one group carrying all their
 * words — and the existing per-group machinery (active-group lookup, layout, the
 * entry/exit animation, the background box) then operates on the reel unchanged.
 *
 * ## The rule
 *
 * A break between consecutive groups `a` and `b` happens when, in this order:
 *
 * 1. **Missing timing** — `a.end` or `b.start` is not finite. Never join on junk
 *    data; mirrors rule 2 of the gap-closing pass (`closeGroupGaps`).
 * 2. **A real blank gap** — `a.end < b.start`. This is deliberately the *existing
 *    blanking rule*: a frame between `a.end` and `b.start` has no active group and
 *    draws nothing today, so joining exactly the pairs that have no such frame adds
 *    continuity **without changing when captions appear or disappear**. Gap closing
 *    runs upstream and has already pulled `a.end` up to `b.start` for every gap at
 *    or below `gapCloseThreshold`, so that dial is what decides how long a reel
 *    gets; a real pause still breaks it.
 * 3. **A differing position override** — `positionOverride.position_x`/`_y` compared
 *    as a pair. A reel spans groups, so it can carry only one caption anchor;
 *    breaking here means a per-group override is *honoured* rather than silently
 *    dropped, and the words either side of it were going to be visually separated
 *    anyway.
 *
 * Deliberately **not** a break: a **speaker change**. Gap closing refuses to
 * *bridge* one, so any real pause between two speakers already breaks the reel by
 * rule 2; what is left is a speaker change with no gap at all, and resetting the
 * reading line there would be a worse artefact than letting the words flow. It is
 * also not expressible on both sides of the parity contract — the backend's
 * `CustomGroup` carries no `speaker`, so this side would break reels the render
 * would not. The shared fixture pins the *ignoring* of it.
 *
 * ## This module has a twin
 *
 * `backend/exporters/rsvp_reels.py` (Pillow + the HTML/GSAP layer, which is handed
 * its groups already merged by Python). Both read the same fixture,
 * `backend/tests/fixtures/rsvp_reel_cases.json`. There is deliberately no third
 * copy — same shape as the gap-closing pass, which is likewise a group-list
 * transform with two implementations rather than three.
 *
 * Not a rendering formula: nothing here measures, positions or draws anything, and
 * no timing is ever written — a reel's `start`/`end` are its members' own
 * (CLAUDE.md → Word-timing locality).
 */

import type { Segment } from '../types/app'

/** The group's position override as a comparable pair; `[undefined, undefined]`
 *  when it follows the global settings position. */
function positionKey(group: Segment): [number | undefined, number | undefined] {
  const override = group.positionOverride
  return [override?.position_x, override?.position_y]
}

/**
 * Does the boundary between consecutive groups `a` and `b` break the reel?
 *
 * The three rules above, in order. Pure: reads only `start`/`end` and the position
 * override, and mutates nothing.
 */
export function breaksReel(a: Segment, b: Segment): boolean {
  if (!Number.isFinite(a.end) || !Number.isFinite(b.start)) return true
  if (a.end < b.start) return true

  const [ax, ay] = positionKey(a)
  const [bx, by] = positionKey(b)
  return ax !== bx || ay !== by
}

/** An index range `[start, end)` over the input groups. */
export interface ReelRange {
  readonly start: number
  readonly end: number
}

/**
 * Index ranges of the maximal runs of joinable groups.
 *
 * Returned as index ranges rather than merged groups so the rule can be pinned by a
 * fixture that knows nothing about either language's group shape — see
 * `backend/tests/fixtures/rsvp_reel_cases.json`. The ranges always cover the whole
 * input exactly once, in order.
 */
export function reelRanges(groups: readonly Segment[]): ReelRange[] {
  if (groups.length === 0) return []

  const ranges: ReelRange[] = []
  let start = 0
  for (let i = 1; i < groups.length; i++) {
    if (breaksReel(groups[i - 1], groups[i])) {
      ranges.push({ start, end: i })
      start = i
    }
  }
  ranges.push({ start, end: groups.length })
  return ranges
}

/**
 * Merge each reel's groups into one group carrying all their words.
 *
 * A reel of one group is returned **as-is** (the same object), so with every gap
 * real — or `gapCloseThreshold` at 0 — this is the identity and RSVP behaves
 * exactly as it did per group. Which is what makes it safe to apply
 * unconditionally in RSVP mode.
 *
 * `speaker` and the position override are homogeneous across a reel by construction
 * (rule 3 and the speaker note above), so the merged group takes the first member's;
 * `end` and `endEdited` come from the **last** member, which is the group whose end
 * the reel actually ends at.
 *
 * Returns a new array of new objects; the input is never mutated.
 */
export function mergeRsvpReels(groups: readonly Segment[]): Segment[] {
  return reelRanges(groups).map(({ start, end }) => {
    const members = groups.slice(start, end)
    const first = members[0]
    if (members.length === 1) return first

    const last = members[members.length - 1]
    return {
      ...first,
      id: members.map((g) => g.id).join('+'),
      text: members
        .map((g) => g.text.trim())
        .filter(Boolean)
        .join(' '),
      end: last.end,
      endEdited: last.endEdited,
      words: members.flatMap((g) => g.words),
    }
  })
}
