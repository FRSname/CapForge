/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the screen produces.
 *
 * What matters: the status a record is at is legible from the card (the rail is
 * cumulative), a record whose media is gone says so, the newest resumable
 * record is promoted out of the grid exactly once, Add to library… and Transcribe… are
 * always reachable, and a portrait poster is not forced into a 16:9 box.
 * Locations, the sidebar and folders: `LibraryScreen.folders.test.tsx`.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_LIBRARY_VIEW_PREFS } from '../../lib/libraryPrefs'
import { LibraryScreen, droppedNotMediaMessage } from './LibraryScreen'
import {
  NOOP_FOLDER_ACTIONS,
  NOOP_SELECTION_ACTIONS,
  libraryVideo,
} from './libraryScreenFixtures.testutil'

const LIT = 'background:var(--color-brand)'

const video = libraryVideo

function render(props: Partial<React.ComponentProps<typeof LibraryScreen>> = {}): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <LibraryScreen
      videos={[]}
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
      {...NOOP_SELECTION_ACTIONS}
      view={DEFAULT_LIBRARY_VIEW_PREFS}
      onViewChange={noop}
      search={{ query: '', matchIds: null }}
      onSearchChange={noop}
      {...props}
    />
  )
}

/** How many pips the rail lit across the whole markup. */
function litPips(html: string): number {
  return html.split(LIT).length - 1
}

describe('LibraryScreen', () => {
  test('an empty library shows the drop affordance, not a grid', () => {
    // Arrange / Act
    const html = render()

    // Assert
    expect(html).toContain('Your library is empty')
    expect(html).toContain('Drop your file here')
    expect(html).toContain('0 videos')
    expect(html).not.toContain('All videos')
  })

  test('the toolbar always offers Transcribe… and Add to library…', () => {
    // Arrange / Act
    const html = render({ videos: [video()] })

    // Assert
    expect(html).toContain('>Transcribe…<')
    expect(html).toContain('>Add to library…<')
  })

  test('the two old import buttons are gone', () => {
    for (const html of [render(), render({ videos: [video()] })]) {
      expect(html).not.toContain('Import folder…')
      expect(html).not.toContain('Import project files…')
      expect(html).not.toContain('Import a folder of recordings…')
    }
  })

  test('shows a card per record with the cumulative status rail', () => {
    // Arrange — three records, none resumable, so none is promoted to the hero.
    const videos = [
      video({ id: 'a'.repeat(32), title: 'Imported one', status: 'imported' }),
      video({ id: 'b'.repeat(32), title: 'Captioned one', status: 'captioned' }),
      video({ id: 'c'.repeat(32), title: 'Published one', status: 'published' }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('3 videos')
    expect(html).toContain('Imported one')
    expect(html).toContain('Captioned one')
    expect(html).toContain('Published one')
    // 0 (imported) + 2 (captioned) + 4 (published)
    expect(litPips(html)).toBe(6)
    expect(html).toContain('Status: captioned')
    expect(html).toContain('aria-label="Published one"')
    expect(html).toContain('Actions for Published one')
    // Duration + language ride along on the card.
    expect(html).toContain('2:05')
    expect(html).toContain('>en<')
  })

  test('promotes the newest resumable record into the Continue hero, once', () => {
    // Arrange
    const videos = [
      video({
        id: 'a'.repeat(32),
        title: 'Older session',
        updatedAt: '2026-09-01T10:00:00Z',
        hasProject: true,
      }),
      video({
        id: 'b'.repeat(32),
        title: 'Newest session',
        updatedAt: '2026-09-12T10:00:00Z',
        hasProject: true,
      }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('Continue Newest session')
    expect(html).toContain('All videos')
    expect(html).toContain('aria-label="Older session"')
    // The hero is the same record promoted, not a second copy of it.
    expect(html).not.toContain('aria-label="Newest session"')
    expect(html.split('Newest session').length - 1).toBe(2) // aria-label + heading
  })

  test('a record whose media is gone says so, and is never the hero', () => {
    // Arrange
    const videos = [
      video({ id: 'a'.repeat(32), title: 'Gone', missing_media: true, hasProject: true }),
    ]

    // Act
    const html = render({ videos })

    // Assert
    expect(html).toContain('Media missing')
    expect(html).toContain('aria-label="Gone"')
    expect(html).not.toContain('Continue Gone')
  })

  test('a record with no duration shows the placeholder instead of NaN', () => {
    // Arrange / Act
    const html = render({ videos: [video({ duration: null })] })

    // Assert
    expect(html).toContain('--:--')
    expect(html).not.toContain('NaN')
  })

  test('Add to library… is reachable with and without records', () => {
    expect(render({ videos: [video()] }).split('>Add to library…<').length - 1).toBe(1)
    // An empty library offers it in the toolbar and again in the empty state.
    const empty = render()
    expect(empty.split('>Add to library…<').length - 1).toBe(2)
    expect(empty.lastIndexOf('>Add to library…<')).toBeGreaterThan(
      empty.indexOf('Your library is empty')
    )
  })

  test('the loading count replaces the total while the list is in flight', () => {
    expect(render({ loading: true })).toContain('loading…')
  })

  test('the rejected-drop message names the file', () => {
    expect(droppedNotMediaMessage('notes.pdf')).toContain('notes.pdf')
  })
})

describe('LibraryScreen toolbar layout', () => {
  const html = render({ videos: [video()] })

  test('the toolbar buttons never wrap their labels', () => {
    for (const label of ['Add to library…', 'Transcribe…']) {
      const button = html.slice(
        html.lastIndexOf('<button', html.indexOf(label)),
        html.indexOf(label)
      )
      expect(button, label).toContain('whitespace-nowrap')
    }
  })

  test('the toolbar wraps as a row, inside the no-drag region', () => {
    const toolbar = html.slice(html.lastIndexOf('<div', html.indexOf('Search the library')))
    expect(toolbar).toMatch(/^<div class="[^"]*app-no-drag[^"]*flex-wrap[^"]*gap-2/)
    expect(html).toMatch(/<header class="[^"]*flex-wrap/)
  })

  test('the collection filter and "No collection" are gone', () => {
    expect(html).not.toContain('Filter by collection')
    expect(html).not.toContain('No collection')
    expect(html).not.toMatch(/collection/i)
  })
})

describe('LibraryScreen posters', () => {
  test('the grid does not stretch a row to its tallest (portrait) card', () => {
    const html = render({ videos: [video({ id: 'a'.repeat(32) }), video({ id: 'b'.repeat(32) })] })
    expect(html).toMatch(/<div class="grid [^"]*items-start/)
  })

  test('the Continue poster has a fixed height and a width from the ratio (16:9 until known)', () => {
    const html = render({ videos: [video({ title: 'Resume me', hasProject: true })] })
    const hero = html.slice(html.indexOf('Continue Resume me'))
    const poster = hero.slice(hero.indexOf('<div class="relative'))
    const tag = poster.slice(0, poster.indexOf('>'))
    expect(tag).toMatch(/height:\d+px/)
    expect(tag).toMatch(/width:\d+px/)
    expect(tag).not.toContain('aspect-ratio')
  })
})

describe('LibraryScreen views', () => {
  const resumable = video({
    id: 'a'.repeat(32),
    title: 'Resume me',
    hasProject: true,
    updatedAt: '2026-09-12T10:00:00Z',
  })
  const other = video({ id: 'b'.repeat(32), title: 'Other one', duration: 30 })
  const videos = [other, resumable]

  test('grid is the default: hero, cards, and the tile size as a CSS variable', () => {
    const html = render({ videos })
    expect(html).toContain('Continue Resume me')
    expect(html).not.toContain('<table')
    expect(html).toMatch(/<div class="grid [^"]*minmax\(var\(--library-tile\),1fr\)[^"]*"/)
    expect(html).toContain('--library-tile:230px')
  })

  test('the icon size reaches the grid', () => {
    const html = render({ videos, view: { ...DEFAULT_LIBRARY_VIEW_PREFS, tileSize: 320 } })
    expect(html).toContain('--library-tile:320px')
  })

  test('the grid follows the chosen sort', () => {
    const html = render({
      videos: [
        video({ id: 'c'.repeat(32), title: 'Zulu' }),
        video({ id: 'd'.repeat(32), title: 'Alpha' }),
      ],
      view: { ...DEFAULT_LIBRARY_VIEW_PREFS, sort: { key: 'name', direction: 'asc' } },
    })
    expect(html.indexOf('aria-label="Alpha"')).toBeLessThan(html.indexOf('aria-label="Zulu"'))
  })

  test('list shows a table with every video, the hero included, and no hero', () => {
    const html = render({ videos, view: { ...DEFAULT_LIBRARY_VIEW_PREFS, layout: 'list' } })
    expect(html).toContain('<table')
    expect(html).not.toContain('Continue Resume me')
    expect(html).toContain('aria-label="Resume me"')
    expect(html).toContain('aria-label="Other one"')
    expect(html).not.toContain('--library-tile')
    // At the Library root every video shown is unfiled: no Folder column.
    expect(html).not.toContain('>Folder<')
  })

  test('list rows follow the sort', () => {
    const html = render({
      videos,
      view: {
        ...DEFAULT_LIBRARY_VIEW_PREFS,
        layout: 'list',
        sort: { key: 'duration', direction: 'asc' },
      },
    })
    expect(html.indexOf('aria-label="Other one"')).toBeLessThan(
      html.indexOf('aria-label="Resume me"')
    )
  })

  test('while searching the hero is hidden and only matches show', () => {
    const html = render({
      videos,
      search: { query: 'other', matchIds: new Set([other.id]) },
    })
    expect(html).not.toContain('Continue Resume me')
    expect(html).not.toContain('aria-label="Resume me"')
    expect(html).toContain('aria-label="Other one"')
    expect(html).toContain('1 of 2 videos')
  })

  test('a search whose result has not landed shows the name matches, without a "no match" line', () => {
    const html = render({ videos, search: { query: 'OTHER', matchIds: null } })
    expect(html).not.toContain('Continue Resume me')
    expect(html).not.toContain('aria-label="Resume me"')
    expect(html).toContain('aria-label="Other one"')

    const none = render({ videos, search: { query: 'zzz', matchIds: null } })
    expect(none).not.toContain('No videos match')
  })

  test('a search with no match says so, naming the query', () => {
    const html = render({ videos, search: { query: 'nothing', matchIds: new Set() } })
    expect(html).toContain('No videos match “nothing”.')
    expect(html).not.toContain('aria-label="Other one"')
  })

  test('a match outside the view does not appear', () => {
    const html = render({ videos, search: { query: 'x', matchIds: new Set(['z'.repeat(32)]) } })
    expect(html).toContain('No videos match “x”.')
  })

  test('the empty library has no search, sort or layout controls', () => {
    const html = render()
    expect(html).not.toContain('Search the library')
    expect(html).not.toContain('aria-label="Layout"')
  })
})
