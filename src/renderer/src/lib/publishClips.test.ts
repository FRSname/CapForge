/**
 * `lib/publishClips.ts` — the Shorts card's clip edits. Nothing here validates
 * (start < end and inside the duration are Python's hard rules, the 60 s
 * length is its style rule); these only edit, and refuse an edit that would
 * produce a clip that ends before it starts.
 */

import { describe, expect, test } from 'vitest'
import type { Word } from '../types/app'
import type { ClipSuggestion } from './publishMediaTypes'
import {
  DEFAULT_CLIP_S,
  addClipAt,
  clipRowField,
  formatClipLength,
  removeClip,
  setClipEndAt,
  setClipStartAt,
  setClipWhy,
  sortClips,
} from './publishClips'

function word(start: number): Word {
  return { word: 'w', start, end: start + 0.3 } as Word
}

const words = [word(0), word(4.2), word(10.5), word(95)]

function clip(start_s: number, end_s: number, why = ''): ClipSuggestion {
  return { start_s, end_s, why }
}

describe('addClipAt', () => {
  test('starts on the word before the playhead and runs the default length', () => {
    expect(addClipAt([], 11, words, 600)).toEqual([clip(10.5, 10.5 + DEFAULT_CLIP_S)])
  })

  test('clamps the end to the duration', () => {
    expect(addClipAt([], 96, words, 100)).toEqual([clip(95, 100)])
  })

  test('with no known duration, the end is not clamped', () => {
    expect(addClipAt([], 96, words, null)).toEqual([clip(95, 95 + DEFAULT_CLIP_S)])
  })

  test('refuses (null) when the playhead is at the very end', () => {
    expect(addClipAt([], 100, [], 100)).toBeNull()
  })

  test('keeps the list sorted by start and leaves the input alone', () => {
    const before = [clip(50, 70)]
    const after = addClipAt(before, 5, words, 600)
    expect(after?.map((c) => c.start_s)).toEqual([4.2, 50])
    expect(before).toEqual([clip(50, 70)])
  })
})

describe('setClipStartAt / setClipEndAt', () => {
  test('moves the start to the snapped playhead and re-sorts', () => {
    const clips = [clip(20, 60), clip(30, 40)]
    expect(setClipStartAt(clips, 1, 11, words)).toEqual([clip(10.5, 40), clip(20, 60)])
  })

  test('refuses a start at or after the end', () => {
    expect(setClipStartAt([clip(0, 5)], 0, 5, [])).toBeNull()
    expect(setClipStartAt([clip(0, 5)], 0, 6, [])).toBeNull()
  })

  test('moves the end to the playhead, clamped to the duration, never snapped', () => {
    expect(setClipEndAt([clip(10, 20)], 0, 33.3, 600)).toEqual([clip(10, 33.3)])
    expect(setClipEndAt([clip(10, 20)], 0, 900, 600)).toEqual([clip(10, 600)])
  })

  test('refuses an end at or before the start', () => {
    expect(setClipEndAt([clip(10, 20)], 0, 10, 600)).toBeNull()
    expect(setClipEndAt([clip(10, 20)], 0, 3, null)).toBeNull()
  })

  test('an index past the list is refused rather than inventing a row', () => {
    expect(setClipStartAt([clip(0, 5)], 3, 1, [])).toBeNull()
    expect(setClipEndAt([clip(0, 5)], 3, 1, null)).toBeNull()
  })
})

describe('the rest', () => {
  test('removeClip and setClipWhy edit one row immutably', () => {
    const clips = [clip(0, 5, 'a'), clip(10, 15, 'b')]
    expect(removeClip(clips, 0)).toEqual([clip(10, 15, 'b')])
    const why = setClipWhy(clips, 1, 'Because')
    expect(why[1].why).toBe('Because')
    expect(why[0]).toBe(clips[0])
    expect(clips[1].why).toBe('b')
  })

  test('sortClips orders by start without mutating', () => {
    const clips = [clip(9, 10), clip(1, 2)]
    expect(sortClips(clips).map((c) => c.start_s)).toEqual([1, 9])
    expect(clips[0].start_s).toBe(9)
  })

  test('formatClipLength reads to a tenth of a second', () => {
    expect(formatClipLength(clip(10, 40))).toBe('30.0 s')
    expect(formatClipLength(clip(1.25, 62.5))).toBe('61.3 s')
    expect(formatClipLength(clip(5, 2))).toBe('0.0 s')
  })

  test('clipRowField names a row the way the backend files its findings', () => {
    expect(clipRowField(2)).toBe('shorts.clip_suggestions[2]')
  })
})
