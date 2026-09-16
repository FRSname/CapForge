/**
 * A folder tile as static markup: the glyph, name and counts, its `…`, the
 * orphan's look, the drop affordance, and inline rename.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FolderEntry } from '../../lib/libraryLocation'
import { FolderTile } from './FolderTile'
import type { FolderItemUi } from './folderItemUi'
import { INERT_FOLDER_ITEM_UI } from './folderItemUi'

const FOLDER: FolderEntry = {
  id: 'uck26',
  name: 'UCK26',
  orphan: false,
  videoCount: 24,
  folderCount: 1,
  path: 'Events › UCK26',
}

const ORPHAN: FolderEntry = {
  id: 'old-event',
  name: 'old-event',
  orphan: true,
  videoCount: 2,
  folderCount: 0,
  path: 'old-event',
}

function render(folder: FolderEntry = FOLDER, ui: FolderItemUi = INERT_FOLDER_ITEM_UI): string {
  return renderToStaticMarkup(<FolderTile folder={folder} ui={ui} />)
}

describe('FolderTile', () => {
  test('glyph in the brand colour, name, counts, path tooltip and a menu button', () => {
    const html = render()
    expect(html).toContain('data-folder-glyph="folder"')
    expect(html).toContain('fill="var(--color-brand)"')
    expect(html).toContain('>UCK26<')
    expect(html).toContain('>24 videos · 1 folder<')
    expect(html).toContain('title="Events › UCK26"')
    expect(html).toContain('aria-label="Folder UCK26"')
    expect(html).toContain('aria-label="Actions for folder UCK26"')
  })

  test('an orphan is dashed and muted, never dragged', () => {
    const drag = { ...INERT_FOLDER_ITEM_UI.drag, folderSource: () => ({ draggable: true }) }
    const html = render(ORPHAN, { ...INERT_FOLDER_ITEM_UI, drag })
    expect(html).toContain('data-folder-glyph="orphan"')
    expect(html).toContain('stroke-dasharray')
    expect(html).toContain('No folder has this id')
    expect(html).toContain('draggable="false"')
  })

  test('a real folder drags when bound, and wears the accent while a drag is over it', () => {
    const drag = {
      ...INERT_FOLDER_ITEM_UI.drag,
      folderSource: () => ({ draggable: true }),
      target: () => ({ props: {}, over: true }),
    }
    const html = render(FOLDER, { ...INERT_FOLDER_ITEM_UI, drag })
    expect(html).toContain('draggable="true"')
    expect(html).toContain('border-color:var(--color-accent)')
    expect(html).toContain('background:var(--color-accent-subtle)')
  })

  test('renaming turns the name into an input and drops the item button', () => {
    const html = render(FOLDER, { ...INERT_FOLDER_ITEM_UI, renamingId: 'uck26' })
    expect(html).toContain('aria-label="Rename folder UCK26"')
    expect(html).toContain('value="UCK26"')
    expect(html).toContain('maxLength="120"')
    expect(html).not.toContain('aria-label="Folder UCK26"')
  })

  test('uses theme tokens only', () => {
    expect(render()).not.toMatch(/#[0-9a-f]{3,6}\b|text-white|bg-black/i)
  })
})
