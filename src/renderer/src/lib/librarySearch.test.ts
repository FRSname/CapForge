/**
 * Library search, the pure half. What matters: the backend's matches only ever
 * *narrow* what is on screen (a match outside the collection filter stays
 * hidden, and the view's order is kept), no result yet means nothing is hidden,
 * and an older request that resolves after a newer one is recognisable as stale.
 */

import { describe, expect, test } from 'vitest'
import type { LibraryVideo } from './libraryTypes'
import {
  LIBRARY_SEARCH_DEBOUNCE_MS,
  createLatestOnly,
  isSearching,
  matchIdsOf,
  matchingVideos,
  noMatchMessage,
  normalizeQuery,
  searchFailedMessage,
} from './librarySearch'

function video(id: string): LibraryVideo {
  return {
    id,
    title: id,
    sourcePath: `/media/${id}.mp4`,
    duration: 90,
    language: 'en',
    status: 'imported',
    collection_id: null,
    scratch: false,
    createdAt: '',
    updatedAt: '',
    missing_media: false,
    hasProject: false,
    poster: false,
    cover: null,
  }
}

test('typing settles for 200 ms before a request', () => {
  expect(LIBRARY_SEARCH_DEBOUNCE_MS).toBe(200)
})

describe('normalizeQuery / isSearching', () => {
  test('surrounding whitespace is not a search', () => {
    expect(normalizeQuery('  talk  ')).toBe('talk')
    expect(isSearching('   ')).toBe(false)
    expect(isSearching('')).toBe(false)
    expect(isSearching(' a ')).toBe(true)
  })
})

describe('matchIdsOf', () => {
  test('is the set of returned ids', () => {
    expect([...matchIdsOf([video('a'), video('b')])]).toEqual(['a', 'b'])
  })
})

describe('matchingVideos', () => {
  const onScreen = [video('c'), video('a'), video('b')]

  test('keeps only matches, in the order the view shows them', () => {
    const shown = matchingVideos(onScreen, new Set(['b', 'c']))
    expect(shown.map((v) => v.id)).toEqual(['c', 'b'])
  })

  test('a match that is not on screen (another collection) does not appear', () => {
    expect(matchingVideos([video('a')], new Set(['a', 'zzz'])).map((v) => v.id)).toEqual(['a'])
  })

  test('no result yet hides nothing, and hands back a NEW array', () => {
    const shown = matchingVideos(onScreen, null)
    expect(shown.map((v) => v.id)).toEqual(['c', 'a', 'b'])
    expect(shown).not.toBe(onScreen)
  })

  test('an empty result hides everything', () => {
    expect(matchingVideos(onScreen, new Set())).toEqual([])
  })
})

describe('createLatestOnly', () => {
  test('only the most recent request is current', () => {
    const latest = createLatestOnly()
    const first = latest.begin()
    const second = latest.begin()
    expect(latest.isLatest(first)).toBe(false)
    expect(latest.isLatest(second)).toBe(true)
  })

  test('invalidate makes an in-flight request stale (the field was cleared)', () => {
    const latest = createLatestOnly()
    const ticket = latest.begin()
    latest.invalidate()
    expect(latest.isLatest(ticket)).toBe(false)
  })

  test('two sequencers never share tickets', () => {
    const a = createLatestOnly()
    const b = createLatestOnly()
    const ticket = a.begin()
    b.begin()
    b.begin()
    expect(a.isLatest(ticket)).toBe(true)
  })
})

describe('messages', () => {
  test('the empty result names the query', () => {
    expect(noMatchMessage('keynote', false)).toBe('No videos match “keynote”.')
    expect(noMatchMessage('keynote', true)).toBe('No videos in this collection match “keynote”.')
  })

  test('a failed search says what failed and why', () => {
    expect(searchFailedMessage('keynote', 'backend down')).toBe(
      'Could not search the library for “keynote”: backend down'
    )
  })
})
