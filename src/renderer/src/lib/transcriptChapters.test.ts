import { describe, expect, test } from 'vitest'
import type { Segment } from '../types/app'
import type { Chapter } from './publishTypes'
import { activeSegmentIndex, placeChapters } from './transcriptChapters'

function seg(id: string, start: number, end: number): Segment {
  return { id, start, end, text: id, words: [] }
}

function chapter(start_s: number, title = `at ${start_s}`): Chapter {
  return { start_s, title }
}

/** 0–5, 5–10, gap, 12–20. */
const SEGMENTS: Segment[] = [seg('a', 0, 5), seg('b', 5, 10), seg('c', 12, 20)]

describe('placeChapters', () => {
  test('no chapters places nothing', () => {
    const placed = placeChapters(SEGMENTS, [])
    expect(placed.bySegment.size).toBe(0)
    expect(placed.trailing).toEqual([])
  })

  test('a chapter before the first segment sits above the first segment', () => {
    const segments = [seg('a', 3, 5)]
    const placed = placeChapters(segments, [chapter(0)])
    expect(placed.bySegment.get(0)).toEqual([chapter(0)])
  })

  test('a chapter inside a segment sits above that segment', () => {
    const placed = placeChapters(SEGMENTS, [chapter(7)])
    expect(placed.bySegment.get(1)).toEqual([chapter(7)])
    expect(placed.bySegment.has(0)).toBe(false)
  })

  test('a chapter exactly at a boundary belongs to the segment that starts there', () => {
    const placed = placeChapters(SEGMENTS, [chapter(5)])
    expect(placed.bySegment.get(1)).toEqual([chapter(5)])
    expect(placed.bySegment.has(0)).toBe(false)
  })

  test('a chapter in a silent gap sits above the next segment', () => {
    const placed = placeChapters(SEGMENTS, [chapter(11)])
    expect(placed.bySegment.get(2)).toEqual([chapter(11)])
  })

  test('chapters past the last segment are listed at the end', () => {
    const placed = placeChapters(SEGMENTS, [chapter(20), chapter(90)])
    expect(placed.bySegment.size).toBe(0)
    expect(placed.trailing).toEqual([chapter(20), chapter(90)])
  })

  test('unsorted input is placed in time order, several above one segment', () => {
    const placed = placeChapters(SEGMENTS, [chapter(14), chapter(30), chapter(0), chapter(12)])
    expect(placed.bySegment.get(0)).toEqual([chapter(0)])
    expect(placed.bySegment.get(2)).toEqual([chapter(12), chapter(14)])
    expect(placed.trailing).toEqual([chapter(30)])
  })

  test('an empty transcript sends every chapter to the end', () => {
    const placed = placeChapters([], [chapter(3), chapter(1)])
    expect(placed.trailing).toEqual([chapter(1), chapter(3)])
  })

  test('the input lists are not mutated', () => {
    const chapters = [chapter(9), chapter(1)]
    placeChapters(SEGMENTS, chapters)
    expect(chapters).toEqual([chapter(9), chapter(1)])
  })
})

describe('activeSegmentIndex', () => {
  test('an empty transcript has no active row', () => {
    expect(activeSegmentIndex([], 3)).toBe(-1)
  })

  test('finds the segment containing the playhead', () => {
    expect(activeSegmentIndex(SEGMENTS, 0)).toBe(0)
    expect(activeSegmentIndex(SEGMENTS, 4.99)).toBe(0)
    expect(activeSegmentIndex(SEGMENTS, 15)).toBe(2)
  })

  test('a boundary belongs to the segment starting there (end is exclusive)', () => {
    expect(activeSegmentIndex(SEGMENTS, 5)).toBe(1)
  })

  test('before the first, inside a gap, or after the last: no active row', () => {
    expect(activeSegmentIndex([seg('a', 2, 4)], 1)).toBe(-1)
    expect(activeSegmentIndex(SEGMENTS, 11)).toBe(-1)
    expect(activeSegmentIndex(SEGMENTS, 20)).toBe(-1)
    expect(activeSegmentIndex(SEGMENTS, Number.NaN)).toBe(-1)
  })

  test('matches a linear scan across a long transcript', () => {
    const long = Array.from({ length: 1000 }, (_, i) => seg(`s${i}`, i * 2, i * 2 + 1.5))
    for (const t of [0, 1.49, 1.5, 1.9, 777.2, 1998.4, 1999.6, 2500]) {
      const linear = long.findIndex((s) => t >= s.start && t < s.end)
      expect(activeSegmentIndex(long, t)).toBe(linear)
    }
  })
})
