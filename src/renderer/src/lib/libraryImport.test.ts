/**
 * The folder-import copy and decisions — pure, so every branch is pinned here
 * rather than behind a DOM the vitest node environment does not have.
 *
 * What matters: a pick and a drop are sorted the same way (`importPlan`), the
 * picker's answer is checked at the boundary, the relink refusal is read
 * wherever FastAPI put it, and a drop does exactly one legible thing. The
 * combined summary is pinned in `libraryImportSummary.test.ts`.
 */

import { describe, expect, test } from 'vitest'
import type { WatchStatus } from './libraryTypes'
import {
  IMPORT_PATHS_MAX,
  WATCH_FOLDER_UNAVAILABLE,
  NOT_WATCHING,
  droppedImport,
  droppedItemsOf,
  importPathsBatch,
  importPlan,
  isEmptyPlan,
  isProjectPath,
  pathBaseName,
  pickedEntriesOf,
  relinkRefusal,
  relinkRefusalMessage,
  watchFolderView,
  type DroppedItem,
  type ImportPlan,
  type PickedEntry,
} from './libraryImport'

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

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return { folders: [], media: [], mediaTruncated: false, projects: [], skipped: [], ...overrides }
}

describe('importPlan', () => {
  const pick = (path: string, kind: PickedEntry['kind'] = 'file'): PickedEntry => ({ path, kind })

  test('sorts folders, media, projects and everything else', () => {
    expect(
      importPlan([
        pick('/r/Day 1', 'directory'),
        pick('/r/a.mp4'),
        pick('/r/Talk.capforge'),
        pick('/r/b.MOV'),
        pick('/r/notes.pdf'),
        pick('/r/Day 2.mp4', 'directory'),
        pick('/r/OLD.CAPFORGE'),
      ])
    ).toEqual({
      // A directory is a folder whatever its name looks like.
      folders: ['/r/Day 1', '/r/Day 2.mp4'],
      media: ['/r/a.mp4', '/r/b.MOV'],
      mediaTruncated: false,
      projects: ['/r/Talk.capforge', '/r/OLD.CAPFORGE'],
      skipped: ['notes.pdf'],
    })
  })

  test('media past the route limit is cut and marked', () => {
    const picked = Array.from({ length: IMPORT_PATHS_MAX + 2 }, (_, i) => pick(`/r/${i}.mp4`))
    const planned = importPlan(picked)
    expect(planned.media).toHaveLength(IMPORT_PATHS_MAX)
    expect(planned.mediaTruncated).toBe(true)
  })

  test('nothing picked is an empty plan', () => {
    expect(importPlan([])).toEqual(plan())
    expect(isEmptyPlan(importPlan([]))).toBe(true)
    expect(isEmptyPlan(plan({ skipped: ['a.pdf'] }))).toBe(false)
  })

  test('isProjectPath needs the dot', () => {
    expect(isProjectPath('/r/a.capforge')).toBe(true)
    expect(isProjectPath('/r/acapforge')).toBe(false)
  })
})

describe('pickedEntriesOf', () => {
  test('passes a well-formed picker answer through, as new objects', () => {
    const answer = [
      { path: '/r/a.mp4', kind: 'file' },
      { path: '/r/A', kind: 'directory' },
    ]
    const entries = pickedEntriesOf(answer)
    expect(entries).toEqual(answer)
    expect(entries[0]).not.toBe(answer[0])
  })

  test.each([
    null,
    'nope',
    [{ path: '', kind: 'file' }],
    [{ path: '/a', kind: 'symlink' }],
    [{ path: 42, kind: 'file' }],
    [null],
  ])('refuses a malformed answer (%j) rather than dropping entries', (answer) => {
    expect(() => pickedEntriesOf(answer)).toThrow(/import picker/)
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

  test('one media file beside non-media still opens, naming the skipped', () => {
    expect(droppedImport([file('/r/a.mp4'), file('/r/notes.pdf')])).toEqual({
      kind: 'open',
      path: '/r/a.mp4',
      skipped: ['notes.pdf'],
    })
  })

  test('several media files import without opening', () => {
    expect(droppedImport([file('/r/a.mp4'), file('/r/b.MOV')])).toEqual({
      kind: 'import',
      plan: plan({ media: ['/r/a.mp4', '/r/b.MOV'] }),
    })
  })

  test('a directory imports the folder', () => {
    expect(droppedImport([dir('/Volumes/Rec')])).toEqual({
      kind: 'import',
      plan: plan({ folders: ['/Volumes/Rec'] }),
    })
  })

  test('a project file imports, even alone', () => {
    expect(droppedImport([file('/r/Talk.capforge')])).toEqual({
      kind: 'import',
      plan: plan({ projects: ['/r/Talk.capforge'] }),
    })
  })

  test('a mixed drop is imported, not refused', () => {
    expect(
      droppedImport([
        dir('/r/A'),
        dir('/r/B'),
        file('/r/a.mp4'),
        file('/r/p.capforge'),
        file('/r/x.txt'),
      ])
    ).toEqual({
      kind: 'import',
      plan: plan({
        folders: ['/r/A', '/r/B'],
        media: ['/r/a.mp4'],
        projects: ['/r/p.capforge'],
        skipped: ['x.txt'],
      }),
    })
  })

  test('only non-media is rejected with a message naming it', () => {
    const planned = droppedImport([file('/r/notes.pdf')])
    expect(planned.kind).toBe('rejected')
    expect(planned.kind === 'rejected' && planned.message).toContain('notes.pdf')
  })

  test('several non-media files are rejected with a count', () => {
    const planned = droppedImport([file('/r/a.pdf'), file('/r/b.txt')])
    expect(planned.kind === 'rejected' && planned.message).toContain('2 dropped files')
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
