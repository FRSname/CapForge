/**
 * Static-markup tests (node env, react-dom/server) for the coach mark's card.
 *
 * Its position comes from `lib/tourPlacement.ts`, which is tested on its own;
 * what is pinned here is the content and the footer, including the two things
 * that change on the last step.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Rect } from '../../lib/tourPlacement'
import type { TourStep } from '../../lib/tourSteps'
import { TourPopover } from './TourPopover'

const STEP: TourStep = {
  id: 'sidebar',
  title: 'Where your videos live',
  paragraphs: ['All videos is the flat list.', 'A folder groups an event.'],
  target: 'library-sidebar',
  placement: 'right',
}

const TARGET: Rect = { top: 200, left: 40, width: 220, height: 400 }

interface Overrides {
  step?: TourStep
  target?: Rect | null
  isFirst?: boolean
  isLast?: boolean
  stepNumber?: number
}

function popover(overrides: Overrides = {}): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <TourPopover
      tourTitle="Getting around"
      step={overrides.step ?? STEP}
      stepNumber={overrides.stepNumber ?? 3}
      stepCount={8}
      isFirst={overrides.isFirst ?? false}
      isLast={overrides.isLast ?? false}
      target={overrides.target === undefined ? TARGET : overrides.target}
      onNext={noop}
      onBack={noop}
      onEnd={noop}
      onOpenUrl={noop}
    />
  )
}

describe('TourPopover', () => {
  test('names the tour, the step and its paragraphs', () => {
    const html = popover()
    expect(html).toContain('Getting around')
    expect(html).toContain('Where your videos live')
    expect(html).toContain('All videos is the flat list.')
    expect(html).toContain('A folder groups an event.')
  })

  test('the footer offers Skip tour, Back and Next', () => {
    const html = popover()
    expect(html).toContain('Skip tour')
    expect(html).toContain('>Back<')
    expect(html).toContain('>Next<')
    expect(html).not.toContain('>Done<')
  })

  test('the last step says Done and offers no skip', () => {
    const html = popover({ isLast: true, stepNumber: 8 })
    expect(html).toContain('>Done<')
    expect(html).not.toContain('>Next<')
    expect(html).not.toContain('Skip tour')
  })

  test('Back is disabled on the first step', () => {
    expect(popover({ isFirst: true, stepNumber: 1 })).toMatch(/<button[^>]*disabled[^>]*>Back</)
  })

  test('the rail says where in the tour the user is', () => {
    expect(popover()).toContain('Step 3 of 8')
  })

  test('the card takes pointer events even though the overlay does not', () => {
    expect(popover()).toContain('pointer-events:auto')
  })

  test('the tutorial step carries the player, collapsed', () => {
    const html = popover({
      step: { id: 'welcome', title: 'Welcome', paragraphs: ['Hello.'], tutorial: true },
      target: null,
    })
    expect(html).toContain('Watch the tutorial')
    expect(html).not.toContain('<iframe')
  })

  test('a step without the tutorial flag never mounts the player', () => {
    expect(popover()).not.toContain('Watch the tutorial')
  })

  test('a centred card has no anchor to point at', () => {
    const html = popover({ target: null })
    expect(html).toContain('translate(-50%, -50%)')
  })
})
