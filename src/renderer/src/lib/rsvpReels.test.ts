/**
 * Frontend half of the RSVP reel contract.
 *
 * `src/renderer/src/lib/rsvpReels.ts` is one of **two** implementations of the same
 * break rule; the twin is `backend/exporters/rsvp_reels.py`. Both suites read the
 * same fixture, `backend/tests/fixtures/rsvp_reel_cases.json` (through
 * `rsvpFixtures.testutil.ts`), so a rule that changes in one language and not the
 * other fails loudly on the side that did not change. Never hand-write an expected
 * range here — add a case to the fixture.
 *
 * The fixture pins the break rule alone (as index ranges over a normalised group
 * view); the *merge* output shape is each language's own, so it is asserted here in
 * `Segment` terms and in dict terms there.
 */

import { describe, expect, it } from 'vitest'
import { breaksReel, mergeRsvpReels, reelRanges } from './rsvpReels'
import { loadReelCases, MIN_REEL_CASES, type ReelGroupRow } from './rsvpFixtures.testutil'
import type { Segment, Word } from '../types/app'

const CASES = loadReelCases()

/** One normalised fixture row as the `Segment` this side consumes. */
function group(row: ReelGroupRow, index = 0): Segment {
  const segment: Segment = {
    id: `g${index}`,
    text: 'x',
    start: row.start,
    end: row.end,
    words: [],
  }
  if (row.speaker !== null) segment.speaker = row.speaker
  // Sparse exactly like real group state: a group with no override has no
  // `positionOverride` at all, and one with a partial override has only the key
  // the user set. Both must read the same as the backend's absent/None keys.
  if (row.posX !== null || row.posY !== null) {
    segment.positionOverride = {
      ...(row.posX !== null ? { position_x: row.posX } : {}),
      ...(row.posY !== null ? { position_y: row.posY } : {}),
    }
  }
  return segment
}

const groups = (rows: readonly ReelGroupRow[]): Segment[] => rows.map(group)

function word(text: string, start: number, end: number): Word {
  return { word: text, start, end }
}

function seg(id: string, start: number, end: number, words: Word[], extra: Partial<Segment> = {}): Segment {
  return { id, text: words.map((w) => w.word).join(' '), start, end, words, ...extra }
}

describe('the shared fixture', () => {
  it('is not gutted', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(MIN_REEL_CASES)
  })

  it('still covers every break reason', () => {
    // Otherwise a rule could be deleted and every case would still pass.
    const reasons = { gap: false, position: false, nonFinite: false, join: false }
    for (const { groups: rows } of CASES) {
      for (let i = 1; i < rows.length; i++) {
        const [a, b] = [rows[i - 1], rows[i]]
        if (!breaksReel(group(a), group(b))) {
          reasons.join = true
        } else if (!Number.isFinite(a.end) || !Number.isFinite(b.start)) {
          reasons.nonFinite = true
        } else if (a.end < b.start) {
          reasons.gap = true
        } else {
          reasons.position = true
        }
      }
    }
    expect(reasons).toEqual({ gap: true, position: true, nonFinite: true, join: true })
  })

  it('still covers a speaker change that must not break', () => {
    // The one rule this pass deliberately does NOT have (see the module doc
    // comment). Without a case where two touching groups have *different*
    // speakers and still share a reel, adding the rule back would pass
    // every other case.
    const covered = CASES.some(({ groups: rows }) =>
      rows.some(
        (b, i) => i > 0 && rows[i - 1].speaker !== b.speaker && !breaksReel(group(rows[i - 1]), group(b))
      )
    )
    expect(covered).toBe(true)
  })
})

describe.each(CASES)('$name', ({ groups: rows, reels }) => {
  it('matches the shared fixture', () => {
    expect(reelRanges(groups(rows))).toEqual(reels.map(([start, end]) => ({ start, end })))
  })

  it('covers every group exactly once', () => {
    const covered = reelRanges(groups(rows)).flatMap(({ start, end }) =>
      Array.from({ length: end - start }, (_, i) => start + i)
    )
    expect(covered).toEqual(rows.map((_, i) => i))
  })

  it('produces one merged group per range', () => {
    const input = groups(rows)
    expect(mergeRsvpReels(input)).toHaveLength(reelRanges(input).length)
  })
})

describe('mergeRsvpReels', () => {
  it('carries every word in order and spans its members', () => {
    // Arrange — three touching groups, i.e. one reel.
    const input = [
      seg('a', 0, 1, [word('a', 0, 0.5), word('b', 0.5, 1)]),
      seg('b', 1, 1.5, [word('c', 1, 1.5)]),
      seg('c', 1.5, 2.5, [word('d', 1.5, 2), word('e', 2, 2.5)]),
    ]

    // Act
    const merged = mergeRsvpReels(input)

    // Assert
    expect(merged).toHaveLength(1)
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(2.5)
    expect(merged[0].words.map((w) => w.word)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(merged[0].text).toBe('a b c d e')
  })

  it('carries word timings through untouched', () => {
    // RSVP is presentation-only: merging must never re-time a word.
    const words = [word('a', 0, 0.5), word('b', 0.5, 1), word('c', 1, 1.5)]
    const input = [seg('a', 0, 1, words.slice(0, 2)), seg('b', 1, 1.5, words.slice(2))]

    expect(mergeRsvpReels(input)[0].words).toEqual(words)
  })

  it('keeps groups apart across a real gap', () => {
    const input = [seg('a', 0, 1, [word('a', 0, 1)]), seg('b', 2, 3, [word('b', 2, 3)])]

    expect(mergeRsvpReels(input).map((g) => g.text)).toEqual(['a', 'b'])
  })

  it('is the identity when nothing joins', () => {
    // With every gap real (or gap closing disabled) RSVP behaves exactly as it
    // did per group — which is what makes this safe to apply unconditionally.
    const input = [seg('a', 0, 1, [word('a', 0, 1)]), seg('b', 2, 3, [word('b', 2, 3)])]

    expect(mergeRsvpReels(input)).toEqual(input)
  })

  it("takes a merged reel's end and endEdited from its last member", () => {
    const input = [
      seg('a', 0, 1, [word('a', 0, 1)], { endEdited: true }),
      seg('b', 1, 2, [word('b', 1, 2)]),
    ]

    const [reel] = mergeRsvpReels(input)

    expect(reel.end).toBe(2)
    expect(reel.endEdited).toBeUndefined()
  })

  it('carries a position override shared by the whole reel', () => {
    const override = { position_x: 0.4, position_y: 0.2 }
    const input = [
      seg('a', 0, 1, [word('a', 0, 1)], { positionOverride: override }),
      seg('b', 1, 2, [word('b', 1, 2)], { positionOverride: { ...override } }),
    ]

    const merged = mergeRsvpReels(input)

    expect(merged).toHaveLength(1)
    expect(merged[0].positionOverride).toEqual(override)
  })

  it('honours a differing position override instead of dropping it', () => {
    const input = [
      seg('a', 0, 1, [word('a', 0, 1)]),
      seg('b', 1, 2, [word('b', 1, 2)], { positionOverride: { position_y: 0.15 } }),
    ]

    const merged = mergeRsvpReels(input)

    expect(merged).toHaveLength(2)
    expect(merged[0].positionOverride).toBeUndefined()
    expect(merged[1].positionOverride).toEqual({ position_y: 0.15 })
  })

  it('does not leave a double space around an empty text', () => {
    const input = [
      seg('a', 0, 1, [word('a', 0, 1)]),
      { ...seg('gap', 1, 1.2, []), text: '' },
      seg('b', 1.2, 2, [word('b', 1.2, 2)]),
    ]

    expect(mergeRsvpReels(input)[0].text).toBe('a b')
  })

  it('never mutates the input', () => {
    const input = [seg('a', 0, 1, [word('a', 0, 1)]), seg('b', 1, 2, [word('b', 1, 2)])]
    const before = structuredClone(input)

    mergeRsvpReels(input)

    expect(input).toEqual(before)
  })

  it('handles empty input', () => {
    expect(reelRanges([])).toEqual([])
    expect(mergeRsvpReels([])).toEqual([])
  })
})
