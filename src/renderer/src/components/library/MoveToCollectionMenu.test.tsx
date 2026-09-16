/**
 * The card's "Move to folder…" sub-list as static markup: Top level, the
 * folder tree indented with the current folder checked, and "New folder…",
 * which swaps the list for the shared name form.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { MoveToCollectionMenu } from './MoveToCollectionMenu'

const noop = () => {}

function collection(id: string, name: string, parent_id: string | null = null): CollectionSummary {
  return {
    id,
    name,
    slots: {},
    overrides: {} as never,
    createdAt: '',
    updatedAt: '',
    members: 0,
    parent_id,
    total_members: 0,
    path: [name],
  }
}

const COLLECTIONS = [
  collection('uck26', 'UCK 26', 'events'),
  collection('meetup', 'Meetup'),
  collection('events', 'Events'),
]

function render(overrides: Partial<React.ComponentProps<typeof MoveToCollectionMenu>> = {}) {
  return renderToStaticMarkup(
    <MoveToCollectionMenu
      collections={COLLECTIONS}
      currentId="meetup"
      onPick={noop}
      onCreate={() => Promise.resolve({ kind: 'failed' as const })}
      onBack={noop}
      {...overrides}
    />
  )
}

/** The `aria-checked` value of the radio item with this label. */
function checkedOf(html: string, label: string): string | null {
  const items = html.split('role="menuitemradio"').slice(1)
  const item = items.find((chunk) => chunk.includes(`>${label}<`))
  return item?.match(/aria-checked="(true|false)"/)?.[1] ?? null
}

describe('MoveToCollectionMenu', () => {
  test('lists Top level and every folder, the current one checked', () => {
    const html = render()
    expect(checkedOf(html, 'Top level')).toBe('false')
    expect(checkedOf(html, 'UCK 26')).toBe('false')
    expect(checkedOf(html, 'Meetup')).toBe('true')
    expect(html).toContain('New folder…')
    expect(html).not.toContain('Folder name')
    expect(html).not.toMatch(/collection/i)
  })

  test('the tree is in name order, a subfolder indented under its parent with its path', () => {
    const html = render()
    expect(html.indexOf('>Events<')).toBeLessThan(html.indexOf('>UCK 26<'))
    expect(html.indexOf('>UCK 26<')).toBeLessThan(html.indexOf('>Meetup<'))
    expect(html).toContain('title="Events › UCK 26"')
    expect(html).toMatch(
      /padding-left:1\.25rem[^>]*>(<[^>]+>)*<span class="min-w-0 truncate">UCK 26</
    )
  })

  test('a video in no folder has Top level checked', () => {
    expect(checkedOf(render({ currentId: null }), 'Top level')).toBe('true')
  })

  test('offers a way back to the main menu', () => {
    expect(render()).toContain('aria-label="Back to record actions"')
  })

  test('New folder… shows the shared name form in place of the list', () => {
    const html = render({ defaultCreating: true })
    expect(html).toContain('Folder name')
    expect(html).not.toContain('role="menuitemradio"')
  })
})
