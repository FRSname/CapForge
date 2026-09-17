/**
 * The library sidebar as static markup: tree roles, the three kinds of entry
 * (All videos, Unfiled, folders), counts, the orphan glyph, which folders are
 * expanded, the selected location, and "+ New folder".
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryLocation } from '../../lib/libraryLocation'
import { ALL_VIDEOS_LOCATION, ROOT_LOCATION, folderLocation } from '../../lib/libraryLocation'
import { INERT_FOLDER_ITEM_UI } from './folderItemUi'
import type { FolderItemUi } from './folderItemUi'
import { LIBRARY_SIDEBAR_WIDTH_PX, LibrarySidebar } from './LibrarySidebar'
import { folderFixture, libraryVideo as video } from './libraryScreenFixtures.testutil'

const FOLDERS = [
  folderFixture('events', 'Events', null, { members: 1, total: 12 }),
  folderFixture('uck26', 'UCK26', 'events', { members: 11 }),
  folderFixture('tutorials', 'Tutorials'),
]

const VIDEOS = [
  video({ id: '1' }),
  video({ id: '2' }),
  video({ id: '3', collection_id: 'uck26' }),
  video({ id: '4', collection_id: 'old-event' }),
]

function render(
  location: LibraryLocation = ROOT_LOCATION,
  expanded: string[] = [],
  ui: FolderItemUi = INERT_FOLDER_ITEM_UI
): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <LibrarySidebar
      location={location}
      collections={FOLDERS}
      videos={VIDEOS}
      expanded={expanded}
      ui={ui}
      onNavigate={noop}
      onToggleExpanded={noop}
      onCreateFolder={() => Promise.resolve({ kind: 'failed' as const })}
      onFolderCreated={noop}
      newFolderTitle="New top-level folder"
    />
  )
}

/** The opening tag of the treeitem named `name`. */
function item(html: string, name: string): string {
  const at = html.indexOf(`aria-label="${name}"`)
  const start = html.lastIndexOf('<div role="treeitem"', at)
  return html.slice(start, html.indexOf('>', at) + 1)
}

/** The count shown in the treeitem named `name`. */
function countOf(html: string, name: string): string | undefined {
  const at = html.indexOf(`aria-label="${name}"`)
  const rest = html.slice(at, html.indexOf('</div>', at))
  return rest.match(/tabular-nums"[^>]*>(\d+)</)?.[1]
}

describe('LibrarySidebar', () => {
  test('a fixed-width nav holding two trees: the views, and the folders', () => {
    const html = render()
    expect(html).toContain(`width:${LIBRARY_SIDEBAR_WIDTH_PX}px`)
    expect(html.split('role="tree"').length - 1).toBe(2)
    expect(html).toContain('>Folders</p>')
  })

  test('All videos counts every video, Unfiled the ones in no folder, a folder its total', () => {
    const html = render()
    expect(countOf(html, 'All videos')).toBe('4')
    expect(countOf(html, 'Unfiled')).toBe('2')
    expect(item(html, 'Unfiled')).toContain('title="Videos in no folder"')
    expect(countOf(html, 'Events')).toBe('12')
    expect(countOf(html, 'old-event')).toBe('1')
  })

  test('folders are indented under Unfiled by level, collapsed until expanded', () => {
    const collapsed = render()
    expect(item(collapsed, 'Unfiled')).toContain('aria-level="1"')
    expect(item(collapsed, 'Events')).toContain('aria-level="2"')
    expect(item(collapsed, 'Events')).toContain('aria-expanded="false"')
    expect(collapsed).toContain('aria-label="Expand Events"')
    expect(collapsed).not.toContain('aria-label="UCK26"')

    const open = render(ROOT_LOCATION, ['events'])
    expect(item(open, 'Events')).toContain('aria-expanded="true"')
    expect(open).toContain('aria-label="Collapse Events"')
    expect(item(open, 'UCK26')).toContain('aria-level="3"')
  })

  test('a folder with no subfolders has no aria-expanded and no triangle', () => {
    const html = render()
    expect(item(html, 'Tutorials')).not.toContain('aria-expanded')
    expect(html).not.toContain('Expand Tutorials')
  })

  test('the location on show is selected, and revealed when nested', () => {
    expect(item(render(ALL_VIDEOS_LOCATION), 'All videos')).toContain('aria-selected="true"')
    expect(item(render(), 'Unfiled')).toContain('aria-selected="true"')
    const nested = render(folderLocation('uck26'))
    expect(item(nested, 'UCK26')).toContain('aria-selected="true"')
    expect(item(nested, 'Unfiled')).toContain('aria-selected="false"')
  })

  test('every entry is focusable', () => {
    const html = render(ROOT_LOCATION, ['events'])
    const items = html.split('role="treeitem"').length - 1
    expect(html.split('tabindex="0"').length - 1).toBe(items)
  })

  test('an orphan id has the dashed glyph, its id as the label, and is not draggable', () => {
    const html = render()
    const orphan = html.slice(html.indexOf('aria-label="old-event"'))
    expect(orphan.slice(0, orphan.indexOf('</div>'))).toContain('data-folder-glyph="orphan"')
    expect(item(html, 'old-event')).not.toContain('draggable')
  })

  test('real folders drag when the screen binds them', () => {
    const ui = {
      ...INERT_FOLDER_ITEM_UI,
      drag: { ...INERT_FOLDER_ITEM_UI.drag, folderSource: () => ({ draggable: true }) },
    }
    expect(item(render(ROOT_LOCATION, [], ui), 'Events')).toContain('draggable="true"')
  })

  test('a folder being renamed in the sidebar shows an input', () => {
    const html = render(ROOT_LOCATION, [], { ...INERT_FOLDER_ITEM_UI, renamingId: 'tutorials' })
    expect(html).toContain('aria-label="Rename folder Tutorials"')
  })

  test('+ New folder sits at the foot, saying where it creates', () => {
    const html = render()
    expect(html).toContain('>+ New folder<')
    expect(html).toContain('title="New top-level folder"')
    expect(html.indexOf('+ New folder')).toBeGreaterThan(html.indexOf('aria-label="old-event"'))
  })
})
