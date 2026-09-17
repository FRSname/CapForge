/**
 * The two resizable columns of the results screen share one rule: a drag on
 * a panel's inner edge changes its width, clamped to its bounds. The editor
 * sits on the left, so dragging right widens it; the aside sits on the right,
 * so dragging left widens it.
 */

import { describe, expect, test } from 'vitest'
import { ASIDE_PANEL_WIDTH, EDITOR_PANEL_WIDTH, resizedWidth } from './panelResize'

describe('resizedWidth', () => {
  const bounds = { min: 100, max: 500, initial: 300 }

  test('a left panel grows as the pointer moves right', () => {
    expect(resizedWidth({ startWidth: 300, startX: 50, clientX: 80, bounds, side: 'left' })).toBe(
      330
    )
    expect(resizedWidth({ startWidth: 300, startX: 50, clientX: 20, bounds, side: 'left' })).toBe(
      270
    )
  })

  test('a right panel grows as the pointer moves left', () => {
    expect(resizedWidth({ startWidth: 300, startX: 50, clientX: 20, bounds, side: 'right' })).toBe(
      330
    )
    expect(resizedWidth({ startWidth: 300, startX: 50, clientX: 80, bounds, side: 'right' })).toBe(
      270
    )
  })

  test('the width never leaves its bounds', () => {
    expect(resizedWidth({ startWidth: 300, startX: 0, clientX: 900, bounds, side: 'left' })).toBe(
      500
    )
    expect(resizedWidth({ startWidth: 300, startX: 0, clientX: -900, bounds, side: 'left' })).toBe(
      100
    )
    expect(resizedWidth({ startWidth: 300, startX: 0, clientX: -900, bounds, side: 'right' })).toBe(
      500
    )
  })

  test('the defaults start inside their own bounds', () => {
    for (const b of [EDITOR_PANEL_WIDTH, ASIDE_PANEL_WIDTH]) {
      expect(b.initial).toBeGreaterThanOrEqual(b.min)
      expect(b.initial).toBeLessThanOrEqual(b.max)
    }
  })
})
