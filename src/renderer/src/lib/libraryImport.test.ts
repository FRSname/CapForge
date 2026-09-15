/**
 * The folder-import copy and decisions — pure, so every branch is pinned here
 * rather than behind a DOM the vitest node environment does not have.
 *
 * What matters: the summary never lies about what happened (nothing imported
 * is not "Imported 0 videos"), a truncated scan says so, the relink refusal is
 * read wherever FastAPI put it, and a drop does exactly one legible thing.
 */

import { describe, expect, test } from 'vitest'
import type { FolderImportResult, WatchStatus } from './libraryTypes'
import {
  IMPORT_PATHS_MAX,
  WATCH_FOLDER_UNAVAILABLE,
  NOT_WATCHING,
  droppedImport,
  droppedItemsOf,
  folderImportSummary,
  folderImportTone,
  importPathsBatch,
  pathBaseName,
  relinkRefusal,
  relinkRefusalMessage,
  watchFolderView,
  type DroppedItem,
} from './libraryImport'

function result(overrides: Partial<FolderImportResult> = {}): FolderImportResult {
  return { created: [], existing: [], relinked: [], failed: [], truncated: false, ...overrides }
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id${i}`)

describe('pathBaseName', () => {
  test.each([
    ['/Volumes/Rec/Session 1', 'Session 1'],
    ['/Volumes/Rec/Session 1/', 'Session 1'],
    ['C:\\Users\\x\\Takes.v2', 'Takes.v2'],
    ['/', '/'],
    ['', ''],
  ])('%s → %s', (path, expected) => {
    expect(pathBaseName(path)).toBe(expected)
  })
})

describe('folderImportSummary', () => {
  test('names every non-empty bucket, in order', () => {
    const summary = folderImportSummary(
      result({
        created: ids(12),
        existing: ids(3),
        relinked: ids(1),
        failed: [{ path: '/rec/bad.mp4', reason: 'unreadable' }],
      }),
      'Rec'
    )
    expect(summary).toBe(
      'Imported 12 videos · 3 already in the library · 1 relinked · 1 could not be read (bad.mp4)'
    )
  })

  test('singular for one video', () => {
    expect(folderImportSummary(result({ created: ids(1) }), 'Rec')).toBe('Imported 1 video')
  })

  test('an empty scan says no media was found, naming the folder', () => {
    expect(folderImportSummary(result(), 'Session 1')).toBe('No media found in Session 1')
  })

  test('nothing new names the folder instead of "Imported 0"', () => {
    const summary = folderImportSummary(result({ existing: ids(2) }), 'Rec')
    expect(summary).toBe('Rec: 2 already in the library')
    expect(summary).not.toContain('Imported')
  })

  test('names at most two failed files, then counts the rest', () => {
    const failed = ['a.mp4', 'b.mov', 'c.wav'].map((f) => ({ path: `/r/${f}`, reason: 'x' }))
    expect(folderImportSummary(result({ failed }), 'r')).toBe(
      'r: 3 could not be read (a.mp4, b.mov, +1 more)'
    )
  })

  test('a truncated scan says it stopped early, without naming the backend caps', () => {
    const summary = folderImportSummary(result({ created: ids(500), truncated: true }), 'Rec')
    expect(summary).toContain('Imported 500 videos')
    expect(summary).toContain('stopped early')
    expect(summary).toContain('on their own')
    expect(summary).not.toMatch(/\d+ files|\d+ folder/)
  })
})

describe('folderImportTone', () => {
  const failure = [{ path: '/r/bad.mp4', reason: 'media_not_found' }]

  test('info when nothing was found at all', () => {
    expect(folderImportTone(result())).toBe('info')
    expect(folderImportTone(result({ truncated: true }))).toBe('info')
  })

  test('error when every file found failed', () => {
    expect(folderImportTone(result({ failed: failure }))).toBe('error')
  })

  test.each([
    ['created', { created: ids(1) }],
    ['existing', { existing: ids(1) }],
    ['relinked', { relinked: ids(1) }],
    ['created with some failures', { created: ids(2), failed: failure }],
    ['only existing with some failures', { existing: ids(1), failed: failure }],
  ])('success when anything landed (%s)', (_label, overrides) => {
    expect(folderImportTone(result(overrides))).toBe('success')
  })
})

describe('importPathsBatch', () => {
  test('sends every path when within the route limit', () => {
    const paths = ['/a.mp4', '/b.mov']
    const batch = importPathsBatch(paths)
    expect(batch).toEqual({ paths: ['/a.mp4', '/b.mov'], truncated: false })
    expect(batch.paths).not.toBe(paths)
  })

  test('exactly the limit is not truncated', () => {
    const paths = Array.from({ length: IMPORT_PATHS_MAX }, (_, i) => `/f${i}.mp4`)
    expect(importPathsBatch(paths).truncated).toBe(false)
  })

  test('over the limit sends the first ones and marks it truncated', () => {
    const paths = Array.from({ length: IMPORT_PATHS_MAX + 3 }, (_, i) => `/f${i}.mp4`)
    const batch = importPathsBatch(paths)
    expect(batch.paths).toHaveLength(IMPORT_PATHS_MAX)
    expect(batch.paths[0]).toBe('/f0.mp4')
    expect(batch.truncated).toBe(true)
  })
})

describe('relinkRefusal', () => {
  test('reads the reason under FastAPI detail', () => {
    expect(relinkRefusal(409, { detail: { reason: 'different_media' } })).toEqual({
      kind: 'different_media',
    })
    expect(relinkRefusal(409, { detail: { reason: 'media_in_use', video_id: 'v2' } })).toEqual({
      kind: 'media_in_use',
      videoId: 'v2',
    })
    expect(relinkRefusal(422, { detail: { reason: 'media_not_found' } })).toEqual({
      kind: 'media_not_found',
    })
  })

  test('reads the reason at the top level too', () => {
    expect(relinkRefusal(409, { reason: 'media_in_use', video_id: 'v9' })).toEqual({
      kind: 'media_in_use',
      videoId: 'v9',
    })
    expect(relinkRefusal(422, { reason: 'media_not_found' })).toEqual({ kind: 'media_not_found' })
  })

  test('media_in_use without an id still maps', () => {
    expect(relinkRefusal(409, { detail: { reason: 'media_in_use' } })).toEqual({
      kind: 'media_in_use',
      videoId: null,
    })
  })

  test.each([
    [409, { detail: 'Record moved' }],
    [404, { detail: { reason: 'media_not_found' } }],
    [422, { detail: { reason: 'different_media' } }],
    [500, null],
    [409, { detail: [{ msg: 'x' }] }],
  ])('anything else (%s %j) is not a refusal', (status, body) => {
    expect(relinkRefusal(status, body)).toBeNull()
  })

  test('each refusal has user-facing copy', () => {
    expect(relinkRefusalMessage({ kind: 'media_not_found' })).toMatch(/could not be found/)
    expect(relinkRefusalMessage({ kind: 'media_in_use', videoId: 'v' })).toMatch(/another video/)
    expect(relinkRefusalMessage({ kind: 'different_media' })).toMatch(/different/)
  })
})

function file(path: string): DroppedItem {
  return { name: pathBaseName(path), path, isDirectory: false }
}

function dir(path: string): DroppedItem {
  return { name: pathBaseName(path), path, isDirectory: true }
}

describe('droppedImport', () => {
  test('one media file keeps "open in the editor"', () => {
    expect(droppedImport([file('/r/Talk.mp4')])).toEqual({
      kind: 'open',
      path: '/r/Talk.mp4',
      skipped: [],
    })
  })

  test('several media files import without opening', () => {
    expect(droppedImport([file('/r/a.mp4'), file('/r/b.MOV')])).toEqual({
      kind: 'files',
      paths: ['/r/a.mp4', '/r/b.MOV'],
      skipped: [],
    })
  })

  test('a directory imports the folder', () => {
    expect(droppedImport([dir('/Volumes/Rec')])).toEqual({ kind: 'folder', path: '/Volumes/Rec' })
  })

  test('non-media files ride along as skipped names', () => {
    expect(droppedImport([file('/r/a.mp4'), file('/r/notes.pdf')])).toEqual({
      kind: 'open',
      path: '/r/a.mp4',
      skipped: ['notes.pdf'],
    })
  })

  test('only non-media is rejected with a message naming it', () => {
    const plan = droppedImport([file('/r/notes.pdf')])
    expect(plan.kind).toBe('rejected')
    expect(plan.kind === 'rejected' && plan.message).toContain('notes.pdf')
  })

  test('several non-media files are rejected with a count', () => {
    const plan = droppedImport([file('/r/a.pdf'), file('/r/b.txt')])
    expect(plan.kind === 'rejected' && plan.message).toContain('2 dropped files')
  })

  test('a folder mixed with anything else is rejected, not half-done', () => {
    expect(droppedImport([dir('/r/A'), dir('/r/B')]).kind).toBe('rejected')
    expect(droppedImport([dir('/r/A'), file('/r/a.mp4')]).kind).toBe('rejected')
  })

  test('nothing with a path is a no-op, not an error', () => {
    expect(droppedImport([])).toEqual({ kind: 'none' })
    expect(droppedImport([{ name: 'x', path: null, isDirectory: false }])).toEqual({
      kind: 'none',
    })
  })
})

describe('droppedItemsOf', () => {
  interface FakeFile {
    name: string
    at: string
  }
  const pathOf = (f: FakeFile): string => f.at

  test('reads directory-ness from webkitGetAsEntry and paths through the bridge', () => {
    const items = [
      {
        kind: 'file',
        getAsFile: () => ({ name: 'Rec', at: '/Volumes/Rec' }),
        webkitGetAsEntry: () => ({ isDirectory: true }),
      },
      {
        kind: 'file',
        getAsFile: () => ({ name: 'a.mp4', at: '/r/a.mp4' }),
        webkitGetAsEntry: () => ({ isDirectory: false }),
      },
      { kind: 'string', getAsFile: () => null },
    ]
    expect(droppedItemsOf({ items }, pathOf)).toEqual([
      { name: 'Rec', path: '/Volumes/Rec', isDirectory: true },
      { name: 'a.mp4', path: '/r/a.mp4', isDirectory: false },
    ])
  })

  test('falls back to files when items are unavailable', () => {
    const files = [{ name: 'a.mp4', at: '/r/a.mp4' }]
    expect(droppedItemsOf({ items: null, files }, pathOf)).toEqual([
      { name: 'a.mp4', path: '/r/a.mp4', isDirectory: false },
    ])
  })

  test('an empty bridge answer becomes a null path', () => {
    const files = [{ name: 'a.mp4', at: '' }]
    expect(droppedItemsOf({ files }, pathOf)[0].path).toBeNull()
  })
})

describe('watchFolderView', () => {
  const watching: WatchStatus = {
    folder: '/Volumes/Rec',
    available: true,
    lastScanAt: null,
    importedCount: 0,
  }

  test('not watching', () => {
    expect(
      watchFolderView({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
    ).toEqual({ label: NOT_WATCHING, watching: false, note: null })
  })

  test('watching an available folder shows its path', () => {
    expect(watchFolderView(watching)).toEqual({
      label: '/Volumes/Rec',
      watching: true,
      note: null,
    })
  })

  test('an unplugged drive says the folder is not available', () => {
    expect(watchFolderView({ ...watching, available: false }).note).toBe(WATCH_FOLDER_UNAVAILABLE)
  })

  test('counts what was imported this session', () => {
    expect(watchFolderView({ ...watching, importedCount: 2 }).note).toBe(
      '2 videos imported since CapForge opened'
    )
  })

  test('before the status arrives it is not "watching"', () => {
    expect(watchFolderView(null).watching).toBe(false)
  })
})
