/**
 * The card derivations. What matters: the title never comes out blank, the
 * duration never comes out as "NaN:aN", the pips are cumulative (a drafted
 * record was transcribed too), and sorting hands back a NEW array — the fetched
 * list is shared state the screen re-renders from.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { LibraryVideo } from './libraryTypes'
import {
  DURATION_PLACEHOLDER,
  MEDIA_EXTENSIONS,
  UNTITLED,
  continueCandidate,
  displayTitle,
  fileStem,
  formatDuration,
  isMediaPath,
  sortByUpdated,
  statusPips,
} from './libraryView'

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a'.repeat(32),
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
    hasProject: true,
    poster: false,
    ...overrides,
  }
}

describe('displayTitle', () => {
  test('prefers the authored title', () => {
    expect(displayTitle(video({ title: '  Shipping v3  ' }))).toBe('Shipping v3')
  })

  test('falls back to the source file stem', () => {
    expect(displayTitle(video({ sourcePath: '/a/b/My Talk.final.mp4' }))).toBe('My Talk.final')
  })

  test('handles a Windows path and a dotfile-style name', () => {
    expect(fileStem('C:\\videos\\Keynote.mov')).toBe('Keynote')
    expect(fileStem('.capforge')).toBe('.capforge')
  })

  test('never returns an empty heading', () => {
    expect(displayTitle(video({ title: '   ', sourcePath: '' }))).toBe(UNTITLED)
  })
})

describe('formatDuration', () => {
  test.each([
    [0, '0:00'],
    [9, '0:09'],
    [90, '1:30'],
    [599.4, '9:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [37230, '10:20:30'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  test.each([null, undefined, NaN, -5])('shows the placeholder for %s', (value) => {
    expect(formatDuration(value as number | null)).toBe(DURATION_PLACEHOLDER)
  })
})

describe('statusPips', () => {
  test('imported lights nothing', () => {
    expect(statusPips('imported')).toEqual({
      transcribed: false,
      captioned: false,
      drafted: false,
      published: false,
    })
  })

  test('is cumulative up the ladder', () => {
    expect(statusPips('drafted')).toEqual({
      transcribed: true,
      captioned: true,
      drafted: true,
      published: false,
    })
    expect(statusPips('published')).toEqual({
      transcribed: true,
      captioned: true,
      drafted: true,
      published: true,
    })
  })
})

describe('sortByUpdated', () => {
  test('newest first, without mutating the input', () => {
    const older = video({ id: 'old', updatedAt: '2026-09-01T10:00:00Z' })
    const newer = video({ id: 'new', updatedAt: '2026-09-09T10:00:00Z' })
    const input = [older, newer]

    const sorted = sortByUpdated(input)

    expect(sorted.map((v) => v.id)).toEqual(['new', 'old'])
    expect(input.map((v) => v.id)).toEqual(['old', 'new'])
    expect(sorted).not.toBe(input)
  })

  test('falls back to createdAt when updatedAt is missing', () => {
    const a = video({ id: 'a', updatedAt: '', createdAt: '2026-09-02T10:00:00Z' })
    const b = video({ id: 'b', updatedAt: '', createdAt: '2026-09-03T10:00:00Z' })
    expect(sortByUpdated([a, b]).map((v) => v.id)).toEqual(['b', 'a'])
  })
})

describe('continueCandidate', () => {
  test('is the newest record that has a stored session', () => {
    const withoutProject = video({ id: 'fresh', updatedAt: '2026-09-10T10:00:00Z', hasProject: false })
    const withProject = video({ id: 'session', updatedAt: '2026-09-08T10:00:00Z' })
    expect(continueCandidate([withoutProject, withProject])?.id).toBe('session')
  })

  test('skips a record whose media is gone, and returns null when there is none', () => {
    expect(continueCandidate([video({ missing_media: true })])).toBeNull()
    expect(continueCandidate([])).toBeNull()
  })
})

/** One list, three copies (backend, renderer, Electron) — pinned to one fixture. */
const MEDIA_EXTENSIONS_FIXTURE = join(
  process.cwd(),
  'backend/tests/fixtures/media_extensions.json'
)

describe('MEDIA_EXTENSIONS', () => {
  test('equals the shared fixture', () => {
    const fixture = JSON.parse(readFileSync(MEDIA_EXTENSIONS_FIXTURE, 'utf-8')) as {
      extensions: string[]
    }
    expect([...MEDIA_EXTENSIONS].sort()).toEqual([...fixture.extensions].sort())
    expect(new Set(MEDIA_EXTENSIONS).size).toBe(MEDIA_EXTENSIONS.length)
  })
})

describe('isMediaPath', () => {
  test.each(MEDIA_EXTENSIONS)('accepts .%s', (ext) => {
    expect(isMediaPath(`/x/clip.${ext.toUpperCase()}`)).toBe(true)
  })

  test.each(['/x/notes.capforge', '/x/README', '/x/archive.zip', ''])('rejects %s', (name) => {
    expect(isMediaPath(name)).toBe(false)
  })
})
