/**
 * The library's sort. What matters: every key orders both ways, a missing value
 * (an unprobed duration, an unparseable date) sinks to the bottom whichever way
 * the list runs, names compare like a person reads them ("Take 2" before
 * "Take 10"), and the fetched list is never mutated.
 */

import { describe, expect, test } from 'vitest'
import type { LibraryVideo } from './libraryTypes'
import {
  DEFAULT_LIBRARY_SORT,
  LIBRARY_SORT_KEYS,
  defaultSortDirection,
  isLibrarySortKey,
  sortVideos,
  toggledSort,
} from './librarySort'

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a',
    title: '',
    sourcePath: '/media/Talk.mp4',
    duration: 90,
    language: 'en',
    status: 'transcribed',
    collection_id: null,
    scratch: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    missing_media: false,
    hasProject: false,
    poster: false,
    cover: null,
    ...overrides,
  }
}

const ids = (videos: readonly LibraryVideo[]) => videos.map((v) => v.id)

describe('DEFAULT_LIBRARY_SORT', () => {
  test('is modified, newest first — what the grid showed before sorting existed', () => {
    expect(DEFAULT_LIBRARY_SORT).toEqual({ key: 'modified', direction: 'desc' })
  })

  test('every key is recognised, anything else is not', () => {
    expect(LIBRARY_SORT_KEYS).toEqual(['modified', 'name', 'duration', 'status', 'created'])
    for (const key of LIBRARY_SORT_KEYS) expect(isLibrarySortKey(key)).toBe(true)
    for (const key of ['updated', '', null, 3]) expect(isLibrarySortKey(key)).toBe(false)
  })
})

describe('sortVideos', () => {
  test('returns a NEW array and leaves the input alone', () => {
    const input = [video({ id: 'old' }), video({ id: 'new', updatedAt: '2026-09-09T10:00:00Z' })]
    const sorted = sortVideos(input, DEFAULT_LIBRARY_SORT)
    expect(ids(sorted)).toEqual(['new', 'old'])
    expect(ids(input)).toEqual(['old', 'new'])
    expect(sorted).not.toBe(input)
  })

  test('modified falls back to createdAt when updatedAt is empty', () => {
    const a = video({ id: 'a', updatedAt: '', createdAt: '2026-09-02T10:00:00Z' })
    const b = video({ id: 'b', updatedAt: '', createdAt: '2026-09-03T10:00:00Z' })
    expect(ids(sortVideos([a, b], { key: 'modified', direction: 'desc' }))).toEqual(['b', 'a'])
    expect(ids(sortVideos([b, a], { key: 'modified', direction: 'asc' }))).toEqual(['a', 'b'])
  })

  test('name compares the displayed title, numerically and ignoring case', () => {
    const videos = [
      video({ id: '10', title: 'Take 10' }),
      video({ id: '2', title: 'take 2' }),
      video({ id: 'stem', title: '', sourcePath: '/m/Alpha.mp4' }),
    ]
    expect(ids(sortVideos(videos, { key: 'name', direction: 'asc' }))).toEqual(['stem', '2', '10'])
    expect(ids(sortVideos(videos, { key: 'name', direction: 'desc' }))).toEqual(['10', '2', 'stem'])
  })

  test('duration sorts both ways with unprobed durations last in both', () => {
    const videos = [
      video({ id: 'none', duration: null }),
      video({ id: 'long', duration: 600 }),
      video({ id: 'short', duration: 30 }),
    ]
    expect(ids(sortVideos(videos, { key: 'duration', direction: 'asc' }))).toEqual([
      'short',
      'long',
      'none',
    ])
    expect(ids(sortVideos(videos, { key: 'duration', direction: 'desc' }))).toEqual([
      'long',
      'short',
      'none',
    ])
  })

  test('status follows the derived ladder, not the alphabet', () => {
    const videos = [
      video({ id: 'published', status: 'published' }),
      video({ id: 'captioned', status: 'captioned' }),
      video({ id: 'imported', status: 'imported' }),
      video({ id: 'drafted', status: 'drafted' }),
      video({ id: 'transcribed', status: 'transcribed' }),
    ]
    const ladder = ['imported', 'transcribed', 'captioned', 'drafted', 'published']
    expect(ids(sortVideos(videos, { key: 'status', direction: 'asc' }))).toEqual(ladder)
    expect(ids(sortVideos(videos, { key: 'status', direction: 'desc' }))).toEqual(
      [...ladder].reverse()
    )
  })

  test('created sorts both ways with an unparseable date last in both', () => {
    const videos = [
      video({ id: 'bad', createdAt: 'not a date' }),
      video({ id: 'early', createdAt: '2026-01-01T00:00:00Z' }),
      video({ id: 'late', createdAt: '2026-06-01T00:00:00Z' }),
    ]
    expect(ids(sortVideos(videos, { key: 'created', direction: 'asc' }))).toEqual([
      'early',
      'late',
      'bad',
    ])
    expect(ids(sortVideos(videos, { key: 'created', direction: 'desc' }))).toEqual([
      'late',
      'early',
      'bad',
    ])
  })

  test('an unparseable modified date is last in both directions', () => {
    const videos = [
      video({ id: 'bad', updatedAt: 'garbage', createdAt: '' }),
      video({ id: 'ok', updatedAt: '2026-09-01T10:00:00Z' }),
    ]
    expect(ids(sortVideos(videos, { key: 'modified', direction: 'asc' }))).toEqual(['ok', 'bad'])
    expect(ids(sortVideos(videos, { key: 'modified', direction: 'desc' }))).toEqual(['ok', 'bad'])
  })

  test('ties keep the order they arrived in', () => {
    const videos = [video({ id: 'first' }), video({ id: 'second' })]
    expect(ids(sortVideos(videos, { key: 'duration', direction: 'desc' }))).toEqual([
      'first',
      'second',
    ])
  })
})

describe('toggledSort (a column header click)', () => {
  test('the active column reverses', () => {
    expect(toggledSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    })
    expect(toggledSort({ key: 'name', direction: 'desc' }, 'name')).toEqual({
      key: 'name',
      direction: 'asc',
    })
  })

  test('another column starts in its natural direction', () => {
    expect(toggledSort(DEFAULT_LIBRARY_SORT, 'name')).toEqual({ key: 'name', direction: 'asc' })
    expect(toggledSort({ key: 'name', direction: 'asc' }, 'modified')).toEqual({
      key: 'modified',
      direction: 'desc',
    })
  })

  test('dates and lengths start biggest first, names and the ladder from the start', () => {
    expect(defaultSortDirection('modified')).toBe('desc')
    expect(defaultSortDirection('created')).toBe('desc')
    expect(defaultSortDirection('duration')).toBe('desc')
    expect(defaultSortDirection('name')).toBe('asc')
    expect(defaultSortDirection('status')).toBe('asc')
  })
})
