/**
 * The list boundary. The library screen addresses every action by `id` and
 * `sourcePath`, so a row missing one must never reach the UI — but a backend
 * that has not grown a *derived* field yet (`hasProject`) has to degrade, not
 * blank the screen.
 */

import { describe, expect, test } from 'vitest'
import {
  FIRST_REV,
  LIBRARY_LIST_SHAPE_MESSAGE,
  parseLibraryList,
  parseLibraryRecord,
} from './libraryTypes'

const ROW = {
  id: 'b'.repeat(32),
  title: 'Shipping v3',
  sourcePath: '/media/Talk.mp4',
  duration: 61.5,
  language: 'en',
  status: 'captioned',
  collection_id: null,
  scratch: false,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
  missing_media: false,
  hasProject: true,
  poster: false,
}

describe('parseLibraryList', () => {
  test('passes a well-formed row through unchanged', () => {
    expect(parseLibraryList({ videos: [ROW] })).toEqual([ROW])
  })

  test.each([null, [], {}, { videos: {} }, 'nope'])('rejects the envelope %s', (body) => {
    expect(() => parseLibraryList(body)).toThrow(LIBRARY_LIST_SHAPE_MESSAGE)
  })

  test.each([
    ['no id', { ...ROW, id: '   ' }],
    ['no sourcePath', { ...ROW, sourcePath: 42 }],
    ['unknown status', { ...ROW, status: 'rendered' }],
    ['not an object', 7],
  ])('rejects a row with %s, naming its index', (_reason, row) => {
    expect(() => parseLibraryList({ videos: [ROW, row] })).toThrow(/Library entry 1/)
  })

  test('defaults the optional fields instead of failing', () => {
    const [parsed] = parseLibraryList({
      videos: [{ id: ROW.id, sourcePath: ROW.sourcePath, status: 'imported' }],
    })
    expect(parsed).toEqual({
      id: ROW.id,
      title: '',
      sourcePath: ROW.sourcePath,
      duration: null,
      language: null,
      status: 'imported',
      collection_id: null,
      scratch: false,
      createdAt: '',
      updatedAt: '',
      missing_media: false,
      hasProject: false,
      poster: false,
    })
  })

  test('drops a non-finite duration rather than carrying NaN into the card', () => {
    const [parsed] = parseLibraryList({ videos: [{ ...ROW, duration: 'soon' }] })
    expect(parsed.duration).toBeNull()
  })
})

describe('parseLibraryRecord', () => {
  test('keeps the record revision', () => {
    expect(parseLibraryRecord({ ...ROW, rev: 7 }).rev).toBe(7)
  })

  test('falls back to the first revision when the view has none', () => {
    expect(parseLibraryRecord(ROW).rev).toBe(FIRST_REV)
  })
})
