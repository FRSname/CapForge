/**
 * Static-markup tests (node env, react-dom/server) for the overlay root.
 *
 * Measuring a target needs a DOM, which this environment does not have, so
 * what is pinned here is everything that happens before a measurement: no
 * tour means no markup at all, a centred step draws its card immediately, and
 * a step that is still looking for its element draws the scrim but no card,
 * rather than flashing it in the middle of the screen first.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TOURS } from '../../lib/tourSteps'
import { TourOverlay } from './TourOverlay'

const TOUR = TOURS['getting-around']

function overlay(index: number | null): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <TourOverlay
      tour={index === null ? null : TOUR}
      index={index ?? 0}
      onNext={noop}
      onBack={noop}
      onEnd={noop}
      onOpenUrl={noop}
    />
  )
}

describe('TourOverlay', () => {
  test('no tour, no markup', () => {
    expect(overlay(null)).toBe('')
  })

  test('a centred step draws the card without waiting for anything', () => {
    const html = overlay(0)
    expect(html).toContain(TOUR.steps[0].title)
    expect(html).toContain('Getting around')
  })

  test('the root lets clicks through, so the spotlight stays clickable', () => {
    expect(overlay(0)).toContain('pointer-events:none')
  })

  test('a step whose target has not been found yet shows no card', () => {
    const html = overlay(1)
    expect(html).toContain('data-tour-scrim')
    expect(html).not.toContain(TOUR.steps[1].title)
  })

  test('an index past the end draws nothing', () => {
    expect(overlay(TOUR.steps.length)).toBe('')
  })
})
