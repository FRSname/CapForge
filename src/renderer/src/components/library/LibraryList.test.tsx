/**
 * The library's list view, rendered to static markup (the vitest environment
 * is node, so header clicks are pinned through `toggledSort` in
 * `librarySort.test.ts`). What matters here: the columns, which one carries
 * the sort arrow, the Folder column (with the path) only when asked for,
 * folder rows before the videos, and that a row says what a card says.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { LibrarySort } from '../../lib/librarySort'
import { LIST_THUMB_HEIGHT_PX, LIST_THUMB_WIDTH_PX, LibraryList } from './LibraryList'
import { INERT_LIBRARY_DRAG } from '../../hooks/useLibraryDrag'
import { INERT_FOLDER_ITEM_UI } from './folderItemUi'

function video(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'a'.repeat(32),
    title: 'Keynote',
    sourcePath: '/media/Keynote.mp4',
    duration: 125,
    language: 'en',
    status: 'captioned',
    collection_id: 'uck26',
    scratch: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    missing_media: false,
    hasProject: true,
    poster: false,
    cover: null,
    publishedOn: ['main'],
    ...overrides,
  }
}

const collections: CollectionSummary[] = [
  {
    id: 'events',
    name: 'Events',
    slots: {},
    overrides: {} as never,
    createdAt: '',
    updatedAt: '',
    members: 0,
    parent_id: null,
    total_members: 1,
    path: ['Events'],
  },
  {
    id: 'uck26',
    name: 'UCK 26',
    slots: {},
    overrides: {} as never,
    createdAt: '',
    updatedAt: '',
    members: 1,
    parent_id: 'events',
    total_members: 1,
    path: ['Events', 'UCK 26'],
  },
]

function render(
  props: Partial<React.ComponentProps<typeof LibraryList>> = {},
  sort: LibrarySort = { key: 'modified', direction: 'desc' }
): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <LibraryList
      folders={[]}
      videos={[video()]}
      collections={collections}
      channels={[{ id: 'main', name: 'Main channel' }]}
      showFolder
      sort={sort}
      folderUi={INERT_FOLDER_ITEM_UI}
      drag={INERT_LIBRARY_DRAG}
      onSortChange={noop}
      onRemove={noop}
      onDelete={noop}
      onLocate={() => Promise.resolve({ kind: 'cancelled' as const })}
      onForceLocate={noop}
      onMoveToCollection={noop}
      onCreateCollection={() => Promise.resolve({ kind: 'failed' as const })}
      {...props}
    />
  )
}

/** The `<th>` whose text contains `label`. */
function header(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`)
  return html.slice(html.lastIndexOf('<th', at), html.indexOf('</th>', at))
}

describe('LibraryList columns', () => {
  test('names every column, in order', () => {
    const html = render()
    const order = ['Name', 'Duration', 'Status', 'Folder', 'Published on', 'Modified'].map(
      (label) => html.indexOf(`>${label}<`)
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('the Folder column shows the full path, only when asked for', () => {
    const html = render({ showFolder: true })
    expect(html).toContain('>Folder<')
    expect(html).toContain('>Events › UCK 26<')
    expect(html).not.toMatch(/collection/i)
    const inFolder = render({ showFolder: false })
    expect(inFolder).not.toContain('>Folder<')
    expect(inFolder).not.toContain('UCK 26')
  })

  test('the active sort column carries the arrow and aria-sort; the others do not', () => {
    const html = render({}, { key: 'name', direction: 'asc' })
    expect(header(html, 'Name')).toContain('aria-sort="ascending"')
    expect(header(html, 'Name')).toContain('▲')
    expect(header(html, 'Duration')).not.toContain('aria-sort')
    expect(header(html, 'Modified')).not.toContain('▼')

    const reversed = render({}, { key: 'modified', direction: 'desc' })
    expect(header(reversed, 'Modified')).toContain('aria-sort="descending"')
    expect(header(reversed, 'Modified')).toContain('▼')
  })

  test('sortable headers are buttons; Folder and Published on are not', () => {
    const html = render()
    for (const label of ['Name', 'Duration', 'Status', 'Modified']) {
      expect(header(html, label), label).toContain('<button')
    }
    for (const label of ['Folder', 'Published on']) {
      expect(header(html, label), label).not.toContain('<button')
    }
  })

  test('a sort by date added (no column) marks no header', () => {
    expect(render({}, { key: 'created', direction: 'desc' })).not.toContain('aria-sort')
  })
})

describe('LibraryList rows', () => {
  test('a row carries what a card carries', () => {
    const html = render()
    expect(html).toContain('aria-label="Keynote"')
    expect(html).toContain('>Keynote<')
    expect(html).toContain('2:05')
    expect(html).toContain('Status: captioned')
    expect(html).toContain('>Captioned<')
    expect(html).toContain('>Main channel<')
    expect(html).toContain('aria-label="Actions for Keynote"')
  })

  test('published nowhere and in no folder show a quiet dash', () => {
    const html = render({ videos: [video({ publishedOn: undefined, collection_id: null })] })
    expect(html.split('>—<').length - 1).toBe(2)
  })

  test('video rows drag; the caller hands in the source', () => {
    const drag = { ...INERT_LIBRARY_DRAG, videoSource: () => ({ draggable: true }) }
    expect(render({ drag })).toMatch(/<tr[^>]*draggable="true"/)
    expect(render()).not.toMatch(/<tr[^>]*draggable="true"/)
  })

  test('a record whose media is gone says so', () => {
    expect(render({ videos: [video({ missing_media: true })] })).toContain('Media missing')
  })

  test('one row per video, in the order given (the caller sorts)', () => {
    const html = render({
      videos: [
        video({ id: 'b'.repeat(32), title: 'Second' }),
        video({ id: 'c'.repeat(32), title: 'First' }),
      ],
    })
    expect(html.split('<tr').length - 1).toBe(3) // header + two rows
    expect(html.indexOf('aria-label="Second"')).toBeLessThan(html.indexOf('aria-label="First"'))
  })

  test('the thumbnail is a fixed 16:9 box, letterboxed', () => {
    expect(LIST_THUMB_WIDTH_PX / LIST_THUMB_HEIGHT_PX).toBeCloseTo(16 / 9)
    const html = render()
    expect(html).toContain(`width:${LIST_THUMB_WIDTH_PX}px;height:${LIST_THUMB_HEIGHT_PX}px`)
  })

  test('the table scrolls sideways in its own container', () => {
    const html = render()
    const table = html.indexOf('<table')
    expect(html.slice(html.lastIndexOf('<div', table), table)).toContain('overflow-x-auto')
  })

  test('uses theme tokens, not hardcoded colours', () => {
    expect(render()).not.toMatch(/text-white|bg-black/)
  })
})

describe('LibraryList folder rows', () => {
  const folders = [
    {
      id: 'uck26',
      name: 'UCK 26',
      orphan: false,
      videoCount: 4,
      folderCount: 2,
      path: 'Events › UCK 26',
    },
    {
      id: 'old-event',
      name: 'old-event',
      orphan: true,
      videoCount: 1,
      folderCount: 0,
      path: 'old-event',
    },
  ]

  test('folders come first: glyph, name, count, and their own actions', () => {
    const html = render({ folders })
    expect(html.indexOf('aria-label="Folder UCK 26"')).toBeLessThan(
      html.indexOf('aria-label="Keynote"')
    )
    expect(html).toContain('>4 videos · 2 folders<')
    expect(html).toContain('aria-label="Actions for folder UCK 26"')
    expect(html).toContain('data-folder-glyph="folder"')
    expect(html.split('<tr').length - 1).toBe(4) // header + two folders + one video
  })

  test('an orphan row has the dashed glyph and says no folder has its id', () => {
    const html = render({ folders })
    expect(html).toContain('data-folder-glyph="orphan"')
    expect(html).toContain('No folder has this id')
  })

  test('the summary spans the video columns, one more with the Folder column', () => {
    expect(render({ folders, showFolder: true })).toContain('colSpan="5"')
    expect(render({ folders, showFolder: false })).toContain('colSpan="4"')
  })

  test('a folder being renamed shows its name as an input', () => {
    const html = render({ folders, folderUi: { ...INERT_FOLDER_ITEM_UI, renamingId: 'uck26' } })
    expect(html).toContain('aria-label="Rename folder UCK 26"')
    expect(html).toContain('value="UCK 26"')
    expect(html).not.toContain('aria-label="Folder UCK 26"')
  })
})
