/**
 * Library search, the pure half. What matters: a match is a backend hit or a
 * shown name containing the query (folded: case, diacritics, separators); the
 * matches only ever *narrow* what is on screen (a match outside the search
 * scope stays hidden, and the view's order is kept); no backend result yet
 * means the name matches alone; and an older request that resolves after a
 * newer one is recognisable as stale.
 */

import { describe, expect, test } from 'vitest'
import type { LibraryVideo } from './libraryTypes'
import {
  LIBRARY_SEARCH_DEBOUNCE_MS,
  createLatestOnly,
  foldForSearch,
  isSearching,
  localMatchIds,
  matchIdsOf,
  matchingVideos,
  noMatchMessage,
  normalizeQuery,
  searchFailedMessage,
  searchResults,
  unionMatchIds,
} from './librarySearch'

function video(id: string, title = id, sourcePath = `/media/${id}.mp4`): LibraryVideo {
  return {
    id,
    title,
    sourcePath,
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

  test('a match that is not on screen (another folder) does not appear', () => {
    expect(matchingVideos([video('a')], new Set(['a', 'zzz'])).map((v) => v.id)).toEqual(['a'])
  })

  test('hands back a NEW array', () => {
    const shown = matchingVideos(onScreen, new Set(['a', 'b', 'c']))
    expect(shown.map((v) => v.id)).toEqual(['c', 'a', 'b'])
    expect(shown).not.toBe(onScreen)
  })

  test('an empty result hides everything', () => {
    expect(matchingVideos(onScreen, new Set())).toEqual([])
  })
})

describe('foldForSearch', () => {
  test('drops case and diacritics', () => {
    expect(foldForSearch('Sázení Stromků')).toBe('sazeni stromku')
    expect(foldForSearch('ŘEŘICHA')).toBe('rericha')
  })

  test('reads runs of whitespace, -, _ and . as one space, trimmed', () => {
    expect(foldForSearch('  vizualni--smog_v2.final ')).toBe('vizualni smog v2 final')
    expect(foldForSearch('-_. ')).toBe('')
  })

  test('agrees for precomposed and decomposed input', () => {
    expect(foldForSearch('Sa\u0301zeni')).toBe(foldForSearch('S\u00e1zeni'))
  })
})

describe('localMatchIds', () => {
  const titled = video('t', 'Sázení stromků', '/m/IMG_0042.mov')
  const untitled = video('u', '', '/m/vizualni-smog.mp4')
  const blank = video('b', '   ', '/m/Keynote.mp4')

  test('matches the title, case- and diacritic-insensitively, as a substring', () => {
    expect([...localMatchIds([titled, untitled], 'SAZENI')]).toEqual(['t'])
    expect([...localMatchIds([titled, untitled], 'tromk')]).toEqual(['t'])
  })

  test('an untitled video is matched by the file stem its card shows', () => {
    for (const q of ['vizu', 'vizualni-smog', 'Vizualni Smog', 'smog']) {
      expect([...localMatchIds([titled, untitled], q)]).toEqual(['u'])
    }
    expect([...localMatchIds([blank], 'keynote')]).toEqual(['b'])
  })

  test('a titled video is not matched by its file name (the backend covers that)', () => {
    expect(localMatchIds([titled], 'img')).toEqual(new Set())
  })

  test('a query of only separators matches nothing', () => {
    expect(localMatchIds([titled, untitled], ' - ')).toEqual(new Set())
  })
})

describe('unionMatchIds', () => {
  test('is every local and every backend id, once, as a NEW set', () => {
    const local = new Set(['a', 'b'])
    const union = unionMatchIds(local, new Set(['b', 'c']))
    expect([...union].sort()).toEqual(['a', 'b', 'c'])
    expect(union).not.toBe(local)
  })

  test('no backend answer yet is the local matches alone', () => {
    expect(unionMatchIds(new Set(['a']), null)).toEqual(new Set(['a']))
  })
})

describe('searchResults', () => {
  const onScreen = [
    video('c', 'Cooking show'),
    video('a', '', '/m/vizualni-smog.mp4'),
    video('b', 'Baking bread'),
  ]

  test('a name match and a backend hit (a transcript match) both show, in view order', () => {
    expect(searchResults(onScreen, 'vizu', new Set(['c'])).map((v) => v.id)).toEqual(['c', 'a'])
  })

  test('before the backend answers only the name matches show', () => {
    expect(searchResults(onScreen, 'bak', null).map((v) => v.id)).toEqual(['b'])
    expect(searchResults(onScreen, 'zzz', null)).toEqual([])
  })

  test('a backend id that is not on screen does not appear', () => {
    expect(searchResults(onScreen, 'zzz', new Set(['elsewhere']))).toEqual([])
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
    expect(noMatchMessage('keynote', true)).toBe('No videos in this folder match “keynote”.')
  })

  test('a failed search says what failed and why', () => {
    expect(searchFailedMessage('keynote', 'backend down')).toBe(
      'Could not search the library for “keynote”: backend down'
    )
  })
})
