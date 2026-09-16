/**
 * The path bar as static markup: every crumb but the last is a button, the
 * last is the heading, and the count sits beside it.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { INERT_LIBRARY_DRAG } from '../../hooks/useLibraryDrag'
import {
  ALL_VIDEOS_LOCATION,
  ROOT_LOCATION,
  breadcrumb,
  folderLocation,
} from '../../lib/libraryLocation'
import { LibraryPathBar } from './LibraryPathBar'
import { folderFixture } from './libraryScreenFixtures.testutil'

const TREE = [folderFixture('events', 'Events'), folderFixture('uck26', 'UCK26', 'events')]

function render(location = ROOT_LOCATION, drag = INERT_LIBRARY_DRAG): string {
  return renderToStaticMarkup(
    <LibraryPathBar
      crumbs={breadcrumb(location, TREE)}
      countLabel="3 videos"
      drag={drag}
      onNavigate={() => {}}
    />
  )
}

describe('LibraryPathBar', () => {
  test('Library › Events › UCK26: two buttons, then the heading', () => {
    const html = render(folderLocation('uck26'))
    expect(html).toContain('>Library</button>')
    expect(html).toContain('>Events</button>')
    expect(html).toMatch(/<h1 aria-current="location"[^>]*>UCK26<\/h1>/)
    expect(html.split('›').length - 1).toBe(2)
    expect(html).toContain('>3 videos<')
  })

  test('the root and All videos are one heading each, with no buttons', () => {
    for (const [location, label] of [
      [ROOT_LOCATION, 'Library'],
      [ALL_VIDEOS_LOCATION, 'All videos'],
    ] as const) {
      const html = render(location)
      expect(html).not.toContain('<button')
      expect(html).toMatch(new RegExp(`<h1[^>]*>${label}</h1>`))
    }
  })

  test('the heading keeps the display face', () => {
    expect(render()).toMatch(/<h1[^>]*font-family:var\(--cf-font-display\)/)
  })

  test('a crumb a drag is over wears the accent', () => {
    const drag = {
      ...INERT_LIBRARY_DRAG,
      target: (targetId: string | null) => ({ props: {}, over: targetId === 'events' }),
    }
    const html = render(folderLocation('uck26'), drag)
    const events = html.slice(html.lastIndexOf('<button', html.indexOf('>Events<')))
    expect(events.slice(0, events.indexOf('>'))).toContain('border-color:var(--color-accent)')
    const library = html.slice(html.lastIndexOf('<button', html.indexOf('>Library<')))
    expect(library.slice(0, library.indexOf('>'))).not.toContain('--color-accent')
  })
})
