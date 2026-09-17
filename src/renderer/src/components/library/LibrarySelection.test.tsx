/**
 * The selection as drawn (static markup — the node test environment fires no
 * clicks): the grid is a multi-select listbox of tiles and cards, the list a
 * multi-select grid of rows, and a selected item wears `aria-selected` and the
 * accent. Items no longer open on a single click, so they are named plainly.
 * A video's name turns into an input while it is renamed, and its menu offers
 * Rename.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { INERT_LIBRARY_DRAG } from '../../hooks/useLibraryDrag'
import type { FolderEntry } from '../../lib/libraryLocation'
import { folderKey, videoKey } from '../../lib/librarySelection'
import { InlineNameInput } from './InlineNameInput'
import { INERT_FOLDER_ITEM_UI } from './folderItemUi'
import type { LibraryItemUi } from './libraryItemUi'
import { INERT_LIBRARY_ITEM_UI } from './libraryItemUi'
import { LibraryCardMenu } from './LibraryCardMenu'
import { LibraryGrid } from './LibraryGrid'
import { LibraryList } from './LibraryList'
import { libraryVideo } from './libraryScreenFixtures.testutil'
import { VideoNameInput } from './VideoNameInput'

const noop = () => {}

const KEYNOTE = libraryVideo({ id: 'k'.repeat(32), title: 'Keynote' })
const PANEL = libraryVideo({ id: 'p'.repeat(32), title: 'Panel' })
const EVENTS: FolderEntry = {
  id: 'events',
  name: 'Events',
  orphan: false,
  videoCount: 2,
  folderCount: 0,
  path: 'Events',
}

const ACTIONS = {
  onRemove: noop,
  onDelete: noop,
  onLocate: () => Promise.resolve({ kind: 'cancelled' as const }),
  onForceLocate: noop,
  onMoveToCollection: noop,
  onCreateCollection: () => Promise.resolve({ kind: 'failed' as const }),
}

function selecting(...keys: string[]): LibraryItemUi {
  return { ...INERT_LIBRARY_ITEM_UI, isSelected: (key) => keys.includes(key) }
}

function grid(item: LibraryItemUi = INERT_LIBRARY_ITEM_UI): string {
  return renderToStaticMarkup(
    <LibraryGrid
      folders={[EVENTS]}
      videos={[KEYNOTE, PANEL]}
      collections={[]}
      tileSize={230}
      showFolder={false}
      folderUi={INERT_FOLDER_ITEM_UI}
      drag={INERT_LIBRARY_DRAG}
      item={item}
      {...ACTIONS}
    />
  )
}

function list(item: LibraryItemUi = INERT_LIBRARY_ITEM_UI): string {
  return renderToStaticMarkup(
    <LibraryList
      folders={[EVENTS]}
      videos={[KEYNOTE, PANEL]}
      collections={[]}
      channels={null}
      showFolder={false}
      sort={{ key: 'modified', direction: 'desc' }}
      onSortChange={noop}
      folderUi={INERT_FOLDER_ITEM_UI}
      drag={INERT_LIBRARY_DRAG}
      item={item}
      {...ACTIONS}
    />
  )
}

/** The opening tag of the element carrying this item key. */
function itemTag(html: string, key: string): string {
  const at = html.indexOf(`data-library-item="${key}"`)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

describe('the grid as a listbox', () => {
  test('one multi-select listbox around the folders and the videos', () => {
    const html = grid()
    expect(html.split('role="listbox"').length - 1).toBe(1)
    expect(html).toContain('aria-multiselectable="true"')
    expect(html.indexOf('role="listbox"')).toBeLessThan(html.indexOf('aria-label="Folders"'))
    expect(html).toContain('aria-label="Videos"')
    expect(html.split('data-library-grid=""').length - 1).toBe(2)
  })

  test('every tile and card is an option, in visible order, named plainly', () => {
    const html = grid()
    const keys = [folderKey('events'), videoKey(KEYNOTE.id), videoKey(PANEL.id)]
    const at = keys.map((key) => html.indexOf(`data-library-item="${key}"`))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const key of keys) expect(itemTag(html, key)).toContain('role="option"')
    expect(itemTag(html, videoKey(KEYNOTE.id))).toContain('aria-label="Keynote"')
    expect(itemTag(html, folderKey('events'))).toContain('aria-label="Folder Events"')
    expect(html).not.toContain('aria-label="Open ')
  })

  test('a selected card and tile say so and wear the accent; the others do not', () => {
    const html = grid(selecting(videoKey(PANEL.id), folderKey('events')))
    const panel = itemTag(html, videoKey(PANEL.id))
    expect(panel).toContain('aria-selected="true"')
    expect(panel).toContain('border-color:var(--color-accent)')
    expect(panel).toContain('background:var(--color-accent-subtle)')
    expect(itemTag(html, folderKey('events'))).toContain('aria-selected="true"')
    const keynote = itemTag(html, videoKey(KEYNOTE.id))
    expect(keynote).toContain('aria-selected="false"')
    expect(keynote).not.toContain('--color-accent')
  })
})

describe('the list as a grid', () => {
  test('the table is a multi-select grid whose rows are the items', () => {
    const html = list()
    expect(html).toMatch(/<table role="grid" aria-multiselectable="true"/)
    const row = itemTag(html, videoKey(KEYNOTE.id))
    expect(row.startsWith('<tr')).toBe(true)
    expect(row).toContain('tabindex="0"')
    expect(row).not.toContain('role="option"')
    expect(itemTag(html, folderKey('events')).startsWith('<tr')).toBe(true)
  })

  test('a selected row says so and wears the accent', () => {
    const html = list(selecting(videoKey(KEYNOTE.id)))
    const row = itemTag(html, videoKey(KEYNOTE.id))
    expect(row).toContain('aria-selected="true"')
    expect(row).toContain('background:var(--color-accent-subtle)')
    expect(row).toContain('outline:1px solid var(--color-accent)')
    expect(itemTag(html, videoKey(PANEL.id))).toContain('aria-selected="false"')
  })

  test('the name is no longer a button of its own', () => {
    expect(list()).not.toMatch(/<button[^>]*>Keynote<\/button>/)
  })
})

describe('renaming a video', () => {
  const renaming = { ...INERT_LIBRARY_ITEM_UI, renamingVideoId: KEYNOTE.id }

  test('the card’s name becomes an input, and the card stops dragging', () => {
    const html = grid(renaming)
    expect(html).toContain('aria-label="Rename Keynote"')
    expect(html).toContain('value="Keynote"')
    expect(html).toContain('maxLength="100"')
    expect(itemTag(html, videoKey(KEYNOTE.id)).startsWith('<div')).toBe(true)
    expect(html).not.toContain('aria-label="Actions for Keynote"')
    expect(html).toContain('aria-label="Actions for Panel"')
  })

  test('the row’s name becomes an input', () => {
    const html = list(renaming)
    expect(html).toContain('aria-label="Rename Keynote"')
    expect(itemTag(html, videoKey(KEYNOTE.id))).not.toContain('aria-label="Keynote"')
  })

  test('a refusal shows under the input', () => {
    const html = renderToStaticMarkup(
      <VideoNameInput video={KEYNOTE} item={renaming} defaultError="A video needs a name." />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('A video needs a name.')
    expect(html).toContain('aria-invalid="true"')
  })

  test('the generic input carries its label and cap', () => {
    const html = renderToStaticMarkup(
      <InlineNameInput
        initialName="Day 1"
        label="Rename folder Day 1"
        maxLength={120}
        problem={() => null}
        onSave={() => Promise.resolve({ kind: 'renamed' })}
        onClose={noop}
      />
    )
    expect(html).toContain('aria-label="Rename folder Day 1"')
    expect(html).toContain('value="Day 1"')
    expect(html).not.toContain('role="alert"')
  })
})

describe('opening a video', () => {
  const opening = { ...INERT_LIBRARY_ITEM_UI, openingVideoId: KEYNOTE.id }

  test('the card says it is opening, keeps its box, and only that card', () => {
    const html = grid(opening)
    expect(itemTag(html, videoKey(KEYNOTE.id))).toContain('aria-busy="true"')
    expect(itemTag(html, videoKey(PANEL.id))).toContain('aria-busy="false"')
    expect(html.split('Opening…')).toHaveLength(2)
    expect(html).toContain('data-spinner')
    // The `…` button steps aside for the veil; the other card keeps its own.
    expect(html).not.toContain('aria-label="Actions for Keynote"')
    expect(html).toContain('aria-label="Actions for Panel"')
  })

  test('the row says it in its Status cell', () => {
    const html = list(opening)
    const row = itemTag(html, videoKey(KEYNOTE.id))
    expect(row).toContain('aria-busy="true"')
    expect(html).toContain('Opening…')
    expect(itemTag(html, videoKey(PANEL.id))).toContain('aria-busy="false"')
  })

  test('nothing is opening by default', () => {
    expect(grid()).not.toContain('Opening…')
    expect(list()).not.toContain('Opening…')
  })
})

describe('the record menu', () => {
  function menu(onRename?: () => void): string {
    return renderToStaticMarkup(
      <LibraryCardMenu
        video={KEYNOTE}
        confirmingDelete={false}
        pendingLinkPath={null}
        moving={false}
        collections={[]}
        onRename={onRename}
        onRemove={noop}
        onAskDelete={noop}
        onDelete={noop}
        onCancelDelete={noop}
        onLocate={noop}
        onLink={noop}
        onCancelLink={noop}
        onAskMove={noop}
        onBackFromMove={noop}
        onPickCollection={noop}
        onCreateCollection={() => Promise.resolve({ kind: 'failed' as const })}
      />
    )
  }

  test('offers Rename first, beside the existing items', () => {
    const html = menu(noop)
    expect(html.indexOf('>Rename<')).toBeLessThan(html.indexOf('>Move to folder…<'))
    expect(html).toContain('>Remove from library<')
    expect(html).toContain('>Delete record…<')
  })

  test('without a rename handler, no Rename', () => {
    expect(menu()).not.toContain('>Rename<')
  })
})
