/**
 * The pure halves of `useLibraryActions` — what a failed relink *means* and
 * what a picker that would not open reports, and how an import plan's
 * requests run (fakes stand in for the backend). The hook itself is not mounted: the vitest
 * environment is plain node, with no renderer to mount it in.
 */

import { describe, expect, test } from 'vitest'
import { RelinkRefusedError } from '../lib/libraryApi'
import type { ImportPlan } from '../lib/libraryImport'
import { importSummary, importTone } from '../lib/libraryImportSummary'
import type { FolderImportResult } from '../lib/libraryTypes'
import type { ImportRequests } from './useLibraryActions'
import {
  executeImportPlan,
  importPickerFailedMessage,
  locateFailedMessage,
  locateOutcomeOf,
} from './useLibraryActions'

describe('locateOutcomeOf', () => {
  test('a different-media refusal asks the card to confirm, silently', () => {
    const err = new RelinkRefusedError({ kind: 'different_media' })
    expect(locateOutcomeOf(err, '/new/b.mp4', 'Talk')).toEqual({
      outcome: { kind: 'confirm', path: '/new/b.mp4' },
      message: null,
    })
  })

  test.each([
    [{ kind: 'media_in_use', videoId: 'v2' } as const, /another video/],
    [{ kind: 'media_not_found' } as const, /could not be found/],
  ])('the %j refusal is toasted, naming the video', (refusal, pattern) => {
    const { outcome, message } = locateOutcomeOf(new RelinkRefusedError(refusal), '/p', 'Talk')
    expect(outcome).toEqual({ kind: 'failed' })
    expect(message).toContain('Talk')
    expect(message).toMatch(pattern)
  })

  test('any other error is toasted with its reason', () => {
    const { outcome, message } = locateOutcomeOf(new Error('backend down'), '/p', 'Talk')
    expect(outcome).toEqual({ kind: 'failed' })
    expect(message).toBe(locateFailedMessage('Talk', 'backend down'))
  })

  test('a forced relink never confirms again — a mismatch there is a failure', () => {
    const err = new RelinkRefusedError({ kind: 'different_media' })
    expect(locateOutcomeOf(err, '/p', 'Talk', { forced: true }).outcome).toEqual({
      kind: 'failed',
    })
  })
})

describe('importPickerFailedMessage', () => {
  test('keeps the reason', () => {
    expect(importPickerFailedMessage('ENOENT: /gone.mp4')).toBe(
      'Could not open the import picker: ENOENT: /gone.mp4'
    )
  })
})

describe('executeImportPlan', () => {
  const empty: FolderImportResult = {
    created: [],
    existing: [],
    relinked: [],
    failed: [],
    truncated: false,
  }
  const plan = (overrides: Partial<ImportPlan> = {}): ImportPlan => ({
    folders: [],
    media: [],
    mediaTruncated: false,
    projects: [],
    skipped: [],
    ...overrides,
  })

  function fakeRequests(failing: readonly string[] = []) {
    const calls: string[] = []
    const answer = (label: string, result: FolderImportResult) => {
      calls.push(label)
      return failing.includes(label)
        ? Promise.reject(new Error(`${label} refused`))
        : Promise.resolve(result)
    }
    const requests: ImportRequests = {
      importFolder: (path) => answer(`folder:${path}`, { ...empty, created: [path] }),
      importPaths: (paths) =>
        answer(`paths:${paths.join(',')}`, { ...empty, existing: [...paths] }),
      importProject: (path) => answer(`project:${path}`, empty),
    }
    return { calls, requests }
  }

  test('each folder, then ONE media batch, then each project, in order', async () => {
    const { calls, requests } = fakeRequests()
    const tally = await executeImportPlan(
      plan({
        folders: ['/r/A', '/r/B'],
        media: ['/r/a.mp4', '/r/b.mp4'],
        projects: ['/r/p.capforge'],
      }),
      requests
    )
    expect(calls).toEqual([
      'folder:/r/A',
      'folder:/r/B',
      'paths:/r/a.mp4,/r/b.mp4',
      'project:/r/p.capforge',
    ])
    expect(importSummary(tally)).toBe(
      'Imported 2 videos · 2 already in the library · 1 project imported'
    )
  })

  test('a failed request is named in the tally and the rest still run', async () => {
    const { calls, requests } = fakeRequests([
      'folder:/r/A',
      'paths:/r/a.mp4',
      'project:/r/p.capforge',
    ])
    const tally = await executeImportPlan(
      plan({ folders: ['/r/A', '/r/B'], media: ['/r/a.mp4'], projects: ['/r/p.capforge'] }),
      requests
    )
    expect(calls).toHaveLength(4)
    expect(tally.errors).toEqual([
      { name: 'A', reason: 'folder:/r/A refused' },
      { name: '1 file', reason: 'paths:/r/a.mp4 refused' },
      { name: 'p.capforge', reason: 'project:/r/p.capforge refused' },
    ])
    expect(tally.created).toBe(1)
    expect(importTone(tally)).toBe('success')
  })

  test('no media means no import-paths request at all', async () => {
    const { calls, requests } = fakeRequests()
    await executeImportPlan(plan({ projects: ['/r/p.capforge'] }), requests)
    expect(calls).toEqual(['project:/r/p.capforge'])
  })
})
