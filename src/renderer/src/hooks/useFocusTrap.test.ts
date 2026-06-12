/**
 * Pure-logic tests for the focus trap (vitest runs in plain node — no DOM),
 * covering the Tab-cycle decision function and the focusable query string.
 */

import { describe, expect, test } from 'vitest'
import { FOCUSABLE_SELECTOR, nextTrapIndex } from './useFocusTrap'

describe('nextTrapIndex', () => {
  test('returns null when the container has no focusable elements', () => {
    expect(nextTrapIndex(0, -1, false)).toBeNull()
    expect(nextTrapIndex(0, -1, true)).toBeNull()
  })

  test('Tab on the last element wraps to the first', () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0)
  })

  test('Shift+Tab on the first element wraps to the last', () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2)
  })

  test('mid-container tabbing defers to native focus order', () => {
    expect(nextTrapIndex(3, 1, false)).toBeNull()
    expect(nextTrapIndex(3, 1, true)).toBeNull()
    expect(nextTrapIndex(3, 0, false)).toBeNull()
    expect(nextTrapIndex(3, 2, true)).toBeNull()
  })

  test('focus outside the container is pulled back in', () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0)
    expect(nextTrapIndex(3, -1, true)).toBe(2)
  })

  test('single-element trap always cycles back to itself', () => {
    expect(nextTrapIndex(1, 0, false)).toBe(0)
    expect(nextTrapIndex(1, 0, true)).toBe(0)
  })
})

describe('FOCUSABLE_SELECTOR', () => {
  test('covers the standard interactive elements and excludes tabindex=-1', () => {
    for (const part of ['button', '[href]', 'input', 'select', 'textarea']) {
      expect(FOCUSABLE_SELECTOR).toContain(part)
    }
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})
