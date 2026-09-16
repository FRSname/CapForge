/**
 * Where a coach mark's popover sits next to the thing it points at.
 *
 * Pure geometry, so it is tested directly: the preferred side when it fits,
 * the flip when it does not, the clamp that keeps the card on screen, and the
 * degenerate case of a target bigger than the viewport.
 */

import { describe, expect, test } from 'vitest'
import type { Rect } from './tourPlacement'
import {
  POPOVER_GAP,
  SPOTLIGHT_PADDING,
  VIEWPORT_MARGIN,
  isVisibleRect,
  placePopover,
  spotlightRect,
} from './tourPlacement'

const VIEWPORT = { width: 1200, height: 800 }
const POPOVER = { width: 340, height: 200 }

/** A comfortable target in the middle of the screen: every side fits. */
const CENTRE: Rect = { top: 380, left: 500, width: 200, height: 40 }

describe('spotlightRect', () => {
  test('pads the target on every side', () => {
    expect(spotlightRect({ top: 100, left: 200, width: 50, height: 30 })).toEqual({
      top: 100 - SPOTLIGHT_PADDING,
      left: 200 - SPOTLIGHT_PADDING,
      width: 50 + SPOTLIGHT_PADDING * 2,
      height: 30 + SPOTLIGHT_PADDING * 2,
    })
  })
})

describe('isVisibleRect', () => {
  test('a hidden element measures zero and does not get a spotlight', () => {
    expect(isVisibleRect({ top: 0, left: 0, width: 0, height: 0 })).toBe(false)
    expect(isVisibleRect({ top: 10, left: 10, width: 120, height: 0 })).toBe(false)
  })

  test('anything with area is visible', () => {
    expect(isVisibleRect(CENTRE)).toBe(true)
  })
})

describe('placePopover', () => {
  test('bottom: under the target, centred on it', () => {
    const placed = placePopover(CENTRE, POPOVER, VIEWPORT, 'bottom')
    expect(placed.placement).toBe('bottom')
    expect(placed.top).toBe(CENTRE.top + CENTRE.height + POPOVER_GAP)
    expect(placed.left).toBe(CENTRE.left + CENTRE.width / 2 - POPOVER.width / 2)
  })

  test('top: above the target', () => {
    const placed = placePopover(CENTRE, POPOVER, VIEWPORT, 'top')
    expect(placed.placement).toBe('top')
    expect(placed.top).toBe(CENTRE.top - POPOVER_GAP - POPOVER.height)
  })

  test('right: beside the target, centred vertically', () => {
    const placed = placePopover(CENTRE, POPOVER, VIEWPORT, 'right')
    expect(placed.placement).toBe('right')
    expect(placed.left).toBe(CENTRE.left + CENTRE.width + POPOVER_GAP)
    expect(placed.top).toBe(CENTRE.top + CENTRE.height / 2 - POPOVER.height / 2)
  })

  test('left: on the other side', () => {
    const placed = placePopover(CENTRE, POPOVER, VIEWPORT, 'left')
    expect(placed.placement).toBe('left')
    expect(placed.left).toBe(CENTRE.left - POPOVER_GAP - POPOVER.width)
  })

  test('a target near the bottom flips a bottom preference to the top', () => {
    const low: Rect = { top: 740, left: 500, width: 200, height: 40 }
    const placed = placePopover(low, POPOVER, VIEWPORT, 'bottom')
    expect(placed.placement).toBe('top')
    expect(placed.top).toBe(low.top - POPOVER_GAP - POPOVER.height)
  })

  test('a target against the left edge flips a left preference to the right', () => {
    const edge: Rect = { top: 380, left: 0, width: 220, height: 40 }
    const placed = placePopover(edge, POPOVER, VIEWPORT, 'left')
    expect(placed.placement).toBe('right')
    expect(placed.left).toBe(edge.left + edge.width + POPOVER_GAP)
  })

  test('neither side fits: the other axis is tried before giving up', () => {
    // A full-height column on the left: top and bottom are both impossible.
    const column: Rect = { top: 0, left: 0, width: 220, height: 800 }
    const placed = placePopover(column, POPOVER, VIEWPORT, 'bottom')
    expect(placed.placement).toBe('right')
  })

  test('the card is clamped inside the viewport margins', () => {
    const corner: Rect = { top: 20, left: 0, width: 40, height: 40 }
    const placed = placePopover(corner, POPOVER, VIEWPORT, 'bottom')
    expect(placed.left).toBe(VIEWPORT_MARGIN)
    const farRight: Rect = { top: 20, left: 1180, width: 20, height: 40 }
    const placedRight = placePopover(farRight, POPOVER, VIEWPORT, 'bottom')
    expect(placedRight.left).toBe(VIEWPORT.width - VIEWPORT_MARGIN - POPOVER.width)
  })

  test('a target wider than the viewport still gets a card on screen', () => {
    const huge: Rect = { top: -100, left: -200, width: 2000, height: 1200 }
    const placed = placePopover(huge, POPOVER, VIEWPORT, 'bottom')
    expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
    expect(placed.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
    expect(placed.left + POPOVER.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN)
  })

  test('a popover taller than the viewport is pinned to the top margin', () => {
    const tall = { width: 340, height: 1000 }
    const placed = placePopover(CENTRE, tall, VIEWPORT, 'right')
    expect(placed.top).toBe(VIEWPORT_MARGIN)
  })
})
