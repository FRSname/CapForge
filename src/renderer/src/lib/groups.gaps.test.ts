import { describe, expect, test } from 'vitest'
import { buildStudioGroups, closeGroupGaps } from './groups'
import type { Segment, Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────

const word = (w: string, start: number, end: number): Word => ({ word: w, start, end })

/** One segment, six words, 0.5 s each starting at `base`. */
const makeSegment = (id: string, base = 0, speaker?: string): Segment => {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over'].map((w, i) =>
    word(w, base + i * 0.5, base + i * 0.5 + 0.5)
  )
  return {
    id,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.word).join(' '),
    words,
    speaker,
  }
}

/** One group, one word spanning its full bounds. */
const grp = (id: string, start: number, end: number, extra: Partial<Segment> = {}): Segment => ({
  id,
  start,
  end,
  text: id,
  words: [word(id, start, end)],
  ...extra,
})

// ── closeGroupGaps ─────────────────────────────────────────────────
//
// The derived pass: close only *short* gaps (so real pauses still clear the
// screen), never bridge a speaker change, never touch a group whose end the
// user placed by hand, and hold the very last caption past its final word.

describe('closeGroupGaps', () => {
  test('closes a gap at or below the threshold', () => {
    // Arrange — a 0.09 s gap, well inside the 0.25 s threshold.
    const groups = [grp('a', 1.8, 2.31), grp('b', 2.4, 3.0)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(2.4)
  })

  test('leaves a gap longer than the threshold alone', () => {
    // Arrange — a 0.55 s pause the viewer should see as a break.
    const groups = [grp('a', 1.8, 2.31), grp('b', 2.86, 3.4)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(2.31)
  })

  test('closes a gap exactly equal to the threshold (inclusive boundary)', () => {
    // Arrange — gap is exactly 0.25 s.
    const groups = [grp('a', 0, 1), grp('b', 1.25, 2)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1.25)
  })

  test('is idempotent for gap closing (deliberately excludes the tail hold)', () => {
    // Arrange — the tail hold is NOT idempotent by design, so it is off here.
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2), grp('c', 2.9, 3.5)]

    // Act
    const once = closeGroupGaps(groups, 0.25, 0)
    const twice = closeGroupGaps(once, 0.25, 0)

    // Assert
    expect(twice).toEqual(once)
  })

  test('never bridges a speaker change', () => {
    // Arrange — a 0.02 s gap, but a different speaker on each side.
    const groups = [
      grp('a', 0, 1, { speaker: 'SPEAKER_00' }),
      grp('b', 1.02, 2, { speaker: 'SPEAKER_01' }),
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1)
  })

  test('closes a short gap between two groups of the same speaker', () => {
    // Arrange — same 0.02 s gap, same speaker.
    const groups = [
      grp('a', 0, 1, { speaker: 'SPEAKER_00' }),
      grp('b', 1.02, 2, { speaker: 'SPEAKER_00' }),
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1.02)
  })

  test('never changes group count, text, start times, words or overrides', () => {
    // Arrange — two segments 0.1 s apart, so the cross-segment boundary carries
    // a genuine sub-threshold gap and the rewriting branch is actually taken.
    // (Groups derived from one segment abut exactly, which would make this a
    // no-op test.)
    const groups = buildStudioGroups([makeSegment('s1'), makeSegment('s2', 3.1)], 2).map((g, i) =>
      i === 1
        ? {
            ...g,
            positionOverride: { position_x: 0.25 },
            words: g.words.map((w, j) => (j === 0 ? { ...w, overrides: { bold: true } } : w)),
          }
        : g
    )

    // Act
    const closed = closeGroupGaps(groups, 0.25, 1.0)

    // Assert — the pass really did move ends (guards the fixture itself)…
    expect(closed[2].end).toBe(3.1)
    expect(closed[closed.length - 1].end).toBe(groups[groups.length - 1].end + 1.0)
    // …while leaving everything except `end` alone.
    expect(closed).toHaveLength(groups.length)
    expect(closed.map((g) => g.text)).toEqual(groups.map((g) => g.text))
    expect(closed.map((g) => g.start)).toEqual(groups.map((g) => g.start))
    expect(closed.map((g) => g.words)).toEqual(groups.map((g) => g.words))
    expect(closed[1].positionOverride).toEqual({ position_x: 0.25 })
    expect(closed[1].words[0].overrides).toEqual({ bold: true })
  })

  test('holds the final group for lastGroupHold past its original end', () => {
    // Arrange
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 1.0)

    // Assert
    expect(closed[1].end).toBe(3)
  })

  test('does not hold the final group when lastGroupHold is 0', () => {
    // Arrange
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[1].end).toBe(2)
  })

  test('does not apply the hold to any group but the last', () => {
    // Arrange — a long gap so nothing is closed either.
    const groups = [grp('a', 0, 1), grp('b', 5, 6), grp('c', 9, 10)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 1.0)

    // Assert
    expect(closed.map((g) => g.end)).toEqual([1, 6, 11])
  })

  test('leaves a boundary alone when a word timing is not finite', () => {
    // Arrange — a 0.1 s gap, but the first group's last word has no end.
    const groups: Segment[] = [
      { id: 'a', start: 0, end: 1, text: 'a', words: [word('a', 0, NaN)] },
      grp('b', 1.1, 2),
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1)
  })

  test("leaves a boundary alone when the *next* group's first word start is not finite", () => {
    // Arrange — same 0.1 s gap, but this time it is `b`'s side of the boundary
    // that has no timing. Guard 06 checks both words, not just `a`'s.
    const groups: Segment[] = [
      grp('a', 0, 1),
      { id: 'b', start: 1.1, end: 2, text: 'b', words: [word('b', NaN, 2)] },
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1)
  })

  test('skips a malformed group with no words array instead of throwing', () => {
    // Arrange — an old project file whose group lost its `words`. The cast is
    // the point: TypeScript says this cannot happen, the data says otherwise.
    const groups = [
      { id: 'a', start: 0, end: 1, text: 'a' } as unknown as Segment,
      grp('b', 1.1, 2),
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1)
    expect(closed[1].end).toBe(2)
  })

  test('never shortens an end when groups overlap', () => {
    // Arrange — a negative gap (out-of-order/overlapping groups).
    const groups = [grp('a', 0, 5), grp('b', 3, 6)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(5)
  })

  test('threshold 0 disables closing but still applies the hold', () => {
    // Arrange — the two dials are independent.
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2)]

    // Act
    const closed = closeGroupGaps(groups, 0, 1.0)

    // Assert
    expect(closed[0].end).toBe(1)
    expect(closed[1].end).toBe(3)
  })

  test('never extends a group whose end was edited by hand', () => {
    // Arrange — a 0.1 s gap the user deliberately carved out.
    const groups = [grp('a', 0, 1, { endEdited: true }), grp('b', 1.1, 2)]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1)
  })

  test('still closes the gap into an endEdited group (the flag exempts a, not b)', () => {
    // Arrange — only the *second* group carries a hand-placed end.
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2, { endEdited: true })]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 0)

    // Assert
    expect(closed[0].end).toBe(1.1)
  })

  test('does not hold the final group when its end was edited by hand', () => {
    // Arrange
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2, { endEdited: true })]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 1.0)

    // Assert
    expect(closed[1].end).toBe(2)
  })

  test('preserves endEdited on every returned group', () => {
    // Arrange
    const groups = [
      grp('a', 0, 1, { endEdited: true }),
      grp('b', 1.1, 2),
      grp('c', 2.05, 3, { endEdited: true }),
    ]

    // Act
    const closed = closeGroupGaps(groups, 0.25, 1.0)

    // Assert
    expect(closed.map((g) => g.endEdited)).toEqual([true, undefined, true])
  })

  test('returns an empty array for an empty input', () => {
    expect(closeGroupGaps([], 0.25, 1.0)).toEqual([])
  })

  test('does not mutate the input array or its group objects', () => {
    // Arrange
    const groups = [grp('a', 0, 1), grp('b', 1.1, 2)]
    const before = JSON.parse(JSON.stringify(groups))

    // Act
    closeGroupGaps(groups, 0.25, 1.0)

    // Assert
    expect(groups).toEqual(before)
  })
})

// ── Shared parity table ────────────────────────────────────────────
//
// Twin: `SHARED_FIXTURE` / `PARITY_CASES` in
// `backend/tests/test_group_gap_closing.py`, which pins the Python mirror
// `_close_group_gaps`. The two suites run the same fixture through the same
// dial settings and assert the same literal ends, so a rule that changes on one
// side and not the other fails loudly on the side that did not change. Edit
// these two tables together.
//
// Every branch of the algorithm in one array: a closable gap, an exactly-on-the-
// threshold gap, an over-threshold pause, a speaker change, an overlap, both
// sides of the non-finite-timing guard, an already-closed boundary, and a tail
// to hold. (The hand-placed-end exemption is TS-only — such a group reaches the
// backend as `custom_groups`, which bypasses the pass — so it is covered by the
// `endEdited` tests above, not by this table.)
//
// A missing word timing is `NaN` here and `None` on the Python side; both mean
// "not finite", which is what the guard actually tests.
const PARITY_FIXTURE: Segment[] = [
  // 0 → 0.05 s gap into #1: closes at any threshold >= 0.05.
  grp('closable', 0.0, 1.0, { speaker: 'SPEAKER_00' }),
  // 1 → 0.25 s gap into #2: exactly the default threshold (inclusive).
  grp('boundary', 1.05, 2.0, { speaker: 'SPEAKER_00' }),
  // 2 → 0.60 s gap into #3: a real pause at 0.25, closable at 0.65.
  grp('pause', 2.25, 3.0, { speaker: 'SPEAKER_00' }),
  // 3 → 0.02 s gap into #4, but across a speaker change: never bridged.
  grp('pre-change', 3.6, 4.0, { speaker: 'SPEAKER_00' }),
  // 4 → overlaps #5 by 0.20 s: a negative gap must never shorten an end.
  grp('post-change', 4.02, 5.2, { speaker: 'SPEAKER_01' }),
  // 5 → #6's first word start is not finite: right-hand guard 06.
  grp('overlapping', 5.0, 6.0, { speaker: 'SPEAKER_01' }),
  // 6 → its own last word end is not finite: left-hand guard 06.
  grp('no-timing', 6.1, 6.5, {
    speaker: 'SPEAKER_01',
    words: [word('no-timing', NaN, NaN)],
  }),
  // 7 → 0.0 s gap into #8: already closed, fails `gap > 0`.
  grp('already-closed', 6.6, 7.0, { speaker: 'SPEAKER_01' }),
  // 8 → the last group: only the tail hold can move it.
  grp('tail', 7.0, 8.0, { speaker: 'SPEAKER_01' }),
]

// [threshold, hold, the end each fixture group carries afterwards]. Spelled out
// rather than computed, so a rule change shows up as a readable diff.
//
//                     closable boundary pause pre-chg post-chg overlap no-tim closed tail
const PARITY_CASES: Array<[number, number, number[]]> = [
  // Shipped defaults.
  [0.25, 1.0, [1.05, 2.25, 3.0, 4.0, 5.2, 6.0, 6.5, 7.0, 9.0]],
  // Hold off: only the tail differs from the row above.
  [0.25, 0.0, [1.05, 2.25, 3.0, 4.0, 5.2, 6.0, 6.5, 7.0, 8.0]],
  // Closing off, hold on — the two dials are independent.
  [0.0, 1.0, [1.0, 2.0, 3.0, 4.0, 5.2, 6.0, 6.5, 7.0, 9.0]],
  // Both off: the pass is a no-op on every end.
  [0.0, 0.0, [1.0, 2.0, 3.0, 4.0, 5.2, 6.0, 6.5, 7.0, 8.0]],
  // 0.6 does NOT close the "pause" boundary: `3.60 - 3.00` is
  // 0.6000000000000001 in IEEE754. Python floats do the same thing, so the two
  // implementations still agree — a fixture quirk, not a rule.
  [0.6, 2.5, [1.05, 2.25, 3.0, 4.0, 5.2, 6.0, 6.5, 7.0, 10.5]],
  // …and 0.65 does, proving that boundary is threshold-gated, not guard-blocked.
  [0.65, 0.0, [1.05, 2.25, 3.6, 4.0, 5.2, 6.0, 6.5, 7.0, 8.0]],
]

describe('closeGroupGaps parity table', () => {
  test.each(PARITY_CASES)(
    'threshold %f / hold %f produces the expected ends',
    (threshold, hold, expected) => {
      // Arrange / Act
      const closed = closeGroupGaps(PARITY_FIXTURE, threshold, hold)

      // Assert
      closed.forEach((g, i) => expect(g.end).toBeCloseTo(expected[i], 6))
    }
  )
})
