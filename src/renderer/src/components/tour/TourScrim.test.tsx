/**
 * Static-markup tests (node env, react-dom/server) for the scrim.
 *
 * The one thing worth pinning is why it is four rectangles rather than one
 * with a hole: the spotlighted element has to stay clickable, so nothing may
 * ever be drawn on top of it.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Rect } from '../../lib/tourPlacement'
import { TourScrim } from './TourScrim'

const SPOT: Rect = { top: 100, left: 200, width: 300, height: 50 }

function countPieces(html: string): number {
  return html.split('data-tour-scrim').length - 1
}

describe('TourScrim', () => {
  test('a spotlight is four pieces around the hole, plus the ring', () => {
    const html = renderToStaticMarkup(<TourScrim rect={SPOT} />)
    expect(countPieces(html)).toBe(4)
    expect(html).toContain('var(--color-brand)')
  })

  test('the pieces stop at the edges of the spotlight', () => {
    const html = renderToStaticMarkup(<TourScrim rect={SPOT} />)
    // Above the hole: from the top of the window down to its top edge.
    expect(html).toContain('height:100px')
    // Below it: starting where the hole ends.
    expect(html).toContain('top:150px')
    // Left of it, and right of it.
    expect(html).toContain('width:200px')
    expect(html).toContain('left:500px')
  })

  test('without a rect it is one full scrim and no ring', () => {
    const html = renderToStaticMarkup(<TourScrim rect={null} />)
    expect(countPieces(html)).toBe(1)
    expect(html).not.toContain('var(--color-brand)')
  })

  test('the scrim itself takes pointer events, so clicks outside are blocked', () => {
    const html = renderToStaticMarkup(<TourScrim rect={SPOT} />)
    expect(html).toContain('pointer-events:auto')
  })
})
