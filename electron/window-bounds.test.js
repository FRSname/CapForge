/**
 * Pure-logic tests for window-bounds. Run with the built-in node runner:
 *   node --test electron/window-bounds.test.js
 * No electron required — `main.js` calls `screen.getAllDisplays()` and
 * passes the plain array in; this module only does geometry math on it.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { isBoundsVisibleOnAnyDisplay } = require('./window-bounds')

function display(workArea) {
  return { workArea }
}

test('returns true when the saved bounds fully sit inside a single display', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 }
  const displays = [display({ x: 0, y: 0, width: 1920, height: 1080 })]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), true)
})

test('returns true when the bounds only partially overlap a display', () => {
  // Window mostly off the right edge of a 1920-wide display, but still
  // overlapping by 100px — should still count as "visible".
  const bounds = { x: 1820, y: 100, width: 800, height: 600 }
  const displays = [display({ x: 0, y: 0, width: 1920, height: 1080 })]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), true)
})

test('returns false when the bounds sit entirely off every display (disconnected monitor)', () => {
  const bounds = { x: 3000, y: 3000, width: 800, height: 600 }
  const displays = [display({ x: 0, y: 0, width: 1920, height: 1080 })]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), false)
})

test('returns true when the bounds overlap a second, non-primary display', () => {
  const bounds = { x: 2000, y: 100, width: 800, height: 600 }
  const displays = [
    display({ x: 0, y: 0, width: 1920, height: 1080 }),
    display({ x: 1920, y: 0, width: 1920, height: 1080 }),
  ]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), true)
})

test('returns false when a would-be second display was unplugged', () => {
  const bounds = { x: 2000, y: 100, width: 800, height: 600 }
  const displays = [display({ x: 0, y: 0, width: 1920, height: 1080 })]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), false)
})

test('returns false for an empty displays list', () => {
  const bounds = { x: 100, y: 100, width: 800, height: 600 }
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, []), false)
})

test('touching-edge bounds (zero overlap) count as NOT visible (strict inequality)', () => {
  // Display work area is [0, 1920) — a window starting exactly at x=1920
  // touches the edge but has zero actual overlap.
  const bounds = { x: 1920, y: 0, width: 800, height: 600 }
  const displays = [display({ x: 0, y: 0, width: 1920, height: 1080 })]
  assert.equal(isBoundsVisibleOnAnyDisplay(bounds, displays), false)
})
