import { describe, expect, test } from 'vitest'
import {
  niceStep,
  nearestSnap,
  computePixelsPerSecond,
  timeToPixel,
  clientXToTime,
  clampScrollT,
  computeAutoPanScrollT,
  computeZoomAtPointer,
  computeWheelScroll,
  clampZoom,
  timeRangeToRect,
} from './timelineMath'

// ── niceStep ─────────────────────────────────────────────────────

describe('niceStep', () => {
  test('picks the smallest step at or above the ideal spacing', () => {
    // duration=100s over 800px -> ideal = 100/(800/80) = 10 -> step 10
    expect(niceStep(100, 800)).toBe(10)
  })

  test('falls back to the largest step when duration is far larger than the widest step', () => {
    expect(niceStep(1_000_000, 100)).toBe(600)
  })

  test('picks a sub-second step for a short, wide timeline', () => {
    // duration=1s over 800px -> ideal = 1/10 = 0.1 -> step 0.1
    expect(niceStep(1, 800)).toBe(0.1)
  })
})

// ── nearestSnap ──────────────────────────────────────────────────

describe('nearestSnap', () => {
  test('returns the closest target within the threshold', () => {
    expect(nearestSnap(10.2, [10, 20], 1)).toBe(10)
  })

  test('returns null when no target is within the threshold', () => {
    expect(nearestSnap(10.2, [20, 30], 1)).toBeNull()
  })

  test('returns null for an empty target list', () => {
    expect(nearestSnap(5, [], 1)).toBeNull()
  })

  test('prefers the nearer of two in-range targets', () => {
    expect(nearestSnap(10.4, [10, 10.5], 1)).toBe(10.5)
  })
})

// ── computePixelsPerSecond / timeToPixel ────────────────────────

describe('computePixelsPerSecond', () => {
  test('divides pixel width by the visible duration', () => {
    expect(computePixelsPerSecond(800, 10)).toBe(80)
  })
})

describe('timeToPixel', () => {
  test('offsets time by the window start and scales by pps', () => {
    expect(timeToPixel(15, 10, 80)).toBe(400)
  })

  test('returns 0 for a time exactly at the window start', () => {
    expect(timeToPixel(10, 10, 80)).toBe(0)
  })
})

// ── clientXToTime ────────────────────────────────────────────────

describe('clientXToTime', () => {
  test('maps the left edge of the rect to scrollT', () => {
    expect(clientXToTime(0, 0, 800, 5, 10)).toBe(5)
  })

  test('maps the right edge of the rect to scrollT + visibleDur', () => {
    expect(clientXToTime(800, 0, 800, 5, 10)).toBe(15)
  })

  test('clamps ratio below 0 when clientX is left of the rect', () => {
    expect(clientXToTime(-100, 0, 800, 5, 10)).toBe(5)
  })

  test('clamps ratio above 1 when clientX is right of the rect', () => {
    expect(clientXToTime(2000, 0, 800, 5, 10)).toBe(15)
  })
})

// ── clampScrollT ─────────────────────────────────────────────────

describe('clampScrollT', () => {
  test('clamps negative scrollT up to 0', () => {
    expect(clampScrollT(-5, 100, 10)).toBe(0)
  })

  test('clamps scrollT so the visible window never exceeds duration', () => {
    expect(clampScrollT(95, 100, 10)).toBe(90)
  })

  test('passes through an in-range scrollT unchanged', () => {
    expect(clampScrollT(50, 100, 10)).toBe(50)
  })

  test('clamps to 0 when visibleDur exceeds duration (zero/short duration edge case)', () => {
    expect(clampScrollT(5, 0, 10)).toBe(0)
  })
})

// ── computeAutoPanScrollT ────────────────────────────────────────

describe('computeAutoPanScrollT', () => {
  test('returns null when the playhead is within the keep-visible window', () => {
    // window [0,10], 85% threshold = 8.5; currentTime=5 is comfortably inside
    expect(computeAutoPanScrollT(5, 0, 100, 10)).toBeNull()
  })

  test('pans forward when the playhead passes the 85% mark of the visible window', () => {
    const result = computeAutoPanScrollT(9, 0, 100, 10)

    // newScrollT = currentTime - visibleDur*0.2 = 9 - 2 = 7
    expect(result).toBe(7)
  })

  test('pans when the playhead is before the current (clamped) scroll position', () => {
    const result = computeAutoPanScrollT(1, 5, 100, 10)

    expect(result).toBe(0)
  })

  test('never returns a negative scrollT even near time 0', () => {
    const result = computeAutoPanScrollT(0.05, 5, 100, 10)

    expect(result).not.toBeNull()
    expect(result as number).toBeGreaterThanOrEqual(0)
  })
})

// ── computeZoomAtPointer ─────────────────────────────────────────

describe('computeZoomAtPointer', () => {
  test('zooms in (increases zoom) on a negative deltaY (wheel up)', () => {
    const result = computeZoomAtPointer(-1, 400, 0, 800, 100, 1, 0)

    expect(result.zoom).toBeCloseTo(1.15, 10)
  })

  test('zooms out (decreases zoom) on a positive deltaY (wheel down)', () => {
    const result = computeZoomAtPointer(1, 400, 0, 800, 100, 2, 0)

    expect(result.zoom).toBeCloseTo(2 / 1.15, 10)
  })

  test('clamps zoom to the floor of 1', () => {
    const result = computeZoomAtPointer(1, 400, 0, 800, 100, 1, 0)

    expect(result.zoom).toBe(1)
  })

  test('clamps zoom to the ceiling of 200', () => {
    const result = computeZoomAtPointer(-1, 400, 0, 800, 100, 200, 0)

    expect(result.zoom).toBe(200)
  })

  test('keeps the time under the cursor fixed after zooming', () => {
    const rectLeft = 0
    const rectWidth = 800
    const clientX = 200 // ratio = 0.25
    const duration = 100
    const currentZoom = 1
    const currentScrollT = 0

    const before = clientXToTime(
      clientX,
      rectLeft,
      rectWidth,
      currentScrollT,
      duration / currentZoom
    )
    const result = computeZoomAtPointer(
      -1,
      clientX,
      rectLeft,
      rectWidth,
      duration,
      currentZoom,
      currentScrollT
    )
    const after = clientXToTime(
      clientX,
      rectLeft,
      rectWidth,
      result.scrollT,
      duration / result.zoom
    )

    expect(after).toBeCloseTo(before, 10)
  })
})

// ── computeWheelScroll ───────────────────────────────────────────

describe('computeWheelScroll', () => {
  test('scrolls forward by 10% of the visible window on positive deltaY', () => {
    // visibleDur = 100/1 = 100, step = 10
    expect(computeWheelScroll(1, 100, 1, 0)).toBe(10)
  })

  test('scrolls backward by 10% of the visible window on negative deltaY', () => {
    expect(computeWheelScroll(-1, 100, 1, 20)).toBe(10)
  })

  test('clamps scroll to 0 on the lower bound', () => {
    expect(computeWheelScroll(-1, 100, 1, 5)).toBe(0)
  })

  test('clamps scroll to duration on the upper bound', () => {
    expect(computeWheelScroll(1, 100, 1, 95)).toBe(100)
  })
})

// ── clampZoom ────────────────────────────────────────────────────

describe('clampZoom', () => {
  test('floors zoom at 1', () => {
    expect(clampZoom(0.2)).toBe(1)
  })

  test('passes through zoom values >= 1 unchanged', () => {
    expect(clampZoom(5)).toBe(5)
  })

  test('floors a negative zoom to 1', () => {
    expect(clampZoom(-10)).toBe(1)
  })
})

// ── timeRangeToRect ──────────────────────────────────────────────

describe('timeRangeToRect', () => {
  // rectLeft=0, rectWidth=800, scrollT=5, pps=80 -> visible window [5,15]
  test('computes x/w for a range fully inside the visible window', () => {
    expect(timeRangeToRect(10, 12, 0, 800, 5, 80)).toEqual({ x: 400, w: 160 })
  })

  test('offsets by a non-zero rectLeft', () => {
    expect(timeRangeToRect(10, 12, 50, 800, 5, 80)).toEqual({ x: 450, w: 160 })
  })

  test('clamps the start edge to rectLeft when startT is scrolled off-screen left', () => {
    expect(timeRangeToRect(2, 6, 0, 800, 5, 80)).toEqual({ x: 0, w: 80 })
  })

  test('clamps the end edge to the right side of the rect when endT overflows', () => {
    expect(timeRangeToRect(14, 20, 0, 800, 5, 80)).toEqual({ x: 720, w: 80 })
  })

  test('returns zero width (never negative) when the range is entirely off-screen right', () => {
    expect(timeRangeToRect(20, 22, 0, 800, 5, 80)).toEqual({ x: 800, w: 0 })
  })

  test('returns zero width (never negative) when the range is entirely off-screen left', () => {
    expect(timeRangeToRect(-5, -2, 0, 800, 5, 80)).toEqual({ x: 0, w: 0 })
  })
})
