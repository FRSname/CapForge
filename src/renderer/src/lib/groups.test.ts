import { describe, expect, test } from 'vitest'
import {
  buildStudioGroups,
  fillGroupGaps,
  mergeGroups,
  splitGroup,
  moveWord,
  reorderGroup,
  restoreManualGroupState,
  reconcileGroups,
} from './groups'
import { ensureWordIds } from './wordIds'
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
    text: words.map((w) => w.word).join(' '),
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
      const flat = groups.flatMap((g) => g.words.map((w) => w.word))
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
    expect(groups[0].words.map((w) => w.word)).toEqual(['hello', 'world'])
  })

  test('carries the segment speaker onto every derived group', () => {
    const groups = buildStudioGroups([makeSegment('s1', 0, 'SPEAKER_00')], 2)
    expect(groups.every((g) => g.speaker === 'SPEAKER_00')).toBe(true)
  })

  test('assigns stable ids per segment + word offset', () => {
    const groups = buildStudioGroups([makeSegment('a'), makeSegment('b', 10)], 3)
    expect(groups.map((g) => g.id)).toEqual(['a:0', 'a:3', 'b:0', 'b:3'])
  })
})

// ── fillGroupGaps ──────────────────────────────────────────────────

describe('fillGroupGaps', () => {
  test("stretches a group's end to the next group's start when there is a gap", () => {
    const groups: Segment[] = [
      { id: 'a', start: 0, end: 1, text: 'a', words: [word('a', 0, 1)] },
      { id: 'b', start: 3, end: 4, text: 'b', words: [word('b', 3, 4)] },
    ]
    const filled = fillGroupGaps(groups)
    expect(filled[0].end).toBe(3)
    expect(filled[1].end).toBe(4)
    expect(filled[0].start).toBe(0)
    expect(filled[1].start).toBe(3)
  })

  test('leaves abutting groups (no gap) untouched', () => {
    const groups: Segment[] = [
      { id: 'a', start: 0, end: 1, text: 'a', words: [word('a', 0, 1)] },
      { id: 'b', start: 1, end: 2, text: 'b', words: [word('b', 1, 2)] },
    ]
    const filled = fillGroupGaps(groups)
    expect(filled[0].end).toBe(1)
    expect(filled[1].end).toBe(2)
  })

  test('never shrinks an end for overlapping/out-of-order groups', () => {
    const groups: Segment[] = [
      { id: 'a', start: 0, end: 5, text: 'a', words: [word('a', 0, 5)] },
      { id: 'b', start: 3, end: 6, text: 'b', words: [word('b', 3, 6)] },
    ]
    const filled = fillGroupGaps(groups)
    expect(filled[0].end).toBe(5)
    expect(filled[1].end).toBe(6)
  })

  test('leaves the last group unchanged', () => {
    const groups = buildStudioGroups([makeSegment('s1')], 3)
    const filled = fillGroupGaps(groups)
    expect(filled[filled.length - 1]).toEqual(groups[groups.length - 1])
  })

  test('does not mutate the input array or its group objects', () => {
    const groups: Segment[] = [
      { id: 'a', start: 0, end: 1, text: 'a', words: [word('a', 0, 1)] },
      { id: 'b', start: 3, end: 4, text: 'b', words: [word('b', 3, 4)] },
    ]
    const before = JSON.parse(JSON.stringify(groups))
    fillGroupGaps(groups)
    expect(groups).toEqual(before)
  })

  test('returns an empty array for an empty input', () => {
    expect(fillGroupGaps([])).toEqual([])
  })
})

// ── closeGroupGaps ─────────────────────────────────────────────────
//
// Lives in its own file, `groups.gaps.test.ts` — it carries the parity table
// shared with `backend/tests/test_group_gap_closing.py`.

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

  test('drops endEdited because the merged bounds come from its words', () => {
    // Arrange — both halves claim a hand-placed end.
    const groups = buildStudioGroups([makeSegment('s1')], 3).map((g) => ({
      ...g,
      endEdited: true,
    }))

    // Act
    const merged = mergeGroups(groups, 0)

    // Assert
    expect(merged[0].endEdited).toBeUndefined()
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

  test('drops endEdited on both halves because their bounds come from words', () => {
    // Arrange
    const groups = buildStudioGroups([makeSegment('s1')], 6).map((g) => ({
      ...g,
      endEdited: true,
    }))

    // Act
    const split = splitGroup(groups, 0, 3)

    // Assert
    expect(split[0].endEdited).toBeUndefined()
    expect(split[1].endEdited).toBeUndefined()
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

  test('clears endEdited on both groups whose bounds were recomputed', () => {
    // Arrange — moveWord spreads the old group objects, so the flag would
    // otherwise survive a membership change (finalizeBounds must clear it).
    const groups = buildStudioGroups([makeSegment('s1')], 3).map((g) => ({
      ...g,
      endEdited: true,
    }))

    // Act — move "brown" from the first group into the second.
    const next = moveWord(groups, 0, 2, 1)

    // Assert
    expect(next[0].endEdited).toBeUndefined()
    expect(next[1].endEdited).toBeUndefined()
  })

  test('clears endEdited on the surviving group when the source empties out', () => {
    // Arrange — [the quick brown][fox][jumps over], every group hand-ended.
    const groups = splitGroup(buildStudioGroups([makeSegment('s1')], 3), 1, 1).map((g) => ({
      ...g,
      endEdited: true,
    }))

    // Act — the lone word in group 1 moves out, so group 1 disappears.
    const next = moveWord(groups, 1, 0, 2)

    // Assert
    expect(next).toHaveLength(2)
    expect(next[1].endEdited).toBeUndefined()
  })
})

// ── reorderGroup ─────────────────────────────────────────────────

describe('reorderGroup', () => {
  const groups = buildStudioGroups(
    [makeSegment('a'), makeSegment('b', 10), makeSegment('c', 20)],
    6
  )
  const ids = (gs: Segment[]) => gs.map((g) => g.id)

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

// ── restoreManualGroupState ──────────────────────────────────────
//
// Regression cover for the desync a user hit after merging two words: the
// rebuild restored a group's manually-dragged bounds even though re-chunking
// had changed which words the group holds.

describe('restoreManualGroupState', () => {
  /** One segment of six 0.5 s words at 1 s spacing, chunked three per group. */
  const sixWords = (): Segment => ({
    id: 's0',
    start: 0,
    end: 5.5,
    text: 'a b c d e f',
    words: ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => word(x, i, i + 0.5)),
  })

  test('restores manual bounds when the chunk words are unchanged', () => {
    const rebuilt = buildStudioGroups([sixWords()], 3)
    const previous = rebuilt.map((g, i) => (i === 0 ? { ...g, end: 2.9 } : g))

    const result = restoreManualGroupState(rebuilt, previous)
    expect(result[0].end).toBe(2.9)
  })

  test('drops stale bounds when a word merge re-chunked the group', () => {
    const seg = sixWords()
    const previous = buildStudioGroups([seg], 3).map((g, i) => (i === 0 ? { ...g, end: 2.9 } : g))

    // Merge "b"+"c" into "bc": group s0:0 becomes [a, bc, d] — different words,
    // so the 2.9 bound no longer describes it and must not be restored.
    const merged: Segment = {
      ...seg,
      text: 'a bc d e f',
      words: [word('a', 0, 0.5), word('bc', 1, 2.5), ...seg.words.slice(3)],
    }
    const result = restoreManualGroupState(buildStudioGroups([merged], 3), previous)

    expect(result[0].words.map((w) => w.word)).toEqual(['a', 'bc', 'd'])
    // The bound the user actually saw break: the group ended before its own
    // last word started.
    expect(result[0].end).toBeGreaterThanOrEqual(result[0].words[2].start)
    expect(result[0].end).toBe(3.5)
  })

  test('every group ends at or after its own last word starts', () => {
    const seg = sixWords()
    const previous = buildStudioGroups([seg], 3).map((g) => ({ ...g, start: g.start, end: g.end }))
    const merged: Segment = {
      ...seg,
      text: 'a bc d e f',
      words: [word('a', 0, 0.5), word('bc', 1, 2.5), ...seg.words.slice(3)],
    }
    const result = restoreManualGroupState(buildStudioGroups([merged], 3), previous)

    for (const g of result) {
      expect(g.start).toBeLessThanOrEqual(g.words[0].start)
      expect(g.end).toBeGreaterThanOrEqual(g.words[g.words.length - 1].start)
    }
  })

  test('keeps a position override even when the chunk changed', () => {
    const seg = sixWords()
    const previous = buildStudioGroups([seg], 3).map((g, i) =>
      i === 0 ? { ...g, positionOverride: { position_x: 0.25 } } : g
    )
    const merged: Segment = {
      ...seg,
      text: 'a bc d e f',
      words: [word('a', 0, 0.5), word('bc', 1, 2.5), ...seg.words.slice(3)],
    }
    const result = restoreManualGroupState(buildStudioGroups([merged], 3), previous)
    expect(result[0].positionOverride).toEqual({ position_x: 0.25 })
  })

  test('restores per-word overrides only for unchanged chunks', () => {
    const seg = sixWords()
    const previous = buildStudioGroups([seg], 3).map((g, i) =>
      i === 0
        ? { ...g, words: g.words.map((w, j) => (j === 0 ? { ...w, overrides: { bold: true } } : w)) }
        : g
    )
    const merged: Segment = {
      ...seg,
      text: 'a bc d e f',
      words: [word('a', 0, 0.5), word('bc', 1, 2.5), ...seg.words.slice(3)],
    }
    const changed = restoreManualGroupState(buildStudioGroups([merged], 3), previous)
    expect(changed[0].words[0].overrides).toBeUndefined()

    const unchanged = restoreManualGroupState(buildStudioGroups([seg], 3), previous)
    expect(unchanged[0].words[0].overrides).toEqual({ bold: true })
  })

  test('leaves groups alone when there is nothing saved', () => {
    const rebuilt = buildStudioGroups([sixWords()], 3)
    expect(restoreManualGroupState(rebuilt, [])).toEqual(rebuilt)
  })

  test('carries endEdited only when the chunk words are byte-identical', () => {
    // Arrange — a saved group with a hand-placed end.
    const seg = sixWords()
    const previous = buildStudioGroups([seg], 3).map((g, i) =>
      i === 0 ? { ...g, end: 2.9, endEdited: true } : g
    )
    // The same segment re-chunked after merging "b"+"c" — group s0:0 now holds
    // different words, so the timing claim no longer describes it.
    const merged: Segment = {
      ...seg,
      text: 'a bc d e f',
      words: [word('a', 0, 0.5), word('bc', 1, 2.5), ...seg.words.slice(3)],
    }

    // Act
    const unchanged = restoreManualGroupState(buildStudioGroups([seg], 3), previous)
    const changed = restoreManualGroupState(buildStudioGroups([merged], 3), previous)

    // Assert
    expect(unchanged[0].endEdited).toBe(true)
    expect(unchanged[0].end).toBe(2.9)
    expect(changed[0].endEdited).toBeUndefined()
  })
})

// ── reconcileGroups ──────────────────────────────────────────────
//
// The contract these pin: manual group membership is the user's decision and
// must survive an edit to the source segments. Matching by array position
// silently restores document order — that was the bug
// (docs/plans/fill-gaps-resets-custom-groups.md).

/** A segment whose words all carry stable ids. */
const idSegment = (id = 's1', base = 0): Segment => ensureWordIds([makeSegment(id, base)])[0]

/** Rewrite one word's text in place, keeping its id and timing. */
const editText = (seg: Segment, index: number, text: string): Segment => {
  const words = seg.words.map((w, i) => (i === index ? { ...w, word: text } : w))
  return { ...seg, words, text: words.map((w) => w.word).join(' ') }
}

/** Drop one word from a segment. */
const deleteWord = (seg: Segment, index: number): Segment => {
  const words = seg.words.filter((_, i) => i !== index)
  return { ...seg, words, text: words.map((w) => w.word).join(' ') }
}

/** Insert a new (id-less, so freshly minted) word after `index`. */
const insertAfter = (seg: Segment, index: number, text: string): Segment => {
  const at = seg.words[index]
  const fresh = word(text, at.end, at.end + 0.25)
  const words = [...seg.words.slice(0, index + 1), fresh, ...seg.words.slice(index + 1)]
  return ensureWordIds([{ ...seg, words, text: words.map((w) => w.word).join(' ') }])[0]
}

const membership = (groups: Segment[]): string[][] => groups.map((g) => g.words.map((w) => w.word))

describe('reconcileGroups', () => {
  test('a word moved to a non-adjacent group stays there across a text edit', () => {
    const seg = idSegment()
    // 3 groups of 2: [the quick] [brown fox] [jumps over]
    const moved = moveWord(buildStudioGroups([seg], 2), 0, 0, 2)
    expect(membership(moved)).toEqual([['quick'], ['brown', 'fox'], ['the', 'jumps', 'over']])

    const after = reconcileGroups(moved, [editText(seg, 5, 'Over,')], 2)
    expect(membership(after)).toEqual([['quick'], ['brown', 'fox'], ['the', 'jumps', 'Over,']])
  })

  test('reordered groups stay reordered across a text edit', () => {
    const seg = idSegment()
    const reordered = reorderGroup(buildStudioGroups([seg], 2), 2, 0)
    expect(membership(reordered)).toEqual([['jumps', 'over'], ['the', 'quick'], ['brown', 'fox']])

    const after = reconcileGroups(reordered, [editText(seg, 0, 'The')], 2)
    expect(membership(after)).toEqual([['jumps', 'over'], ['The', 'quick'], ['brown', 'fox']])
  })

  test('merged groups survive a word being inserted', () => {
    const seg = idSegment()
    const merged = mergeGroups(buildStudioGroups([seg], 2), 0)
    expect(membership(merged)).toEqual([['the', 'quick', 'brown', 'fox'], ['jumps', 'over']])

    const after = reconcileGroups(merged, [insertAfter(seg, 1, 'very')], 2)
    expect(membership(after)).toEqual([['the', 'quick', 'very', 'brown', 'fox'], ['jumps', 'over']])
  })

  test('merged groups survive a word being deleted', () => {
    const seg = idSegment()
    const merged = mergeGroups(buildStudioGroups([seg], 2), 0)

    const after = reconcileGroups(merged, [deleteWord(seg, 2)], 2)
    expect(membership(after)).toEqual([['the', 'quick', 'fox'], ['jumps', 'over']])
  })

  test('a deleted word leaves every other group untouched', () => {
    const seg = idSegment()
    const groups = buildStudioGroups([seg], 2)

    const after = reconcileGroups(groups, [deleteWord(seg, 3)], 2)
    expect(membership(after)).toEqual([['the', 'quick'], ['brown'], ['jumps', 'over']])
  })

  test('an inserted word lands in its predecessor group, not at a chunk boundary', () => {
    const seg = idSegment()
    const groups = buildStudioGroups([seg], 2)

    const after = reconcileGroups(groups, [insertAfter(seg, 3, 'quickly')], 2)
    expect(membership(after)).toEqual([
      ['the', 'quick'],
      ['brown', 'fox', 'quickly'],
      ['jumps', 'over'],
    ])
  })

  test('a group whose words are unchanged keeps a stretched end (the Fill gaps case)', () => {
    const seg = idSegment()
    const filled = fillGroupGaps(buildStudioGroups([seg], 2))
    const stretched = { ...filled[0], end: 99 }
    const previous = [stretched, ...filled.slice(1)]

    // Edit a word in a *different* group — group 0's word set is untouched.
    const after = reconcileGroups(previous, [editText(seg, 5, 'Over,')], 2)
    expect(after[0].end).toBe(99)
    expect(after[0].start).toBe(filled[0].start)
  })

  test('a group whose word set changed gets bounds recomputed', () => {
    const seg = idSegment()
    const previous = buildStudioGroups([seg], 2).map((g, i) => (i === 1 ? { ...g, end: 99 } : g))

    const after = reconcileGroups(previous, [deleteWord(seg, 3)], 2)
    expect(after[1].words.map((w) => w.word)).toEqual(['brown'])
    expect(after[1].end).toBe(seg.words[2].end)
  })

  test('keeps endEdited when the word set is unchanged', () => {
    // Arrange — group 0 has a hand-placed end; the edit lands in group 2.
    const seg = idSegment()
    const previous = buildStudioGroups([seg], 2).map((g, i) =>
      i === 0 ? { ...g, end: 9, endEdited: true } : g
    )

    // Act
    const after = reconcileGroups(previous, [editText(seg, 5, 'Over,')], 2)

    // Assert
    expect(after[0].endEdited).toBe(true)
    expect(after[0].end).toBe(9)
  })

  test('clears endEdited when the word set changed', () => {
    // Arrange — group 1 has a hand-placed end and is about to lose a word.
    const seg = idSegment()
    const previous = buildStudioGroups([seg], 2).map((g, i) =>
      i === 1 ? { ...g, end: 99, endEdited: true } : g
    )

    // Act — delete "fox", so group 1 becomes ["brown"] and bounds recompute.
    const after = reconcileGroups(previous, [deleteWord(seg, 3)], 2)

    // Assert
    expect(after[1].words.map((w) => w.word)).toEqual(['brown'])
    expect(after[1].endEdited).toBeUndefined()
  })

  test('per-word overrides and per-group position overrides survive', () => {
    const seg = idSegment()
    const previous = buildStudioGroups([seg], 2).map((g, i) =>
      i === 1
        ? {
            ...g,
            positionOverride: { position_x: 0.25 },
            words: g.words.map((w, j) => (j === 0 ? { ...w, overrides: { bold: true } } : w)),
          }
        : g
    )

    const after = reconcileGroups(previous, [editText(seg, 0, 'The')], 2)
    expect(after[1].positionOverride).toEqual({ position_x: 0.25 })
    expect(after[1].words[0].overrides).toEqual({ bold: true })
  })

  test('a group emptied by deletions is dropped', () => {
    const seg = idSegment()
    const groups = buildStudioGroups([seg], 2)

    const edited = deleteWord(deleteWord(seg, 2), 2) // removes 'brown' and 'fox'
    const after = reconcileGroups(groups, [edited], 2)
    expect(membership(after)).toEqual([['the', 'quick'], ['jumps', 'over']])
  })

  test('words from a newly added segment start their own group', () => {
    const first = idSegment('s1')
    const groups = buildStudioGroups([first], 2)
    const second = idSegment('s2', 10)

    const after = reconcileGroups(groups, [first, second], 2)
    expect(membership(after).slice(0, 3)).toEqual([
      ['the', 'quick'],
      ['brown', 'fox'],
      ['jumps', 'over'],
    ])
    // The new segment's words never get absorbed into the last existing group.
    expect(after[2].words).toHaveLength(2)
    expect(after.slice(3).flatMap((g) => g.words.map((w) => w.word))).toEqual([
      'the',
      'quick',
      'brown',
      'fox',
      'jumps',
      'over',
    ])
  })

  test('falls back to a document-order rebuild when word ids are missing', () => {
    const plain = makeSegment('s1')
    const merged = mergeGroups(buildStudioGroups([plain], 2), 0)
    const idd = ensureWordIds([plain])

    const after = reconcileGroups(merged, idd, 2)
    expect(membership(after)).toEqual(membership(buildStudioGroups(idd, 2)))
  })

  test('an empty previous list rebuilds from the segments', () => {
    const seg = idSegment()
    expect(membership(reconcileGroups([], [seg], 3))).toEqual([
      ['the', 'quick', 'brown'],
      ['fox', 'jumps', 'over'],
    ])
  })

  test('regression: move a word, Fill gaps, then edit text — nothing snaps back', () => {
    const seg = idSegment()
    const moved = moveWord(buildStudioGroups([seg], 2), 0, 0, 2)
    const baked = fillGroupGaps(moved)
    const bakedEnds = baked.map((g) => g.end)

    const after = reconcileGroups(baked, [editText(seg, 3, 'Fox')], 2)
    expect(membership(after)).toEqual([['quick'], ['brown', 'Fox'], ['the', 'jumps', 'over']])
    expect(after.map((g) => g.end)).toEqual(bakedEnds)
  })
})
