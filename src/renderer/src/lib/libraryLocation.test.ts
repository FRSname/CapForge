/**
 * The library's location model (docs/plans/library-finder.md §1, §4.2): what
 * All videos, the Library root and a folder contain, their breadcrumb, the
 * search scope, and the fallback when a remembered folder is gone.
 */

import { describe, expect, test } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { EMPTY_OVERRIDES } from './collectionTypes'
import type { LibraryVideo } from './libraryTypes'
import {
  ALL_VIDEOS_LOCATION,
  ROOT_LOCATION,
  breadcrumb,
  folderSummary,
  folderLocation,
  hasScopeToggle,
  isLibraryLocation,
  locationContents,
  locationKey,
  orphanIds,
  parentForNewFolder,
  resolveLocation,
  sameLocation,
  searchScopeIds,
  shownAt,
  showsContinueHero,
  showsFolderColumn,
  videosInScope,
  visibleContents,
} from './libraryLocation'

function folder(id: string, name: string, parent_id: string | null = null, total = 0) {
  return {
    id,
    name,
    slots: {},
    overrides: EMPTY_OVERRIDES,
    createdAt: '',
    updatedAt: '',
    members: 0,
    parent_id,
    total_members: total,
    path: [name],
  } satisfies CollectionSummary
}

function video(id: string, collection_id: string | null): LibraryVideo {
  return {
    id,
    title: id,
    sourcePath: `/m/${id}.mp4`,
    duration: 1,
    language: null,
    status: 'imported',
    collection_id,
    scratch: false,
    createdAt: '',
    updatedAt: '',
    missing_media: false,
    hasProject: false,
    poster: false,
    cover: null,
  }
}

// Events › UCK26 › Day 2, Events › Day 10, Tutorials
const TREE = [
  folder('events', 'Events', null, 4),
  folder('tutorials', 'Tutorials', null, 0),
  folder('uck26', 'UCK26', 'events', 3),
  folder('day-2', 'Day 2', 'uck26', 1),
  folder('day-10', 'Day 10', 'events', 0),
]

const VIDEOS = [
  video('loose', null),
  video('keynote', 'uck26'),
  video('panel', 'uck26'),
  video('day2-talk', 'day-2'),
  video('event-intro', 'events'),
  video('stray', 'old-event'),
]

const ids = (videos: readonly LibraryVideo[]) => videos.map((v) => v.id)

describe('locations', () => {
  test('keys and equality', () => {
    expect(locationKey(ALL_VIDEOS_LOCATION)).toBe('all')
    expect(locationKey(ROOT_LOCATION)).toBe('root')
    expect(locationKey(folderLocation('uck26'))).toBe('folder:uck26')
    expect(sameLocation(folderLocation('a'), folderLocation('a'))).toBe(true)
    expect(sameLocation(folderLocation('a'), folderLocation('b'))).toBe(false)
    expect(sameLocation(ROOT_LOCATION, ALL_VIDEOS_LOCATION)).toBe(false)
  })

  test('the guard accepts only the three shapes', () => {
    expect(isLibraryLocation({ kind: 'all' })).toBe(true)
    expect(isLibraryLocation({ kind: 'root' })).toBe(true)
    expect(isLibraryLocation({ kind: 'folder', id: 'uck26' })).toBe(true)
    for (const bad of [
      null,
      'root',
      {},
      { kind: 'folder' },
      { kind: 'folder', id: '' },
      { kind: 'x' },
    ]) {
      expect(isLibraryLocation(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('orphanIds', () => {
  test('ids records carry that no folder defines, sorted, once each', () => {
    const videos = [...VIDEOS, video('stray-2', 'old-event'), video('b', 'another')]
    expect(orphanIds(videos, TREE)).toEqual(['another', 'old-event'])
  })

  test('nothing is an orphan before the folders load', () => {
    expect(orphanIds(VIDEOS, null)).toEqual([])
  })
})

describe('locationContents', () => {
  test('All videos is flat: every video, no folders', () => {
    const contents = locationContents(ALL_VIDEOS_LOCATION, TREE, VIDEOS)
    expect(contents.folders).toEqual([])
    expect(ids(contents.videos)).toEqual(ids(VIDEOS))
  })

  test('the root holds top-level folders by name, orphans, and the unfiled videos', () => {
    const contents = locationContents(ROOT_LOCATION, TREE, VIDEOS)
    expect(contents.folders.map((f) => [f.id, f.orphan])).toEqual([
      ['events', false],
      ['tutorials', false],
      ['old-event', true],
    ])
    expect(ids(contents.videos)).toEqual(['loose'])
  })

  test('a folder holds its direct subfolders (numeric name order) and direct videos', () => {
    const contents = locationContents(folderLocation('events'), TREE, VIDEOS)
    expect(contents.folders.map((f) => f.name)).toEqual(['Day 10', 'UCK26'])
    expect(ids(contents.videos)).toEqual(['event-intro'])
  })

  test('numeric order puts Day 2 before Day 10', () => {
    const tree = [folder('d10', 'Day 10'), folder('d2', 'Day 2')]
    expect(locationContents(ROOT_LOCATION, tree, []).folders.map((f) => f.id)).toEqual([
      'd2',
      'd10',
    ])
  })

  test('a folder entry counts every video below it and its direct subfolders', () => {
    const [events] = locationContents(ROOT_LOCATION, TREE, VIDEOS).folders
    expect(events).toMatchObject({ videoCount: 4, folderCount: 2, path: 'Events' })
    const [uck] = locationContents(folderLocation('events'), TREE, VIDEOS).folders.slice(1)
    expect(uck).toMatchObject({ id: 'uck26', path: 'Events › UCK26', folderCount: 1 })
  })

  test('an orphan pseudo-folder counts the videos carrying its id', () => {
    const orphan = locationContents(ROOT_LOCATION, TREE, VIDEOS).folders[2]
    expect(orphan).toMatchObject({
      id: 'old-event',
      name: 'old-event',
      videoCount: 1,
      folderCount: 0,
    })
    const inside = locationContents(folderLocation('old-event'), TREE, VIDEOS)
    expect(inside.folders).toEqual([])
    expect(ids(inside.videos)).toEqual(['stray'])
  })

  test('before the folders load the root shows only unfiled videos', () => {
    const contents = locationContents(ROOT_LOCATION, null, VIDEOS)
    expect(contents.folders).toEqual([])
    expect(ids(contents.videos)).toEqual(['loose'])
  })
})

describe('folderSummary', () => {
  test('videos and folders, singular and plural', () => {
    expect(folderSummary({ videoCount: 4, folderCount: 2 })).toBe('4 videos · 2 folders')
    expect(folderSummary({ videoCount: 1, folderCount: 1 })).toBe('1 video · 1 folder')
    expect(folderSummary({ videoCount: 0, folderCount: 0 })).toBe('0 videos · 0 folders')
  })
})

describe('breadcrumb', () => {
  test('All videos is its own single crumb', () => {
    expect(breadcrumb(ALL_VIDEOS_LOCATION, TREE)).toEqual([
      { label: 'All videos', location: ALL_VIDEOS_LOCATION, targetId: null },
    ])
  })

  test('the root is Library', () => {
    expect(breadcrumb(ROOT_LOCATION, TREE).map((c) => c.label)).toEqual(['Library'])
  })

  test('a folder is Library, then its ancestors, then itself', () => {
    const crumbs = breadcrumb(folderLocation('day-2'), TREE)
    expect(crumbs.map((c) => c.label)).toEqual(['Library', 'Events', 'UCK26', 'Day 2'])
    expect(crumbs.map((c) => c.targetId)).toEqual([null, 'events', 'uck26', 'day-2'])
    expect(crumbs[1].location).toEqual(folderLocation('events'))
    expect(crumbs[0].location).toEqual(ROOT_LOCATION)
  })

  test('an orphan (or a folder not loaded yet) is named by its id', () => {
    expect(breadcrumb(folderLocation('old-event'), TREE).map((c) => c.label)).toEqual([
      'Library',
      'old-event',
    ])
  })
})

describe('resolveLocation', () => {
  test('a known folder, an orphan, the root and All videos stay', () => {
    for (const location of [
      folderLocation('uck26'),
      folderLocation('old-event'),
      ROOT_LOCATION,
      ALL_VIDEOS_LOCATION,
    ]) {
      expect(resolveLocation(location, TREE, VIDEOS)).toEqual(location)
    }
  })

  test('a folder that no longer exists falls back to the root', () => {
    expect(resolveLocation(folderLocation('deleted'), TREE, VIDEOS)).toEqual(ROOT_LOCATION)
  })

  test('nothing is decided before the folders load', () => {
    expect(resolveLocation(folderLocation('deleted'), null, VIDEOS)).toEqual(
      folderLocation('deleted')
    )
  })
})

describe('search scope', () => {
  test('only a folder offers the This folder | All videos toggle', () => {
    expect(hasScopeToggle(folderLocation('events'))).toBe(true)
    expect(hasScopeToggle(ROOT_LOCATION)).toBe(false)
    expect(hasScopeToggle(ALL_VIDEOS_LOCATION)).toBe(false)
  })

  test('This folder is the folder and every subfolder', () => {
    const scope = searchScopeIds(folderLocation('events'), 'folder', TREE)
    expect([...(scope ?? [])].sort()).toEqual(['day-10', 'day-2', 'events', 'uck26'])
    expect(ids(videosInScope(VIDEOS, scope))).toEqual([
      'keynote',
      'panel',
      'day2-talk',
      'event-intro',
    ])
  })

  test('an orphan scope is its own id', () => {
    expect([...(searchScopeIds(folderLocation('old-event'), 'folder', TREE) ?? [])]).toEqual([
      'old-event',
    ])
  })

  test('All videos, the root and all everywhere search everything', () => {
    expect(searchScopeIds(folderLocation('events'), 'everywhere', TREE)).toBeNull()
    expect(searchScopeIds(ROOT_LOCATION, 'folder', TREE)).toBeNull()
    expect(searchScopeIds(ALL_VIDEOS_LOCATION, 'folder', TREE)).toBeNull()
    expect(ids(videosInScope(VIDEOS, null))).toEqual(ids(VIDEOS))
  })
})

describe('what a location shows', () => {
  test('the Continue hero: all and root, grid, not while searching', () => {
    expect(showsContinueHero(ALL_VIDEOS_LOCATION, 'grid', false)).toBe(true)
    expect(showsContinueHero(ROOT_LOCATION, 'grid', false)).toBe(true)
    expect(showsContinueHero(folderLocation('events'), 'grid', false)).toBe(false)
    expect(showsContinueHero(ROOT_LOCATION, 'list', false)).toBe(false)
    expect(showsContinueHero(ROOT_LOCATION, 'grid', true)).toBe(false)
  })

  test('the Folder column: All videos and search results', () => {
    expect(showsFolderColumn(ALL_VIDEOS_LOCATION, false)).toBe(true)
    expect(showsFolderColumn(ROOT_LOCATION, false)).toBe(false)
    expect(showsFolderColumn(folderLocation('events'), false)).toBe(false)
    expect(showsFolderColumn(folderLocation('events'), true)).toBe(true)
  })

  test('a new folder goes inside the folder on show; the root and All videos make top-level ones', () => {
    expect(parentForNewFolder(folderLocation('events'), TREE)).toBe('events')
    expect(parentForNewFolder(ROOT_LOCATION, TREE)).toBeNull()
    expect(parentForNewFolder(ALL_VIDEOS_LOCATION, TREE)).toBeNull()
    // An orphan is not a real folder: nothing can be created inside it.
    expect(parentForNewFolder(folderLocation('old-event'), TREE)).toBeNull()
  })
})

describe('shownAt', () => {
  const browse = { searching: false, query: '', matchIds: null, scope: 'folder' as const }

  test('browsing shows the location’s folders and videos, counted against themselves', () => {
    const shown = shownAt(folderLocation('events'), TREE, VIDEOS, browse)
    expect(shown.folders.map((f) => f.id)).toEqual(['day-10', 'uck26'])
    expect(ids(shown.videos)).toEqual(['event-intro'])
    expect(shown.total).toBe(1)
  })

  test('a search inside a folder is flat, over the folder and its subfolders', () => {
    const matchIds = new Set(['keynote', 'loose', 'day2-talk'])
    const shown = shownAt(folderLocation('events'), TREE, VIDEOS, {
      searching: true,
      query: 'zzz',
      matchIds,
      scope: 'folder',
    })
    expect(shown.folders).toEqual([])
    expect(ids(shown.videos)).toEqual(['keynote', 'day2-talk'])
    expect(shown.total).toBe(4)
  })

  test('All videos as the scope searches everything', () => {
    const shown = shownAt(folderLocation('events'), TREE, VIDEOS, {
      searching: true,
      query: 'zzz',
      matchIds: new Set(['loose']),
      scope: 'everywhere',
    })
    expect(ids(shown.videos)).toEqual(['loose'])
    expect(shown.total).toBe(VIDEOS.length)
  })

  test('a search at the root covers every video, not just the unfiled ones', () => {
    const shown = shownAt(ROOT_LOCATION, TREE, VIDEOS, {
      searching: true,
      query: 'zzz',
      matchIds: new Set(['keynote']),
      scope: 'folder',
    })
    expect(ids(shown.videos)).toEqual(['keynote'])
  })

  test('before the answer lands a search shows the name matches in its scope', () => {
    const shown = shownAt(folderLocation('uck26'), TREE, VIDEOS, {
      searching: true,
      query: 'KEY',
      matchIds: null,
      scope: 'folder',
    })
    expect(ids(shown.videos)).toEqual(['keynote'])
    expect(shown.total).toBe(3)
  })

  test('a query only a file name matches finds the untitled video, beside the backend hits', () => {
    const untitled = {
      ...video('untitled', 'uck26'),
      title: '',
      sourcePath: '/m/Vizuální-smog.mp4',
    }
    const shown = shownAt(folderLocation('uck26'), TREE, [...VIDEOS, untitled], {
      searching: true,
      query: 'vizualni smog',
      matchIds: new Set(['panel']),
      scope: 'folder',
    })
    expect(ids(shown.videos)).toEqual(['panel', 'untitled'])
  })

  test('a name match outside the search scope stays hidden', () => {
    const shown = shownAt(folderLocation('uck26'), TREE, VIDEOS, {
      searching: true,
      query: 'loose',
      matchIds: null,
      scope: 'folder',
    })
    expect(shown.videos).toEqual([])
  })
})

describe('visibleContents', () => {
  const browse = { searching: false, query: '', matchIds: null, scope: 'folder' as const }
  const byName = { key: 'name', direction: 'asc' } as const
  const resumable = [
    { ...video('b-older', null), updatedAt: '2026-09-01T00:00:00Z', hasProject: true },
    { ...video('a-newest', null), updatedAt: '2026-09-10T00:00:00Z', hasProject: true },
    { ...video('c-plain', null), updatedAt: '2026-09-11T00:00:00Z' },
  ]

  test('at the root in grid: the hero comes out, the rest sorted', () => {
    const shown = shownAt(ROOT_LOCATION, TREE, resumable, browse)
    const out = visibleContents(
      shown,
      ROOT_LOCATION,
      { layout: 'grid', sort: byName },
      false,
      resumable
    )
    expect(out.hero?.id).toBe('a-newest')
    expect(ids(out.videos)).toEqual(['b-older', 'c-plain'])
    expect(out.folders.map((f) => f.id)).toEqual(['events', 'tutorials'])
  })

  test('in list, or while searching, no hero: every video is an item', () => {
    const shown = shownAt(ROOT_LOCATION, TREE, resumable, browse)
    const list = visibleContents(
      shown,
      ROOT_LOCATION,
      { layout: 'list', sort: byName },
      false,
      resumable
    )
    expect(list.hero).toBeNull()
    expect(ids(list.videos)).toEqual(['a-newest', 'b-older', 'c-plain'])
    const searching = visibleContents(
      shown,
      ROOT_LOCATION,
      { layout: 'grid', sort: byName },
      true,
      resumable
    )
    expect(searching.hero).toBeNull()
  })
})
