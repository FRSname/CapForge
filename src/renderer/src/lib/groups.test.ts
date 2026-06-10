import { describe, expect, test } from 'vitest'
import { buildStudioGroups, mergeGroups, splitGroup, moveWord, reorderGroup } from './groups'
import type { Segment, Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────

const word = (w: string, start: number, end: number, overrides?: Word['overrides']): Word => ({
  word: w,
  start,
  end,
  ...(overrides ? { overrides } : {}),
})

/** One segment, six words, 0.5 s each starting at `base`. */
const makeSegment = (id: string, base = 0, speaker?: string): Segment => {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over'].map((w, i) =>
    word(w, base + i * 0.5, base + i * 0.5 + 0.5)
  )
  return {
    id,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map(w => w.word).join(' '),
    words,
    speaker,
  }
}

// ── buildStudioGroups ────────────────────────────────────────────

describe('buildStudioGroups', () => {
  test('chunks segment words into groups of N words', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    expect(groups).toHaveLength(2)
    expect(groups[0].text).toBe('the quick brown')
    expect(groups[1].text).toBe('fox jumps over')
    expect(groups[0].words).toHaveLength(3)
    expect(groups[1].words).toHaveLength(3)
  })

  test('derives group start/end from first/last word timestamps', () => {
    const groups = buildStudioGroups([makeSegment('s1', 10)], 3)
    expect(groups[0].start).toBe(10)
    expect(groups[0].end).toBe(11.5)
    expect(groups[1].start).toBe(11.5)
    expect(groups[1].end).toBe(13)
  })

  test('word counts not divisible by N produce a valid trailing group', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 4)
    expect(groups).toHaveLength(2)
    expect(groups[0].words).toHaveLength(4)
    expect(groups[1].words).toHaveLength(2)
    expect(groups[1].text).toBe('jumps over')
    expect(groups[1].start).toBe(2)
    expect(groups[1].end).toBe(3)
  })

  test('preserves per-word style overrides through a rebuild (v1.4.0 regression)', () => {
    const seg = makeSegment('s1')
    const styled: Segment = {
      ...seg,
      words: seg.words.map((w, i) =>
        i === 1 ? { ...w, overrides: { text_color: '#FF0000', font_size_scale: 1.5 } } : w
      ),
    }
    // Rebuild twice with different word counts — overrides must survive both.
    const first = buildStudioGroups([styled], 3)
    expect(first[0].words[1].overrides).toEqual({ text_color: '#FF0000', font_size_scale: 1.5 })

    const rebuilt = buildStudioGroups([styled], 2)
    expect(rebuilt[0].words[1].overrides).toEqual({ text_color: '#FF0000', font_size_scale: 1.5 })
  })

  test('changing words-per-group keeps every word exactly once', () => {
    const seg = makeSegment('s1')
    for (const wpg of [1, 2, 3, 4, 5, 6, 7]) {
      const groups = buildStudioGroups([seg], wpg)
      const flat = groups.flatMap(g => g.words.map(w => w.word))
      expect(flat).toEqual(['the', 'quick', 'brown', 'fox', 'jumps', 'over'])
    }
  })

  test('segment without word timing becomes a single group carrying its text', () => {
    const seg: Segment = { id: 's1', start: 1, end: 4, text: 'hello world', words: [] }
    const groups = buildStudioGroups([seg], 3)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ start: 1, end: 4, text: 'hello world' })
    expect(groups[0].words).toEqual([{ word: 'hello world', start: 1, end: 4 }])
  })

  test('invalid wordsPerGroup falls back to a sane chunk size', () => {
    const seg = makeSegment('s1')
    // 0 and NaN fall back to 3 per the implementation; negative clamps to >= 1.
    expect(buildStudioGroups([seg], 0)).toHaveLength(2)
    expect(buildStudioGroups([seg], NaN)).toHaveLength(2)
    expect(buildStudioGroups([seg], -2).length).toBeGreaterThan(0)
  })

  test('trims surrounding whitespace from words and joins text with single spaces', () => {
    const seg: Segment = {
      id: 's1',
      start: 0,
      end: 1,
      text: ' hello  world ',
      words: [word(' hello ', 0, 0.5), word(' world ', 0.5, 1)],
    }
    const groups = buildStudioGroups([seg], 2)
    expect(groups[0].text).toBe('hello world')
    expect(groups[0].words.map(w => w.word)).toEqual(['hello', 'world'])
  })

  test('carries the segment speaker onto every derived group', () => {
    const groups = buildStudioGroups([makeSegment('s1', 0, 'SPEAKER_00')], 2)
    expect(groups.every(g => g.speaker === 'SPEAKER_00')).toBe(true)
  })

  test('assigns stable ids per segment + word offset', () => {
    const groups = buildStudioGroups([makeSegment('a'), makeSegment('b', 10)], 3)
    expect(groups.map(g => g.id)).toEqual(['a:0', 'a:3', 'b:0', 'b:3'])
  })
})

// ── mergeGroups ──────────────────────────────────────────────────

describe('mergeGroups', () => {
  test('merges a group with the next one, combining words and bounds', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const merged = mergeGroups(groups, 0)
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('the quick brown fox jumps over')
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(3)
    expect(merged[0].words).toHaveLength(6)
  })

  test('is a no-op on the last group or out-of-range index', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    expect(mergeGroups(groups, groups.length - 1)).toBe(groups)
    expect(mergeGroups(groups, -1)).toBe(groups)
    expect(mergeGroups(groups, 99)).toBe(groups)
  })

  test('does not mutate the input array', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const before = JSON.parse(JSON.stringify(groups))
    mergeGroups(groups, 0)
    expect(groups).toEqual(before)
  })
})

// ── splitGroup ───────────────────────────────────────────────────

describe('splitGroup', () => {
  test('splits after the Nth word with recomputed bounds and text', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 6)
    const split = splitGroup(groups, 0, 2)
    expect(split).toHaveLength(2)
    expect(split[0].text).toBe('the quick')
    expect(split[0].end).toBe(1)
    expect(split[1].text).toBe('brown fox jumps over')
    expect(split[1].start).toBe(1)
    expect(split[1].end).toBe(3)
  })

  test('is a no-op at the edges (nothing to split off)', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 6)
    expect(splitGroup(groups, 0, 0)).toBe(groups)
    expect(splitGroup(groups, 0, 6)).toBe(groups)
    expect(splitGroup(groups, 99, 1)).toBe(groups)
  })

  test('keeps per-word overrides on both halves', () => {
    const seg = makeSegment('s1')
    seg.words[0] = { ...seg.words[0], overrides: { bold: true } }
    seg.words[5] = { ...seg.words[5], overrides: { text_color: '#00FF00' } }
    const split = splitGroup(buildStudioGroups([seg], 6), 0, 3)
    expect(split[0].words[0].overrides).toEqual({ bold: true })
    expect(split[1].words[2].overrides).toEqual({ text_color: '#00FF00' })
  })
})

// ── moveWord ─────────────────────────────────────────────────────

describe('moveWord', () => {
  test('moving down prepends the word to the destination group', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const next = moveWord(groups, 0, 2, 1) // move "brown" into second group
    expect(next[0].text).toBe('the quick')
    expect(next[1].text).toBe('brown fox jumps over')
    expect(next[0].end).toBe(1)
    expect(next[1].start).toBe(1)
  })

  test('moving up appends the word to the destination group', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const next = moveWord(groups, 1, 0, 0) // move "fox" back into first group
    expect(next[0].text).toBe('the quick brown fox')
    expect(next[1].text).toBe('jumps over')
  })

  test('drops the source group entirely when it becomes empty', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const single = splitGroup(groups, 1, 1) // → [the quick brown][fox][jumps over]
    const next = moveWord(single, 1, 0, 2)
    expect(next).toHaveLength(2)
    expect(next[1].text).toBe('fox jumps over')
  })

  test('is a no-op for same-group moves or invalid indices', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    expect(moveWord(groups, 0, 0, 0)).toBe(groups)
    expect(moveWord(groups, 0, 99, 1)).toBe(groups)
    expect(moveWord(groups, 99, 0, 0)).toBe(groups)
  })
})

// ── reorderGroup ─────────────────────────────────────────────────

describe('reorderGroup', () => {
  const groups = buildStudioGroups([makeSegment('a'), makeSegment('b', 10), makeSegment('c', 20)], 6)
  const ids = (gs: Segment[]) => gs.map(g => g.id)

  test('moves a group before the target index', () => {
    expect(ids(reorderGroup(groups, 2, 0))).toEqual(['c:0', 'a:0', 'b:0'])
    expect(ids(reorderGroup(groups, 0, 2))).toEqual(['b:0', 'a:0', 'c:0'])
  })

  test('toIndex === length appends at the end', () => {
    expect(ids(reorderGroup(groups, 0, 3))).toEqual(['b:0', 'c:0', 'a:0'])
  })

  test('no-op moves return the original array', () => {
    expect(reorderGroup(groups, 1, 1)).toBe(groups)
    expect(reorderGroup(groups, 1, 2)).toBe(groups) // immediately after itself
    expect(reorderGroup(groups, -1, 0)).toBe(groups)
    expect(reorderGroup(groups, 0, 99)).toBe(groups)
  })
})
