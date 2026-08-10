import { describe, expect, test } from 'vitest'
import { MIN_WORD_DUR, joinWords, normalizeToken, retimeWords, tokenize } from './wordTiming'
import type { Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────

const w = (word: string, start: number, end: number, overrides?: Word['overrides']): Word => ({
  word,
  start,
  end,
  ...(overrides ? { overrides } : {}),
})

/** Three words with a 0.1 s silent gap between each. */
const gapped = (): Word[] => [w('Hello', 0.0, 0.5), w('world', 0.6, 1.2), w('today', 1.3, 2.0)]

/** Three back-to-back words, no silence anywhere. */
const contiguous = (): Word[] => [w('Hello', 0.0, 0.5), w('world', 0.5, 1.0), w('today', 1.0, 2.0)]

const BOUNDS = { start: 0, end: 2.0 }

/** Assert a word kept byte-identical timing — the whole point of this module. */
const expectSameTiming = (actual: Word, expected: Word): void => {
  expect(actual.word).toBe(expected.word)
  expect(actual.start).toBe(expected.start)
  expect(actual.end).toBe(expected.end)
}

const expectMonotonic = (words: readonly Word[]): void => {
  for (const word of words) expect(word.end).toBeGreaterThan(word.start)
  for (let i = 0; i < words.length - 1; i++) {
    expect(words[i].end).toBeLessThanOrEqual(words[i + 1].start + 1e-9)
  }
}

// ── Helpers ──────────────────────────────────────────────────────

describe('tokenize', () => {
  test('splits on whitespace and drops empties', () => {
    expect(tokenize('  Hello   big world ')).toEqual(['Hello', 'big', 'world'])
  })

  test('returns an empty array for blank text', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('normalizeToken', () => {
  test('ignores case and surrounding punctuation', () => {
    expect(normalizeToken('World,')).toBe(normalizeToken('world'))
    expect(normalizeToken('"Hello!"')).toBe('hello')
  })

  test('keeps word-internal punctuation', () => {
    expect(normalizeToken("don't")).toBe("don't")
  })
})

describe('joinWords', () => {
  test('skips empty words so no double space appears', () => {
    expect(joinWords([w('Hello', 0, 1), w('', 1, 2), w('world', 2, 3)])).toBe('Hello world')
  })
})

// ── The core invariant ───────────────────────────────────────────

describe('retimeWords — untouched words never move', () => {
  test('inserting a word leaves every other word byte-identical', () => {
    const before = gapped()
    const after = retimeWords(before, tokenize('Hello big world today'), BOUNDS)

    expect(after.map((x) => x.word)).toEqual(['Hello', 'big', 'world', 'today'])
    expectSameTiming(after[0], before[0])
    expectSameTiming(after[2], before[1])
    expectSameTiming(after[3], before[2])
    expectMonotonic(after)
  })

  test('the inserted word takes the silent gap, touching nothing', () => {
    const after = retimeWords(gapped(), tokenize('Hello big world today'), BOUNDS)
    expect(after[1].start).toBe(0.5)
    expect(after[1].end).toBe(0.6)
  })

  test('the reported repro no longer duplicates the last word timing', () => {
    const after = retimeWords(gapped(), tokenize('Hello big world today'), BOUNDS)
    // The old index-keyed code gave "world" and "today" both 1.3–2.0.
    expect(after[2].end).not.toBe(after[3].end)
    expect(after[2].start).not.toBe(after[3].start)
  })

  test('a typo fix with no word-count change changes no timing at all', () => {
    const before = gapped()
    const after = retimeWords(before, tokenize('Hello World, today'), BOUNDS)

    expect(after[1].word).toBe('World,')
    after.forEach((x, i) => {
      expect(x.start).toBe(before[i].start)
      expect(x.end).toBe(before[i].end)
    })
  })

  test('a typo fix preserves per-word overrides', () => {
    const before = [w('Hello', 0, 0.5), w('world', 0.6, 1.2, { text_color: '#ff0000' })]
    const after = retimeWords(before, tokenize('Hello World'), { start: 0, end: 1.2 })
    expect(after[1].overrides).toEqual({ text_color: '#ff0000' })
  })

  test('untouched words keep their overrides when a neighbour is inserted', () => {
    const before = [
      w('Hello', 0.0, 0.5),
      w('world', 0.6, 1.2, { text_color: '#00ff00' }),
      w('today', 1.3, 2.0),
    ]
    const after = retimeWords(before, tokenize('Hello big world today'), BOUNDS)
    expect(after[2].overrides).toEqual({ text_color: '#00ff00' })
  })
})

// ── Splitting one word into two ──────────────────────────────────

describe('retimeWords — splitting a word', () => {
  test('the halves partition the original span and neighbours are untouched', () => {
    const before = [w('Hello', 0.0, 0.5), w('wecan', 0.6, 1.2), w('today', 1.3, 2.0)]
    const after = retimeWords(before, tokenize('Hello we can today'), BOUNDS)

    expect(after.map((x) => x.word)).toEqual(['Hello', 'we', 'can', 'today'])
    expectSameTiming(after[0], before[0])
    expectSameTiming(after[3], before[2])

    // The two halves exactly cover what "wecan" covered.
    expect(after[1].start).toBe(0.6)
    expect(after[2].end).toBe(1.2)
    expect(after[1].end).toBe(after[2].start)
    expectMonotonic(after)
  })

  test('splitting into three still stays inside the original span', () => {
    const before = [w('Hello', 0.0, 0.5), w('abcdef', 0.6, 1.2)]
    const after = retimeWords(before, tokenize('Hello ab cd ef'), { start: 0, end: 1.2 })
    expect(after).toHaveLength(4)
    expect(after[1].start).toBe(0.6)
    expect(after[3].end).toBe(1.2)
    expectSameTiming(after[0], before[0])
    expectMonotonic(after)
  })

  test('a span too short for the minimum duration still never overflows', () => {
    const before = [w('Hello', 0.0, 0.5), w('abcdef', 0.6, 0.65), w('today', 1.3, 2.0)]
    const after = retimeWords(before, tokenize('Hello a b c d e f today'), BOUNDS)
    expect(after[1].start).toBe(0.6)
    expect(after[6].end).toBe(0.65)
    expectSameTiming(after[0], before[0])
    expectSameTiming(after[7], before[2])
  })
})

// ── Merging, deleting ────────────────────────────────────────────

describe('retimeWords — merging and deleting', () => {
  test('merging two words spans first.start to second.end', () => {
    const before = [w('Hello', 0.0, 0.5), w('we', 0.6, 0.9), w('can', 0.9, 1.2)]
    const after = retimeWords(before, tokenize('Hello wecan'), { start: 0, end: 1.2 })

    expect(after.map((x) => x.word)).toEqual(['Hello', 'wecan'])
    expectSameTiming(after[0], before[0])
    expect(after[1].start).toBe(0.6)
    expect(after[1].end).toBe(1.2)
  })

  test('a deleted word is absorbed by the previous survivor', () => {
    const before = gapped()
    const after = retimeWords(before, tokenize('Hello today'), BOUNDS)

    expect(after.map((x) => x.word)).toEqual(['Hello', 'today'])
    // "Hello" stays on screen through the deleted span; "today" never moves.
    expect(after[0].start).toBe(0.0)
    expect(after[0].end).toBe(1.2)
    expectSameTiming(after[1], before[2])
  })

  test('a deleted leading word pulls the next survivor start back', () => {
    const before = gapped()
    const after = retimeWords(before, tokenize('world today'), BOUNDS)

    expect(after.map((x) => x.word)).toEqual(['world', 'today'])
    expect(after[0].start).toBe(0.0)
    expect(after[0].end).toBe(1.2)
    expectSameTiming(after[1], before[2])
  })

  test('deleting every word returns an empty array', () => {
    expect(retimeWords(gapped(), [], BOUNDS)).toEqual([])
  })
})

// ── Insertion with no silence available ──────────────────────────

describe('retimeWords — insertion with no gap', () => {
  test('only the preceding word shortens; the rest are identical', () => {
    const before = contiguous()
    const after = retimeWords(before, tokenize('Hello big world today'), BOUNDS)

    expect(after.map((x) => x.word)).toEqual(['Hello', 'big', 'world', 'today'])
    expect(after[0].start).toBe(0.0)
    expect(after[0].end).toBeLessThan(0.5)
    expect(after[0].end).toBeGreaterThanOrEqual(MIN_WORD_DUR)
    expect(after[1].start).toBe(after[0].end)
    expect(after[1].end).toBe(0.5)
    expectSameTiming(after[2], before[1])
    expectSameTiming(after[3], before[2])
    expectMonotonic(after)
  })

  test('an insertion at the very head carves off the following word', () => {
    const before = [w('Hello', 0.0, 0.5), w('world', 0.5, 1.0)]
    const after = retimeWords(before, tokenize('Well Hello world'), { start: 0, end: 1.0 })

    expect(after.map((x) => x.word)).toEqual(['Well', 'Hello', 'world'])
    expect(after[0].start).toBe(0.0)
    expect(after[1].start).toBe(after[0].end)
    expect(after[1].end).toBe(0.5)
    expectSameTiming(after[2], before[1])
    expectMonotonic(after)
  })

  test('an insertion at the tail uses the span up to the segment end', () => {
    const before = [w('Hello', 0.0, 0.5), w('world', 0.5, 1.0)]
    const after = retimeWords(before, tokenize('Hello world today'), { start: 0, end: 2.0 })

    expect(after).toHaveLength(3)
    expectSameTiming(after[0], before[0])
    expectSameTiming(after[1], before[1])
    expect(after[2].start).toBe(1.0)
    expect(after[2].end).toBe(2.0)
  })
})

// ── Degenerate input ─────────────────────────────────────────────

describe('retimeWords — degenerate input', () => {
  test('no old words spreads the tokens across the bounds', () => {
    const after = retimeWords([], tokenize('one two three'), { start: 1, end: 4 })
    expect(after).toHaveLength(3)
    expect(after[0].start).toBe(1)
    expect(after[2].end).toBe(4)
    expectMonotonic(after)
  })

  test('replacing every word reuses the whole old span', () => {
    const before = gapped()
    const after = retimeWords(before, tokenize('completely different text'), BOUNDS)
    expect(after[0].start).toBe(0.0)
    expect(after[2].end).toBe(2.0)
    expectMonotonic(after)
  })

  test('a single word replaced keeps its exact span', () => {
    const before = [w('teh', 0.25, 0.75)]
    const after = retimeWords(before, tokenize('the'), { start: 0, end: 1 })
    expect(after).toEqual([w('the', 0.25, 0.75)])
  })

  test('a zero-length source word never yields an inverted result', () => {
    const before = [w('x', 0.5, 0.5)]
    const after = retimeWords(before, tokenize('y'), { start: 0, end: 1 })
    expectMonotonic(after)
  })
})
