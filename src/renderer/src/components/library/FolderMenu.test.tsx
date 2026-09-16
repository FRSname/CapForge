/**
 * A folder's menu as static markup, per mode: the actions with their disabled
 * reasons, the inline delete confirm, Move to…, New folder inside, and the
 * orphan's single item. Also the inline rename's refusal.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { folderMenuModel } from '../../lib/folderMenu'
import type { FolderEntry } from '../../lib/libraryLocation'
import { FolderMenuView } from './FolderMenu'
import { FolderNameInput } from './FolderNameInput'
import { INERT_FOLDER_ITEM_UI } from './folderItemUi'
import { folderFixture } from './libraryScreenFixtures.testutil'

const TREE = [
  folderFixture('events', 'Events'),
  folderFixture('uck26', 'UCK26', 'events', { members: 3 }),
  folderFixture('tutorials', 'Tutorials'),
]

function entry(id: string, orphan = false): FolderEntry {
  const name = TREE.find((f) => f.id === id)?.name ?? id
  return { id, name, orphan, videoCount: 0, folderCount: 0, path: name }
}

function render(
  id: string,
  overrides: Partial<React.ComponentProps<typeof FolderMenuView>> = {}
): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <FolderMenuView
      folder={entry(id)}
      model={folderMenuModel(id, TREE)}
      mode="actions"
      onMode={noop}
      onCreateInside={() => Promise.resolve({ kind: 'failed' as const })}
      onRename={noop}
      onMove={noop}
      onOpenSettings={noop}
      onDelete={noop}
      onAdopt={noop}
      onDone={noop}
      {...overrides}
    />
  )
}

/** The opening tag of the menu item labelled `label`. */
function itemTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`)
  return html.slice(html.lastIndexOf('<button', at), at)
}

describe('FolderMenuView', () => {
  test('the five actions, in order', () => {
    const html = render('tutorials')
    const labels = ['New folder inside…', 'Rename', 'Move to…', 'Folder settings…', 'Delete…']
    const at = labels.map((label) => html.indexOf(`>${label}<`))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(itemTag(html, 'Delete…')).not.toContain('disabled=""')
  })

  test('Delete is disabled with the reason when the folder holds videos', () => {
    const html = render('uck26')
    expect(itemTag(html, 'Delete…')).toContain('disabled=""')
    expect(html).toContain('3 videos belong to this folder')
  })

  test('Delete is disabled with the reason when the folder holds subfolders', () => {
    const html = render('events')
    expect(itemTag(html, 'Delete…')).toContain('disabled=""')
    expect(html).toContain('1 subfolder is inside this folder')
  })

  test('an empty folder confirms delete inline', () => {
    const html = render('tutorials', { mode: 'delete' })
    expect(html).toContain('Delete Tutorials?')
    expect(html).toContain('>Delete<')
    expect(html).toContain('>Cancel<')
  })

  test('the confirm never shows for a folder that cannot be deleted', () => {
    expect(render('uck26', { mode: 'delete' })).not.toContain('Delete UCK26?')
  })

  test('Move to… lists Top level and the legal places by path', () => {
    const html = render('uck26', { mode: 'move' })
    expect(html).toContain('Move UCK26 to')
    expect(html).toContain('>Top level<')
    expect(html).toContain('>Tutorials<')
    expect(html).toMatch(/aria-checked="true"[^>]*>(<[^>]+>)*✓(<[^>]+>)*Events</)
    expect(html).not.toContain('>UCK26<')
  })

  test('New folder inside shows the name form', () => {
    expect(render('events', { mode: 'new' })).toContain('aria-label="Folder name"')
  })

  test('an orphan offers only Create folder', () => {
    const html = render('old-event', { folder: entry('old-event', true), model: null })
    expect(html).toContain('>Create folder<')
    expect(html).not.toContain('Rename')
    expect(html).not.toContain('Delete')
  })

  test('no word of it says collection', () => {
    for (const mode of ['actions', 'move', 'new', 'delete'] as const) {
      const text = render('tutorials', { mode }).replace(/<[^>]+>/g, ' ')
      expect(text).not.toMatch(/collection/i)
    }
  })
})

describe('FolderNameInput', () => {
  test('an empty name is refused inline, under the input', () => {
    const html = renderToStaticMarkup(
      <FolderNameInput
        folder={entry('tutorials')}
        ui={INERT_FOLDER_ITEM_UI}
        defaultError="A folder needs a name."
      />
    )
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('A folder needs a name.')
  })
})
