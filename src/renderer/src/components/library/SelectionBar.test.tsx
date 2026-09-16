/**
 * The selection bar and the selection's right-click menu as static markup:
 * the count, Move to…, Remove and Delete, the reason they are disabled while a
 * folder is selected, the inline confirm naming the count, and the picker.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MoveOption } from '../../lib/collectionMove'
import { FOLDERS_BLOCK_BULK } from '../../lib/libraryBulk'
import type { SelectionBarProps } from './SelectionBar'
import { SelectionBar } from './SelectionBar'
import type { SelectionMenuViewProps } from './SelectionMenu'
import { DESELECT_FOLDERS_FIRST, SelectionMenuView } from './SelectionMenu'

const noop = () => {}

const OPTIONS: MoveOption[] = [
  { id: null, label: 'Top level', title: 'Library — in no folder', depth: 0, checked: true },
  { id: 'events', label: 'Events', title: 'Events', depth: 1, checked: false },
]

function bar(overrides: Partial<SelectionBarProps> = {}): string {
  return renderToStaticMarkup(
    <SelectionBar
      count={3}
      videoCount={3}
      blocker={null}
      confirming={null}
      moving={false}
      moveOptions={OPTIONS}
      onToggleMove={noop}
      onCloseMove={noop}
      onPickMove={noop}
      onAsk={noop}
      onConfirm={noop}
      onCancelConfirm={noop}
      onClear={noop}
      {...overrides}
    />
  )
}

/** The opening tag of the `<button>` whose text is `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}</button>`)
  return html.slice(html.lastIndexOf('<button', at), at)
}

describe('SelectionBar', () => {
  test('N selected · Move to… · Remove · Delete… · ✕', () => {
    const html = bar()
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Selection"')
    const order = [
      '3 selected',
      '>Move to…<',
      '>Remove<',
      '>Delete…<',
      'aria-label="Clear selection"',
    ].map((part) => html.indexOf(part))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(buttonTag(html, 'Remove')).not.toContain('disabled')
  })

  test('with a folder selected Remove and Delete are disabled, with the reason', () => {
    const html = bar({ count: 2, videoCount: 1, blocker: FOLDERS_BLOCK_BULK })
    expect(buttonTag(html, 'Remove')).toContain('disabled=""')
    expect(buttonTag(html, 'Delete…')).toContain('disabled=""')
    expect(html).toContain(
      'Folders can&#x27;t be removed — deselect them or delete them from their menu.'
    )
    const reasonId = html.match(/<p id="([^"]+)"/)?.[1]
    expect(reasonId).toBeTruthy()
    expect(buttonTag(html, 'Remove')).toContain(`aria-describedby="${reasonId}"`)
    // Move to… still works for folders.
    expect(buttonTag(html, 'Move to…')).not.toContain('disabled')
  })

  test('Remove asks once, inline, naming the videos it counts', () => {
    const html = bar({ confirming: 'remove', count: 3, videoCount: 3 })
    expect(html).toContain('Remove 3 videos from the library? Their files are kept.')
    expect(html).toContain('>Remove</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).not.toContain('>Move to…<')
  })

  test('Delete asks with the danger button', () => {
    const html = bar({ confirming: 'delete', count: 2, videoCount: 2 })
    expect(html).toContain('Delete 2 videos? Their library folders go to the Trash.')
    expect(buttonTag(html, 'Delete')).toContain('btn-danger')
  })

  test('Move to… opens the folder picker, Top level included', () => {
    const closed = bar()
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('role="menuitemradio"')
    const html = bar({ moving: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Move 3 items to')
    expect(html).toContain('>Top level<')
    expect(html).toContain('>Events<')
  })

  test('uses theme tokens only', () => {
    expect(bar({ blocker: FOLDERS_BLOCK_BULK })).not.toMatch(
      /#[0-9a-f]{3,6}\b|text-white|bg-black/i
    )
  })
})

function menu(overrides: Partial<SelectionMenuViewProps> = {}): string {
  return renderToStaticMarkup(
    <SelectionMenuView
      count={4}
      videoCount={4}
      blocker={null}
      moveOptions={OPTIONS}
      mode="actions"
      onMode={noop}
      onPickMove={noop}
      onConfirm={noop}
      {...overrides}
    />
  )
}

describe('SelectionMenuView', () => {
  test('the bulk actions: Move to…, Remove from library, Delete…', () => {
    const html = menu()
    expect(html).toContain('>Move to…<')
    expect(html).toContain('>Remove from library<')
    expect(html).toContain('>Delete…<')
    expect(html).not.toContain('Rename')
  })

  test('with a folder selected, Remove and Delete are disabled with reasons', () => {
    const html = menu({ blocker: FOLDERS_BLOCK_BULK, videoCount: 1 })
    expect(html.split('disabled=""').length - 1).toBe(2)
    expect(html).toContain('deselect them or delete them from their menu')
    expect(html).toContain(DESELECT_FOLDERS_FIRST)
  })

  test('each confirms inline, naming the count', () => {
    expect(menu({ mode: 'remove' })).toContain('Remove 4 videos from the library?')
    expect(menu({ mode: 'delete' })).toContain('Delete 4 videos?')
  })

  test('a blocked confirm mode never shows its confirm', () => {
    expect(menu({ mode: 'delete', blocker: FOLDERS_BLOCK_BULK })).not.toContain('Delete 4 videos?')
  })

  test('move mode is the folder picker', () => {
    const html = menu({ mode: 'move' })
    expect(html).toContain('Move 4 items to')
    expect(html).toContain('role="menuitemradio"')
  })
})
