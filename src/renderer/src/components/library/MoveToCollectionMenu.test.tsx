/**
 * The card's "Move to collection…" sub-list as static markup: None, every
 * collection with the current one checked, and "New collection…", which swaps
 * the list for the shared name form.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { MoveToCollectionMenu } from './MoveToCollectionMenu'

const noop = () => {}

function collection(id: string, name: string): CollectionSummary {
  return { id, name, slots: {}, overrides: {} as never, createdAt: '', updatedAt: '', members: 0 }
}

const COLLECTIONS = [collection('uck26', 'UCK 26'), collection('meetup', 'Meetup')]

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
  test('lists None and every collection, the current one checked', () => {
    const html = render()
    expect(checkedOf(html, 'None')).toBe('false')
    expect(checkedOf(html, 'UCK 26')).toBe('false')
    expect(checkedOf(html, 'Meetup')).toBe('true')
    expect(html).toContain('New collection…')
    expect(html).not.toContain('Collection name')
  })

  test('a video in no collection has None checked', () => {
    expect(checkedOf(render({ currentId: null }), 'None')).toBe('true')
  })

  test('offers a way back to the main menu', () => {
    expect(render()).toContain('aria-label="Back to record actions"')
  })

  test('New collection… shows the shared name form in place of the list', () => {
    const html = render({ defaultCreating: true })
    expect(html).toContain('Collection name')
    expect(html).not.toContain('role="menuitemradio"')
  })
})
