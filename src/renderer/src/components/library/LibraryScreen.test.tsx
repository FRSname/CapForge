/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the screen produces.
 *
 * What matters: the status a record is at is legible from the card (the rail is
 * cumulative), a record whose media is gone says so, the newest resumable
 * record is promoted out of the grid exactly once, Import… and Add video are
 * always reachable, and a portrait poster is not forced into a 16:9 box.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { LibraryScreen, droppedNotMediaMessage } from './LibraryScreen'

const LIT = 'background:var(--color-brand)'

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a'.repeat(32),
    title: '',
    sourcePath: '/media/Talk.mp4',
    duration: 125,
    language: 'en',
    status: 'imported',
    collection_id: null,
    scratch: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    missing_media: false,
    hasProject: false,
    poster: false,
    cover: null,
    ...overrides,
  }
}

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

  test('the toolbar always offers Add video and Import…', () => {
    // Arrange / Act
    const html = render({ videos: [video()] })

    // Assert
    expect(html).toContain('Add video')
    expect(html).toContain('>Import…<')
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
    expect(html).toContain('Open Published one')
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
    expect(html).toContain('Open Older session')
    // The hero is the same record promoted, not a second copy of it.
    expect(html).not.toContain('Open Newest session')
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
    expect(html).toContain('Open Gone')
    expect(html).not.toContain('Continue Gone')
  })

  test('a record with no duration shows the placeholder instead of NaN', () => {
    // Arrange / Act
    const html = render({ videos: [video({ duration: null })] })

    // Assert
    expect(html).toContain('--:--')
    expect(html).not.toContain('NaN')
  })

  test('Import… is reachable with and without records', () => {
    expect(render({ videos: [video()] }).split('>Import…<').length - 1).toBe(1)
    // An empty library offers it in the toolbar and again in the empty state.
    const empty = render()
    expect(empty.split('>Import…<').length - 1).toBe(2)
    expect(empty.lastIndexOf('>Import…<')).toBeGreaterThan(empty.indexOf('Your library is empty'))
  })

  test('the loading count replaces the total while the list is in flight', () => {
    expect(render({ loading: true })).toContain('loading…')
  })

  test('the rejected-drop message names the file', () => {
    expect(droppedNotMediaMessage('notes.pdf')).toContain('notes.pdf')
  })
})

describe('LibraryScreen collections', () => {
  const collections = [
    {
      id: 'uck26',
      name: 'UCK 26',
      slots: {},
      overrides: {} as never,
      createdAt: '',
      updatedAt: '',
      members: 1,
    },
  ]

  test('the toolbar filters by collection', () => {
    const html = render({ videos: [video({ collection_id: 'uck26' })], collections })

    expect(html).toContain('aria-label="Filter by collection"')
    expect(html).toContain('All videos')
    expect(html).toContain('>UCK 26<')
    expect(html).toContain('No collection')
  })

  test('a card wears its collection chip, named', () => {
    const html = render({ videos: [video({ title: 'Talk', collection_id: 'uck26' })], collections })
    expect(html).toContain('title="Collection: UCK 26"')
  })

  test('a record with no collection has no chip', () => {
    const html = render({ videos: [video()], collections })
    expect(html).not.toContain('title="Collection:')
  })

  test('New collection… sits beside the filter, then Import…, then Add video', () => {
    const html = render({ videos: [video()], collections: [] })
    const filterAt = html.indexOf('Filter by collection')
    const newAt = html.indexOf('New collection…')
    expect(newAt).toBeGreaterThan(filterAt)
    expect(newAt).toBeLessThan(html.indexOf('>Import…<'))
    expect(html.indexOf('>Import…<')).toBeLessThan(html.indexOf('Add video'))
    // Closed until clicked: no form in the markup.
    expect(html).not.toContain('aria-label="Collection name"')
  })

  test('an empty library offers New collection… in the empty state once none exist', () => {
    const html = render({ videos: [], collections: [] })
    expect(html).not.toContain('Filter by collection')
    expect(html.split('New collection…').length - 1).toBe(1)
    expect(html.indexOf('New collection…')).toBeGreaterThan(html.indexOf('Your library is empty'))
  })

  test('an empty library does not offer it before the list loads, or when some exist', () => {
    expect(render({ videos: [], collections: null })).not.toContain('New collection…')
    expect(render({ videos: [], collections })).not.toContain('New collection…')
  })
})

describe('LibraryScreen toolbar layout', () => {
  const html = render({ videos: [video()] })

  test('the toolbar buttons never wrap their labels', () => {
    for (const label of ['Import…', 'Add video', 'New collection…']) {
      const button = html.slice(
        html.lastIndexOf('<button', html.indexOf(label)),
        html.indexOf(label)
      )
      expect(button, label).toContain('whitespace-nowrap')
    }
  })

  test('the toolbar wraps as a row, inside the no-drag region', () => {
    const toolbar = html.slice(html.lastIndexOf('<div', html.indexOf('Filter by collection')))
    expect(toolbar).toMatch(/^<div class="[^"]*app-no-drag[^"]*flex-wrap[^"]*gap-2/)
    expect(html).toMatch(/<header class="[^"]*flex-wrap/)
  })

  test('the filter keeps a bounded width, inline (field-input would override a utility)', () => {
    expect(html).toMatch(/<select[^>]*style="[^"]*width:auto[^"]*max-width:\d/)
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
