/**
 * The combined import toast — pure, so the copy is pinned here.
 *
 * What matters: the summary never lies about what happened (nothing imported
 * is not "Imported 0 videos"), an import of one folder reads exactly as the
 * folder-import toast always did, a mixed import is **one** toast that names
 * every failure, a truncated import says so, and the tally is never mutated.
 */

import { describe, expect, test } from 'vitest'
import type { ImportPlan } from './libraryImport'
import type { FolderImportResult } from './libraryTypes'
import type { ImportTally } from './libraryImportSummary'
import {
  IMPORT_STOPPED_EARLY_NOTE,
  importSummary,
  importTally,
  importTone,
  tallyError,
  tallyFolderResult,
  tallyProject,
} from './libraryImportSummary'

function result(overrides: Partial<FolderImportResult> = {}): FolderImportResult {
  return { created: [], existing: [], relinked: [], failed: [], truncated: false, ...overrides }
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id${i}`)

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return { folders: [], media: [], mediaTruncated: false, projects: [], skipped: [], ...overrides }
}

/** The tally one folder import leaves — the old single-folder toast's input. */
function folderTally(overrides: Partial<FolderImportResult> = {}, folder = '/r/Rec'): ImportTally {
  return tallyFolderResult(importTally(plan({ folders: [folder] })), result(overrides))
}

describe('importSummary: one folder reads as it always did', () => {
  test('names every non-empty bucket, in order', () => {
    const summary = importSummary(
      folderTally({
        created: ids(12),
        existing: ids(3),
        relinked: ids(1),
        failed: [{ path: '/rec/bad.mp4', reason: 'unreadable' }],
      })
    )
    expect(summary).toBe(
      'Imported 12 videos · 3 already in the library · 1 relinked · 1 could not be read (bad.mp4)'
    )
  })

  test('singular for one video', () => {
    expect(importSummary(folderTally({ created: ids(1) }))).toBe('Imported 1 video')
  })

  test('an empty scan says no media was found, naming the folder', () => {
    expect(importSummary(folderTally({}, '/r/Session 1'))).toBe('No media found in Session 1')
  })

  test('nothing new names the folder instead of "Imported 0"', () => {
    const summary = importSummary(folderTally({ existing: ids(2) }))
    expect(summary).toBe('Rec: 2 already in the library')
    expect(summary).not.toContain('Imported')
  })

  test('names at most two failed files, then counts the rest', () => {
    const failed = ['a.mp4', 'b.mov', 'c.wav'].map((f) => ({ path: `/r/${f}`, reason: 'x' }))
    expect(importSummary(folderTally({ failed }, '/x/r'))).toBe(
      'r: 3 could not be read (a.mp4, b.mov, +1 more)'
    )
  })

  test('a truncated scan says it stopped early, without naming the backend caps', () => {
    const summary = importSummary(folderTally({ created: ids(500), truncated: true }))
    expect(summary).toContain('Imported 500 videos')
    expect(summary).toContain('stopped early')
    expect(summary).toContain('on their own')
    expect(summary).not.toMatch(/\d+ files|\d+ folder/)
  })
})

describe('importSummary: a mixed import is one combined toast', () => {
  test('adds up every folder and the file batch, then projects, errors and skips', () => {
    let tally = importTally(
      plan({
        folders: ['/r/A', '/r/B'],
        media: ['/r/c.mp4'],
        projects: ['/r/p.capforge', '/r/q.capforge'],
        skipped: ['notes.pdf'],
      })
    )
    tally = tallyFolderResult(tally, result({ created: ids(2), existing: ids(1) }))
    tally = tallyError(tally, 'B', 'backend down')
    tally = tallyFolderResult(tally, result({ created: ids(1), relinked: ids(1) }))
    tally = tallyProject(tally)
    tally = tallyError(tally, 'q.capforge', 'not a project')

    expect(importSummary(tally)).toBe(
      'Imported 3 videos · 1 already in the library · 1 relinked · 1 project imported · ' +
        'Could not import B (backend down), q.capforge (not a project) · ' +
        'Skipped 1 file that is not video, audio or a CapForge project (notes.pdf)'
    )
  })

  test('only projects: no folder prefix and no "Imported 0 videos"', () => {
    const tally = tallyProject(tallyProject(importTally(plan({ projects: ['/a', '/b'] }))))
    expect(importSummary(tally)).toBe('2 projects imported')
  })

  test('names at most two errors, then counts the rest', () => {
    let tally = importTally(plan({ projects: ['/a', '/b', '/c'] }))
    for (const name of ['a', 'b', 'c']) tally = tallyError(tally, name, 'x')
    expect(importSummary(tally)).toBe('Could not import a (x), b (x), +1 more')
  })

  test('names at most three skipped files', () => {
    const tally = importTally(plan({ skipped: ['a.pdf', 'b.txt', 'c.doc', 'd.png'] }))
    expect(importSummary(tally)).toBe(
      'Skipped 4 files that are not video, audio or a CapForge project (a.pdf, b.txt, c.doc, +1 more)'
    )
  })

  test('a file batch cut at the route limit says it stopped early', () => {
    const tally = tallyFolderResult(
      importTally(plan({ media: ['/a.mp4'], mediaTruncated: true })),
      result({ created: ids(1) })
    )
    expect(importSummary(tally)).toBe(`Imported 1 video. ${IMPORT_STOPPED_EARLY_NOTE}`)
  })

  test('a mixed import that found nothing does not name one folder', () => {
    expect(importSummary(importTally(plan({ folders: ['/a', '/b'] })))).toBe('No media found')
  })

  test('the tally is never mutated in place', () => {
    const start = importTally(plan({ folders: ['/r/A'] }))
    const snapshot = JSON.stringify(start)
    tallyFolderResult(start, result({ created: ids(1), failed: [{ path: '/x', reason: 'y' }] }))
    tallyProject(start)
    tallyError(start, 'A', 'down')
    expect(JSON.stringify(start)).toBe(snapshot)
  })
})

describe('importTone', () => {
  const failure = [{ path: '/r/bad.mp4', reason: 'media_not_found' }]

  test('info when nothing was found at all', () => {
    expect(importTone(folderTally())).toBe('info')
    expect(importTone(folderTally({ truncated: true }))).toBe('info')
  })

  test('error when every file found failed', () => {
    expect(importTone(folderTally({ failed: failure }))).toBe('error')
  })

  test('error when a whole request failed and nothing landed', () => {
    expect(importTone(tallyError(importTally(plan({ folders: ['/a'] })), 'a', 'down'))).toBe(
      'error'
    )
  })

  test('error when everything picked was skipped', () => {
    expect(importTone(importTally(plan({ skipped: ['a.pdf'] })))).toBe('error')
  })

  test.each([
    ['created', { created: ids(1) }],
    ['existing', { existing: ids(1) }],
    ['relinked', { relinked: ids(1) }],
    ['created with some failures', { created: ids(2), failed: failure }],
    ['only existing with some failures', { existing: ids(1), failed: failure }],
  ])('success when anything landed (%s)', (_label, overrides) => {
    expect(importTone(folderTally(overrides))).toBe('success')
  })

  test('success when only a project landed, even beside an error', () => {
    const tally = tallyError(tallyProject(importTally(plan({ projects: ['/a', '/b'] }))), 'b', 'x')
    expect(importTone(tally)).toBe('success')
  })
})
