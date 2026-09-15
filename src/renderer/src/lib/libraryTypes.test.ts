/**
 * The list boundary. The library screen addresses every action by `id` and
 * `sourcePath`, so a row missing one must never reach the UI — but a backend
 * that has not grown a *derived* field yet (`hasProject`) has to degrade, not
 * blank the screen.
 */

import { describe, expect, test } from 'vitest'
import {
  FIRST_REV,
  FOLDER_IMPORT_SHAPE_MESSAGE,
  LIBRARY_LIST_SHAPE_MESSAGE,
  WATCH_STATUS_SHAPE_MESSAGE,
  parseFolderImportResult,
  parseLibraryChangedEvent,
  parseLibraryList,
  parseLibraryRecord,
  parseWatchStatus,
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
  cover: null,
}

const COVER = `${'c'.repeat(32)}.jpg`

describe('parseLibraryList', () => {
  test('reads the cover from the row’s derived cover key', () => {
    const [parsed] = parseLibraryList({ videos: [{ ...ROW, cover: COVER }] })
    expect(parsed.cover).toBe(COVER)
  })

  test('ignores thumbnail.cover: the list summary has no thumbnail, only the derived key', () => {
    const { cover: _omitted, ...row } = ROW
    const [parsed] = parseLibraryList({
      videos: [{ ...row, thumbnail: { ideas: [], candidates: [COVER], cover: COVER } }],
    })
    expect(parsed.cover).toBeNull()
  })

  test.each([
    ['no cover key', undefined],
    ['a null cover', null],
    ['a cover that is not a frame name', '../record.json'],
    ['an upper-case frame name', `${'C'.repeat(32)}.jpg`],
    ['a non-string cover', 7],
  ])('degrades %s to no cover', (_reason, cover) => {
    const [parsed] = parseLibraryList({ videos: [{ ...ROW, cover }] })
    expect(parsed.cover).toBeNull()
  })

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
      cover: null,
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

describe('parseFolderImportResult', () => {
  const RESULT = {
    created: ['a1', 'a2'],
    existing: ['b1'],
    relinked: [],
    failed: [{ path: '/rec/broken.mp4', reason: 'unreadable' }],
    truncated: false,
  }

  test('passes a well-formed result through', () => {
    expect(parseFolderImportResult(RESULT)).toEqual(RESULT)
  })

  test('reads truncated strictly: only true is true', () => {
    expect(parseFolderImportResult({ ...RESULT, truncated: true }).truncated).toBe(true)
    expect(parseFolderImportResult({ ...RESULT, truncated: 'yes' }).truncated).toBe(false)
  })

  test.each([null, 'nope', [], {}, { ...RESULT, created: 'a1' }, { ...RESULT, failed: {} }])(
    'rejects the malformed body %s',
    (body) => {
      expect(() => parseFolderImportResult(body)).toThrow(FOLDER_IMPORT_SHAPE_MESSAGE)
    }
  )

  test('rejects a non-string id and a failure without a path', () => {
    expect(() => parseFolderImportResult({ ...RESULT, existing: [7] })).toThrow(
      FOLDER_IMPORT_SHAPE_MESSAGE
    )
    expect(() => parseFolderImportResult({ ...RESULT, failed: [{ reason: 'x' }] })).toThrow(
      FOLDER_IMPORT_SHAPE_MESSAGE
    )
  })

  test('a failure with no reason keeps its path and an empty reason', () => {
    const parsed = parseFolderImportResult({ ...RESULT, failed: [{ path: '/rec/a.mov' }] })
    expect(parsed.failed).toEqual([{ path: '/rec/a.mov', reason: '' }])
  })
})

describe('parseWatchStatus', () => {
  test('passes a watching status through', () => {
    const body = {
      folder: '/Volumes/Rec',
      available: true,
      lastScanAt: '2026-09-14T10:00:00Z',
      importedCount: 3,
    }
    expect(parseWatchStatus(body)).toEqual(body)
  })

  test('a null folder is "not watching"', () => {
    expect(
      parseWatchStatus({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
    ).toEqual({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
  })

  test('defaults the optional fields instead of failing', () => {
    expect(parseWatchStatus({ folder: '/a', importedCount: -2 })).toEqual({
      folder: '/a',
      available: false,
      lastScanAt: null,
      importedCount: 0,
    })
  })

  test.each([null, 'x', [], {}, { folder: 42 }])('rejects the malformed body %s', (body) => {
    expect(() => parseWatchStatus(body)).toThrow(WATCH_STATUS_SHAPE_MESSAGE)
  })
})

describe('parseLibraryChangedEvent', () => {
  test('keeps the string ids', () => {
    expect(
      parseLibraryChangedEvent({
        type: 'library_changed',
        created: ['a'],
        relinked: ['b'],
        updated: ['c'],
      })
    ).toEqual({ created: ['a'], relinked: ['b'], updated: ['c'] })
  })

  test('`updated` is optional — the watch folder frame has no such key', () => {
    const event = parseLibraryChangedEvent({
      type: 'library_changed',
      created: ['a'],
      relinked: [],
    })
    expect(event).toStrictEqual({ created: ['a'], relinked: [] })
    expect('updated' in event).toBe(false)
  })

  test('never throws on a socket frame — junk degrades to empty lists', () => {
    expect(
      parseLibraryChangedEvent({ created: 'a', relinked: [1, 'b', ''], updated: { id: 'c' } })
    ).toEqual({
      created: [],
      relinked: ['b'],
      updated: [],
    })
    expect(parseLibraryChangedEvent({ updated: [null, 'd', 7] })).toEqual({
      created: [],
      relinked: [],
      updated: ['d'],
    })
    expect(parseLibraryChangedEvent(null)).toStrictEqual({ created: [], relinked: [] })
  })
})
