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
import type { CollectionSummary } from './collectionTypes'
import {
  ALL_COLLECTIONS,
  DURATION_PLACEHOLDER,
  MEDIA_EXTENSIONS,
  NO_COLLECTION,
  POSTER_ASPECT_FALLBACK,
  POSTER_ASPECT_MAX,
  POSTER_ASPECT_MIN,
  UNTITLED,
  cardImageAsset,
  collectionFilterOptions,
  continueCandidate,
  filterByCollection,
  displayTitle,
  fileStem,
  formatDuration,
  formatShortDate,
  isMediaPath,
  posterAspect,
  posterBoxWidth,
  publishedOnLabel,
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
    cover: null,
    ...overrides,
  }
}

describe('cardImageAsset', () => {
  const COVER = `${'c'.repeat(32)}.jpg`

  test('the chosen cover wins over the poster', () => {
    expect(cardImageAsset(video({ poster: true, cover: COVER }))).toBe(`thumbnails/${COVER}`)
    expect(cardImageAsset(video({ poster: false, cover: COVER }))).toBe(`thumbnails/${COVER}`)
  })

  test('without a cover the poster, and without either nothing to fetch', () => {
    expect(cardImageAsset(video({ poster: true }))).toBe('poster.jpg')
    expect(cardImageAsset(video({ poster: false }))).toBeNull()
  })
})

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
    const withoutProject = video({
      id: 'fresh',
      updatedAt: '2026-09-10T10:00:00Z',
      hasProject: false,
    })
    const withProject = video({ id: 'session', updatedAt: '2026-09-08T10:00:00Z' })
    expect(continueCandidate([withoutProject, withProject])?.id).toBe('session')
  })

  test('skips a record whose media is gone, and returns null when there is none', () => {
    expect(continueCandidate([video({ missing_media: true })])).toBeNull()
    expect(continueCandidate([])).toBeNull()
  })
})

/** One list, three copies (backend, renderer, Electron) — pinned to one fixture. */
const MEDIA_EXTENSIONS_FIXTURE = join(process.cwd(), 'backend/tests/fixtures/media_extensions.json')

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

describe('filterByCollection', () => {
  const videos = [
    video({ id: 'a', collection_id: 'uck26' }),
    video({ id: 'b', collection_id: null }),
    video({ id: 'c', collection_id: 'old' }),
  ]

  test('All keeps every record, as a new array', () => {
    const out = filterByCollection(videos, ALL_COLLECTIONS)
    expect(out.map((v) => v.id)).toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(videos)
  })

  test('No collection keeps the unfiled ones', () => {
    expect(filterByCollection(videos, NO_COLLECTION).map((v) => v.id)).toEqual(['b'])
  })

  test('a collection id keeps its members only', () => {
    expect(filterByCollection(videos, 'uck26').map((v) => v.id)).toEqual(['a'])
    expect(filterByCollection(videos, 'nobody')).toEqual([])
  })
})

describe('collectionFilterOptions', () => {
  test('All, each collection by name, ids only records carry, then No collection', () => {
    const collections = [{ id: 'uck26', name: 'UCK 26' }] as CollectionSummary[]
    const videos = [video({ collection_id: 'old' }), video({ collection_id: 'uck26' })]

    expect(collectionFilterOptions(collections, videos)).toEqual([
      { value: ALL_COLLECTIONS, label: 'All videos' },
      { value: 'uck26', label: 'UCK 26' },
      { value: 'old', label: 'old' },
      { value: NO_COLLECTION, label: 'No collection' },
    ])
  })

  test('the sentinels can never collide with a collection id', () => {
    for (const sentinel of [ALL_COLLECTIONS, NO_COLLECTION]) {
      expect(/^[a-z0-9][a-z0-9-]{0,63}$/.test(sentinel)).toBe(false)
    }
  })
})

describe('posterAspect', () => {
  test('a frame keeps its ratio', () => {
    expect(posterAspect(1920, 1080)).toBeCloseTo(16 / 9)
    expect(posterAspect(1080, 1920)).toBeCloseTo(9 / 16)
    expect(posterAspect(1080, 1080)).toBe(1)
  })

  test('an extreme ratio is clamped to the sane range', () => {
    expect(posterAspect(4000, 100)).toBe(POSTER_ASPECT_MAX)
    expect(posterAspect(100, 4000)).toBe(POSTER_ASPECT_MIN)
    expect(POSTER_ASPECT_MIN).toBeCloseTo(9 / 21)
    expect(POSTER_ASPECT_MAX).toBeCloseTo(21 / 9)
  })

  test.each([
    [0, 1080],
    [1920, 0],
    [-1, 10],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ])('an unusable size (%s×%s) is unknown, not a ratio', (w, h) => {
    expect(posterAspect(w, h)).toBeNull()
  })

  test('the fallback is 16:9', () => {
    expect(POSTER_ASPECT_FALLBACK).toBeCloseTo(16 / 9)
  })
})

describe('posterBoxWidth', () => {
  test('a fixed height takes its width from the ratio', () => {
    expect(posterBoxWidth(9 / 16, 180, 320)).toBe(101)
    expect(posterBoxWidth(1, 180, 320)).toBe(180)
  })

  test('an unknown ratio uses 16:9', () => {
    expect(posterBoxWidth(null, 180, 400)).toBe(320)
  })

  test('a wide ratio is held to the max width', () => {
    expect(posterBoxWidth(21 / 9, 180, 320)).toBe(320)
  })
})

describe('formatShortDate', () => {
  test('a parseable date is a short local date', () => {
    expect(formatShortDate('2026-09-01T10:00:00Z')).not.toBe('')
  })

  test.each(['', 'garbage'])('%j is empty rather than "Invalid Date"', (iso) => {
    expect(formatShortDate(iso)).toBe('')
  })
})

describe('publishedOnLabel', () => {
  const channels = [
    { id: 'main', name: 'Main channel' },
    { id: 'shorts', name: 'Shorts' },
  ]

  test('names the channels, in the order the record lists them', () => {
    expect(publishedOnLabel(['shorts', 'main'], channels)).toBe('Shorts, Main channel')
  })

  test('a channel Settings no longer has (or before the list loads) shows its id', () => {
    expect(publishedOnLabel(['gone'], channels)).toBe('gone')
    expect(publishedOnLabel(['main'], null)).toBe('main')
  })

  test('nothing published is empty', () => {
    expect(publishedOnLabel([], channels)).toBe('')
    expect(publishedOnLabel(undefined, channels)).toBe('')
  })
})
