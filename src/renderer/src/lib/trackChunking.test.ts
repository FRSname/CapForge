import { describe, expect, test } from 'vitest'
import {
  chunkTranslatedGroups,
  coalesceSiblingRuns,
  siblingRuns,
  sourceWidKey,
} from './trackChunking'
import type { Segment, Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────
// A translated group is words + the source record they were written from; the
// wid list is the only thing that says "these two rows are one caption".

const w = (text: string, start: number, end: number): Word => ({
  word: text,
  start,
  end,
  wid: `t-${text}`,
  timingDerived: true,
})

/** Six 0.5 s words, `one`…`six`. */
const SIX = ['one', 'two', 'three', 'four', 'five', 'six'].map((t, i) =>
  w(t, i * 0.5, i * 0.5 + 0.5)
)

/** One translated caption: `words`, written from the source wids `wids`. */
function unit(id: string, words: Word[], wids: string[], patch: Partial<Segment> = {}): Segment {
  return {
    id,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((x) => x.word).join(' '),
    words,
    sourceWords: wids.map((wid) => ({ wid, text: wid })),
    ...patch,
  }
}

/** A plain source-track group — no record, so it is never a sibling of anything. */
function plain(id: string, words: Word[]): Segment {
  return {
    id,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((x) => x.word).join(' '),
    words,
  }
}

const SRC_A = ['s0', 's1', 's2']
const SRC_B = ['s3', 's4', 's5']

// ── sourceWidKey / siblingRuns ───────────────────────────────────

describe('siblingRuns', () => {
  test('groups with no record are singleton runs', () => {
    const groups = [plain('a', SIX.slice(0, 3)), plain('b', SIX.slice(3))]
    expect(sourceWidKey(groups[0])).toBeNull()
    expect(siblingRuns(groups)).toEqual([
      { start: 0, length: 1 },
      { start: 1, length: 1 },
    ])
  })

  test('consecutive groups with the same wid list form one run', () => {
    const groups = [
      unit('t1:0:0', SIX.slice(0, 3), SRC_A),
      unit('t1:0:1', SIX.slice(3), SRC_A),
      unit('t1:1', SIX.slice(0, 2), SRC_B),
    ]
    expect(siblingRuns(groups)).toEqual([
      { start: 0, length: 2 },
      { start: 2, length: 1 },
    ])
  })

  test('a matching wid list that is not adjacent is not a run', () => {
    const groups = [
      unit('a', SIX.slice(0, 2), SRC_A),
      unit('b', SIX.slice(2, 4), SRC_B),
      unit('c', SIX.slice(4), SRC_A),
    ]
    expect(siblingRuns(groups)).toEqual([
      { start: 0, length: 1 },
      { start: 1, length: 1 },
      { start: 2, length: 1 },
    ])
  })
})

// ── coalesceSiblingRuns ──────────────────────────────────────────

describe('coalesceSiblingRuns', () => {
  test('returns the same array when nothing is chunked', () => {
    const groups = [unit('t1:0', SIX.slice(0, 3), SRC_A), unit('t1:1', SIX.slice(3), SRC_B)]
    expect(coalesceSiblingRuns(groups)).toBe(groups)
  })

  test('folds a run back into one caption, span and text from the words', () => {
    const groups = [unit('t1:0:0', SIX.slice(0, 3), SRC_A), unit('t1:0:1', SIX.slice(3), SRC_A)]

    const units = coalesceSiblingRuns(groups)

    expect(units).toHaveLength(1)
    expect(units[0].text).toBe('one two three four five six')
    expect(units[0].words).toEqual(SIX)
    expect(units[0].start).toBe(0)
    expect(units[0].end).toBe(3)
    expect(units[0].sourceWords?.map((s) => s.wid)).toEqual(SRC_A)
  })

  test('strips the chunk suffix so re-chunking cannot grow ids without bound', () => {
    const groups = [
      unit('t1:r2:4:0', SIX.slice(0, 3), SRC_A),
      unit('t1:r2:4:1', SIX.slice(3), SRC_A),
    ]
    expect(coalesceSiblingRuns(groups)[0].id).toBe('t1:r2:4')
  })

  test('never merges across two different wid lists', () => {
    const groups = [
      unit('t1:0:0', SIX.slice(0, 2), SRC_A),
      unit('t1:0:1', SIX.slice(2, 3), SRC_A),
      unit('t1:1:0', SIX.slice(3, 5), SRC_B),
      unit('t1:1:1', SIX.slice(5), SRC_B),
    ]

    const units = coalesceSiblingRuns(groups)

    expect(units.map((u) => u.id)).toEqual(['t1:0', 't1:1'])
    expect(units[0].text).toBe('one two three')
    expect(units[1].text).toBe('four five six')
  })

  test('groups with no source record pass through untouched', () => {
    const groups = [plain('a', SIX.slice(0, 3)), plain('b', SIX.slice(3))]
    expect(coalesceSiblingRuns(groups)).toBe(groups)
  })

  test('takes position/link from the first sibling and endEdited from any', () => {
    const groups = [
      unit('t1:0:0', SIX.slice(0, 3), SRC_A, {
        positionOverride: { position_y: 0.2 },
        timingLinked: false,
        speaker: 'A',
      }),
      unit('t1:0:1', SIX.slice(3), SRC_A, { endEdited: true }),
    ]

    const [merged] = coalesceSiblingRuns(groups)

    expect(merged.positionOverride).toEqual({ position_y: 0.2 })
    expect(merged.timingLinked).toBe(false)
    expect(merged.speaker).toBe('A')
    expect(merged.endEdited).toBe(true)
  })

  test('does not mutate its input', () => {
    const groups = [unit('t1:0:0', SIX.slice(0, 3), SRC_A), unit('t1:0:1', SIX.slice(3), SRC_A)]
    const before = JSON.stringify(groups)
    coalesceSiblingRuns(groups)
    expect(JSON.stringify(groups)).toBe(before)
  })
})

// ── chunkTranslatedGroups ────────────────────────────────────────

describe('chunkTranslatedGroups', () => {
  test('a caption of at most N words stays whole (same references)', () => {
    const groups = [unit('t1:0', SIX.slice(0, 3), SRC_A), unit('t1:1', SIX.slice(3), SRC_B)]
    expect(chunkTranslatedGroups(groups, 3)).toBe(groups)
    expect(chunkTranslatedGroups(groups, 9)).toBe(groups)
  })

  test('N ≤ 0 is the identity', () => {
    const groups = [unit('t1:0', SIX, SRC_A)]
    expect(chunkTranslatedGroups(groups, 0)).toBe(groups)
    expect(chunkTranslatedGroups(groups, -2)).toBe(groups)
  })

  test('splits a six-word caption into 3 + 3, spans from the words', () => {
    const groups = [unit('t1:0', SIX, SRC_A)]

    const next = chunkTranslatedGroups(groups, 3)

    expect(next).toHaveLength(2)
    expect(next.map((g) => g.id)).toEqual(['t1:0:0', 't1:0:1'])
    expect(next.map((g) => g.text)).toEqual(['one two three', 'four five six'])
    expect(next[0].start).toBe(0)
    expect(next[0].end).toBe(1.5)
    expect(next[1].start).toBe(1.5)
    expect(next[1].end).toBe(3)
  })

  test('the last chunk is short when the length does not divide', () => {
    const next = chunkTranslatedGroups([unit('t1:0', SIX, SRC_A)], 4)
    expect(next.map((g) => g.text)).toEqual(['one two three four', 'five six'])
  })

  test('every chunk carries the whole source record', () => {
    const next = chunkTranslatedGroups([unit('t1:0', SIX, SRC_A)], 3)
    for (const g of next) expect(g.sourceWords?.map((s) => s.wid)).toEqual(SRC_A)
    // Separate arrays, never one shared object (the `splitGroup` convention).
    expect(next[0].sourceWords).not.toBe(next[1].sourceWords)
  })

  test('carries speaker and position, and gives endEdited to the last chunk only', () => {
    const groups = [
      unit('t1:0', SIX, SRC_A, {
        speaker: 'A',
        positionOverride: { position_y: 0.2 },
        endEdited: true,
      }),
    ]

    const next = chunkTranslatedGroups(groups, 3)

    expect(next.every((g) => g.speaker === 'A')).toBe(true)
    expect(next.every((g) => g.positionOverride?.position_y === 0.2)).toBe(true)
    expect(next[0].endEdited).toBeUndefined()
    expect(next[1].endEdited).toBe(true)
  })

  test('never merges across a boundary the source set', () => {
    const groups = [unit('t1:0', SIX.slice(0, 2), SRC_A), unit('t1:1', SIX.slice(2, 4), SRC_B)]
    // N = 4 could hold all four words in one group — it must not.
    const next = chunkTranslatedGroups(groups, 4)
    expect(next).toBe(groups)
  })

  test('re-chunks from an already chunked list without growing the ids', () => {
    const at3 = chunkTranslatedGroups([unit('t1:0', SIX, SRC_A)], 3)

    const at2 = chunkTranslatedGroups(at3, 2)

    expect(at2.map((g) => g.id)).toEqual(['t1:0:0', 't1:0:1', 't1:0:2'])
    expect(at2.map((g) => g.text)).toEqual(['one two', 'three four', 'five six'])
    // …and back to one caption.
    expect(chunkTranslatedGroups(at2, 6).map((g) => g.id)).toEqual(['t1:0'])
  })

  test('groups with no source record pass through untouched', () => {
    const groups = [plain('a', SIX)]
    expect(chunkTranslatedGroups(groups, 2)).toBe(groups)
  })

  test('an untranslated placeholder is left alone', () => {
    const blank: Segment = {
      id: 't1:0',
      start: 0,
      end: 1.5,
      text: '',
      words: [],
      sourceWords: SRC_A.map((wid) => ({ wid, text: wid })),
    }
    expect(chunkTranslatedGroups([blank], 2)).toEqual([blank])
  })

  test('does not mutate its input', () => {
    const groups = [unit('t1:0', SIX, SRC_A)]
    const before = JSON.stringify(groups)
    chunkTranslatedGroups(groups, 2)
    expect(JSON.stringify(groups)).toBe(before)
  })
})
