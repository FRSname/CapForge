/**
 * The library screen as a Finder window, rendered to static markup: the
 * sidebar beside the main column, the path bar, what All videos, the Library
 * root and a folder show, the search scope toggle, and "Folder" (never
 * "collection") wherever a person reads it.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryLocation } from '../../lib/libraryLocation'
import { ALL_VIDEOS_LOCATION, ROOT_LOCATION, folderLocation } from '../../lib/libraryLocation'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import { DEFAULT_LIBRARY_VIEW_PREFS } from '../../lib/libraryPrefs'
import { LibraryScreen } from './LibraryScreen'
import {
  NOOP_FOLDER_ACTIONS,
  folderFixture,
  libraryVideo as video,
} from './libraryScreenFixtures.testutil'

const FOLDERS = [
  folderFixture('events', 'Events', null, { members: 1, total: 3 }),
  folderFixture('uck26', 'UCK26', 'events', { members: 2 }),
  folderFixture('tutorials', 'Tutorials'),
]

const VIDEOS = [
  video({ id: 'a'.repeat(32), title: 'Loose clip', updatedAt: '2026-09-10T10:00:00Z' }),
  video({ id: 'b'.repeat(32), title: 'Keynote', collection_id: 'uck26', hasProject: true }),
  video({ id: 'c'.repeat(32), title: 'Panel', collection_id: 'uck26' }),
  video({ id: 'd'.repeat(32), title: 'Intro', collection_id: 'events' }),
  video({ id: 'e'.repeat(32), title: 'Stray', collection_id: 'old-event' }),
]

interface RenderOptions {
  location?: LibraryLocation
  view?: Partial<LibraryViewPrefs>
  query?: string
  matchIds?: ReadonlySet<string> | null
  videos?: typeof VIDEOS
  collections?: typeof FOLDERS | null
}

function render(options: RenderOptions = {}): string {
  const noop = () => {}
  const view = {
    ...DEFAULT_LIBRARY_VIEW_PREFS,
    location: options.location ?? ROOT_LOCATION,
    ...options.view,
  }
  return renderToStaticMarkup(
    <LibraryScreen
      videos={options.videos ?? VIDEOS}
      collections={options.collections === undefined ? FOLDERS : options.collections}
      loading={false}
      onOpen={noop}
      onAddVideo={noop}
      onImport={noop}
      onImportDropped={noop}
      onFileDropped={noop}
      onDropRejected={noop}
      onRemove={noop}
      onDelete={noop}
      onLocate={() => Promise.resolve({ kind: 'cancelled' as const })}
      onForceLocate={noop}
      onCreateCollection={() => Promise.resolve({ kind: 'failed' as const })}
      onMoveToCollection={noop}
      onMoveVideos={noop}
      folderActions={NOOP_FOLDER_ACTIONS}
      view={view}
      onViewChange={noop}
      search={{ query: options.query ?? '', matchIds: options.matchIds ?? null }}
      onSearchChange={noop}
    />
  )
}

/** The `<h1>` text: the path bar's last crumb. */
function heading(html: string): string {
  return html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] ?? ''
}

describe('the layout', () => {
  test('a sidebar sits beside the main column', () => {
    const html = render()
    expect(html).toContain('aria-label="Library locations"')
    expect(html).toContain('width:220px')
    expect(html.indexOf('Library locations')).toBeLessThan(html.indexOf('<header'))
  })

  test('the sidebar toggle hides it', () => {
    const html = render({ view: { sidebarCollapsed: true } })
    expect(html).not.toContain('aria-label="Library locations"')
    expect(html).toContain('aria-label="Show sidebar"')
    expect(render()).toContain('aria-label="Hide sidebar"')
  })

  test('an empty library with no folders has no sidebar and no toggle', () => {
    const html = render({ videos: [], collections: [] })
    expect(html).not.toContain('Library locations')
    expect(html).not.toContain('sidebar')
    expect(html).toContain('New folder…')
  })

  test('an empty library that has folders still shows them', () => {
    const html = render({ videos: [] })
    expect(html).toContain('Library locations')
    expect(html).toContain('Your library is empty')
    expect(html).toContain('+ New folder')
  })
})

describe('the Library root', () => {
  const html = render()

  test('is the heading, with the unfiled video count', () => {
    expect(heading(html)).toBe('Library')
    expect(html).toContain('>1 video<')
  })

  test('shows the top-level folders and orphan ids first, then the unfiled videos', () => {
    expect(html).toContain('Open folder Events')
    expect(html).toContain('Open folder Tutorials')
    expect(html).toContain('Open folder old-event')
    expect(html).not.toContain('Open folder UCK26')
    expect(html.indexOf('Open folder Tutorials')).toBeLessThan(html.indexOf('Open Loose clip'))
    expect(html).not.toContain('Open Keynote')
    expect(html).toContain('>3 videos · 1 folder<')
  })

  test('keeps the Continue hero (the last session, wherever it is filed)', () => {
    expect(html).toContain('Continue Keynote')
  })

  test('cards carry no folder chip: everything here is unfiled', () => {
    expect(html).not.toContain('title="Folder:')
  })
})

describe('All videos', () => {
  test('is flat: every video, no folder tiles, the hero', () => {
    const html = render({ location: ALL_VIDEOS_LOCATION })
    expect(heading(html)).toBe('All videos')
    expect(html).not.toContain('Open folder')
    for (const title of ['Loose clip', 'Panel', 'Intro', 'Stray']) {
      expect(html).toContain(`Open ${title}`)
    }
    expect(html).toContain('Continue Keynote')
    expect(html).toContain('>5 videos<')
  })

  test('cards wear their folder, the path in the tooltip', () => {
    const html = render({ location: ALL_VIDEOS_LOCATION })
    expect(html).toContain('title="Folder: Events › UCK26">UCK26<')
    expect(html).toContain('title="Folder: old-event">old-event<')
  })

  test('the list has the Folder column with the full path', () => {
    const html = render({ location: ALL_VIDEOS_LOCATION, view: { layout: 'list' } })
    expect(html).toContain('>Folder<')
    expect(html).toContain('>Events › UCK26<')
  })
})

describe('a folder', () => {
  test('the path bar: Library › Events › UCK26, the last crumb as the heading', () => {
    const html = render({ location: folderLocation('uck26') })
    expect(heading(html)).toBe('UCK26')
    expect(html).toMatch(/<nav aria-label="Path"/)
    expect(html.indexOf('>Library</button>')).toBeLessThan(html.indexOf('>Events</button>'))
    expect(html).toContain('aria-current="location"')
  })

  test('shows its subfolders, then its own videos, and no hero', () => {
    const html = render({ location: folderLocation('events') })
    expect(html).toContain('Open folder UCK26')
    expect(html).toContain('Open Intro')
    expect(html).not.toContain('Open Keynote')
    expect(html.indexOf('Open folder UCK26')).toBeLessThan(html.indexOf('Open Intro'))
    expect(html).not.toContain('Continue ')
  })

  test('list: folder rows first, no Folder column', () => {
    const html = render({ location: folderLocation('events'), view: { layout: 'list' } })
    expect(html.indexOf('Open folder UCK26')).toBeLessThan(html.indexOf('Open Intro'))
    expect(html).not.toContain('>Folder<')
  })

  test('an empty folder says so', () => {
    const html = render({ location: folderLocation('tutorials') })
    expect(html).toContain(
      'This folder is empty — drop videos here, or drag them from another folder.'
    )
    expect(html).toContain('>0 videos<')
  })

  test('an orphan id is a place too, named by its id', () => {
    const html = render({ location: folderLocation('old-event') })
    expect(heading(html)).toBe('old-event')
    expect(html).toContain('Open Stray')
  })

  test('a remembered folder that is gone falls back to the root', () => {
    const html = render({ location: folderLocation('deleted') })
    expect(heading(html)).toBe('Library')
    expect(html).toContain('Open Loose clip')
  })

  test('before the folders load a remembered folder is kept, not reset', () => {
    const html = render({ location: folderLocation('uck26'), collections: null })
    expect(heading(html)).toBe('uck26')
  })
})

describe('search', () => {
  test('inside a folder: the scope toggle, This folder by default, flat results with paths', () => {
    const html = render({
      location: folderLocation('events'),
      query: 'k',
      matchIds: new Set(['b'.repeat(32), 'a'.repeat(32)]),
    })
    expect(html).toContain('aria-label="Search in"')
    expect(html).toMatch(/aria-checked="true"[^>]*>(<[^>]+>)*This folder</)
    expect(html).toContain('>All videos</span>')
    expect(html).not.toContain('Open folder')
    expect(html).toContain('Open Keynote')
    // The loose clip matched too, but it is outside Events.
    expect(html).not.toContain('Open Loose clip')
    expect(html).toContain('title="Folder: Events › UCK26"')
    expect(html).toContain('1 of 3 videos')
    expect(html).toContain('Search results')
  })

  test('no match inside the folder says "in this folder"', () => {
    const html = render({ location: folderLocation('events'), query: 'zzz', matchIds: new Set() })
    expect(html).toContain('No videos in this folder match “zzz”.')
  })

  test('at the root and in All videos there is no toggle: everything is searched', () => {
    for (const location of [ROOT_LOCATION, ALL_VIDEOS_LOCATION]) {
      const html = render({ location, query: 'k', matchIds: new Set(['b'.repeat(32)]) })
      expect(html).not.toContain('aria-label="Search in"')
      expect(html).toContain('Open Keynote')
      expect(html).toContain('1 of 5 videos')
    }
  })

  test('the list shows the Folder column for search results anywhere', () => {
    const html = render({
      location: folderLocation('uck26'),
      query: 'k',
      matchIds: new Set(['b'.repeat(32)]),
      view: { layout: 'list' },
    })
    expect(html).toContain('>Folder<')
  })
})

describe('the words a person reads', () => {
  test('say folder, never collection', () => {
    for (const html of [
      render(),
      render({ location: ALL_VIDEOS_LOCATION, view: { layout: 'list' } }),
      render({ location: folderLocation('events') }),
      render({ videos: [], collections: [] }),
    ]) {
      const text = html.replace(/<[^>]+>/g, ' ')
      expect(text).not.toMatch(/collection/i)
    }
  })
})
