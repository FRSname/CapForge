import { describe, expect, test } from 'vitest'
import { END_MATCH_EPSILON, adoptEndEdited } from './endEdited'
import type { Segment, Word } from '../types/app'

const word = (w: string, start: number, end: number): Word => ({ word: w, start, end })

/** A group whose `end` defaults to its last word's end (the "natural" end). */
const group = (id: string, words: Word[], end?: number): Segment => ({
  id,
  start: words[0]?.start ?? 0,
  end: end ?? words[words.length - 1]?.end ?? 0,
  text: words.map((w) => w.word).join(' '),
  words,
})

const sample = (end?: number): Segment =>
  group('g1', [word('the', 0, 0.5), word('quick', 0.5, 1), word('fox', 1, 1.5)], end)

describe('adoptEndEdited', () => {
  test('flags a group whose end was shaped by hand', () => {
    // Arrange — natural end is 1.5; this one stops early, i.e. a carved-out gap.
    const groups = [sample(1.2)]

    // Act
    const out = adoptEndEdited(groups)

    // Assert
    expect(out[0].endEdited).toBe(true)
  })

  test('flags a group whose end was stretched past its last word', () => {
    const out = adoptEndEdited([sample(2.4)])
    expect(out[0].endEdited).toBe(true)
  })

  test('leaves a group sitting on its natural end unflagged', () => {
    const out = adoptEndEdited([sample()])
    expect(out[0].endEdited).toBeUndefined()
  })

  test('takes the natural end from the latest word end, not the last word', () => {
    // Words out of chronological order: the max, not the tail, is the natural end.
    const g = group('g1', [word('a', 0, 1.5), word('b', 0.2, 0.6)], 1.5)
    expect(adoptEndEdited([g])[0].endEdited).toBeUndefined()
  })

  test('ignores a float-noise difference below the epsilon', () => {
    const out = adoptEndEdited([sample(1.5 + END_MATCH_EPSILON / 2)])
    expect(out[0].endEdited).toBeUndefined()
  })

  test('flags a difference just above the epsilon', () => {
    const out = adoptEndEdited([sample(1.5 + END_MATCH_EPSILON * 10)])
    expect(out[0].endEdited).toBe(true)
  })

  test('does not flag (or crash on) a group with no words', () => {
    // Math.max() of an empty list is -Infinity — the guard exists for this.
    const empty: Segment = { id: 'g1', start: 0, end: 3, text: '', words: [] }

    const out = adoptEndEdited([empty]) // must not throw, and must not flag

    expect(out[0].endEdited).toBeUndefined()
    expect(out[0]).toBe(empty)
  })

  test('does not flag a group whose timings are not finite', () => {
    const g = group('g1', [word('a', 0, Number.NaN)], 1.5)
    expect(adoptEndEdited([g])[0].endEdited).toBeUndefined()
  })

  test('leaves an already-flagged group alone', () => {
    const claimed: Segment = { ...sample(1.2), endEdited: true }

    const out = adoptEndEdited([claimed])

    expect(out[0]).toBe(claimed) // untouched, not re-wrapped
    expect(out[0].endEdited).toBe(true)
  })

  test('returns the input array by reference when nothing changes', () => {
    const groups = [sample(), { ...sample(1.2), endEdited: true }]
    expect(adoptEndEdited(groups)).toBe(groups)
  })

  test('only rewrites the groups that need the retrofit', () => {
    const natural = sample()
    const handShaped = { ...sample(1.2), id: 'g2' }

    const out = adoptEndEdited([natural, handShaped])

    expect(out[0]).toBe(natural)
    expect(out[1]).not.toBe(handShaped)
    expect(out[1].endEdited).toBe(true)
  })

  test('never mutates the input groups', () => {
    const groups = [sample(1.2)]
    adoptEndEdited(groups)
    expect(groups[0].endEdited).toBeUndefined()
  })

  test('returns an empty array unchanged', () => {
    const groups: Segment[] = []
    expect(adoptEndEdited(groups)).toBe(groups)
  })
})
