import { describe, expect, test } from 'vitest'
import {
  quadEaseOut,
  lerp,
  computeAnimationPhase,
  measureTrackedWidth,
  computeRowLineGap,
  splitIntoRows,
  computeRowWidths,
  computeBgBox,
  computeAlignShift,
  computeWordPositions,
  computeWordProgress,
  computeCrossfadeFactors,
  computeBounceAmount,
  hexToRgb,
  lerpColor,
} from './overlayGeometry'

// ── quadEaseOut ──────────────────────────────────────────────────

describe('quadEaseOut', () => {
  test('returns 0 at t=0 and 1 at t=1', () => {
    expect(quadEaseOut(0)).toBe(0)
    expect(quadEaseOut(1)).toBe(1)
  })

  test('returns 0.75 at t=0.5 (1-(1-0.5)^2)', () => {
    const result = quadEaseOut(0.5)

    expect(result).toBeCloseTo(0.75, 10)
  })

  test('clamps values below 0 to the t=0 result', () => {
    expect(quadEaseOut(-5)).toBe(0)
  })

  test('clamps values above 1 to the t=1 result', () => {
    expect(quadEaseOut(5)).toBe(1)
  })
})

// ── lerp ─────────────────────────────────────────────────────────

describe('lerp', () => {
  test('returns a at t=0 and b at t=1', () => {
    expect(lerp(10, 20, 0)).toBe(10)
    expect(lerp(10, 20, 1)).toBe(20)
  })

  test('interpolates midpoint at t=0.5', () => {
    expect(lerp(10, 20, 0.5)).toBe(15)
  })

  test('extrapolates when t is outside [0,1]', () => {
    expect(lerp(0, 10, 2)).toBe(20)
  })
})

// ── computeAnimationPhase ────────────────────────────────────────

describe('computeAnimationPhase', () => {
  test('holds animAlpha=1, slideOffset=0, popScale=1 for an unrecognized animation type', () => {
    const result = computeAnimationPhase(0.1, 0.9, 0.3, 'none', 1080)

    expect(result.animAlpha).toBe(1)
    expect(result.slideOffset).toBe(0)
    expect(result.popScale).toBe(1)
  })

  test('fades in animAlpha from 0 during the entry window', () => {
    const result = computeAnimationPhase(0, 10, 0.3, 'fade', 1080)

    expect(result.animAlpha).toBe(0)
  })

  test('reaches full opacity once past the entry/exit windows', () => {
    const result = computeAnimationPhase(5, 5, 0.3, 'fade', 1080)

    expect(result.animAlpha).toBe(1)
  })

  test('slide animation offsets downward proportional to remaining entry time', () => {
    const result = computeAnimationPhase(0, 10, 0.3, 'slide', 1000)

    // slidePx = 1000*0.04 = 40; entryT=0 -> slideOffset = 40*(1-0) = 40
    expect(result.slideOffset).toBeCloseTo(40, 10)
  })

  test('slide animation offsets upward (negative) proportional to remaining exit time', () => {
    const result = computeAnimationPhase(10, 0, 0.3, 'slide', 1000)

    expect(result.slideOffset).toBeLessThan(0)
  })

  test('pop animation scales up from 0.85 toward 1 during entry', () => {
    const result = computeAnimationPhase(0, 10, 0.3, 'pop', 1080)

    expect(result.popScale).toBeCloseTo(0.85, 10)
  })

  test('pop animation settles at scale 1 once entry has finished', () => {
    const result = computeAnimationPhase(10, 10, 0.3, 'pop', 1080)

    expect(result.popScale).toBe(1)
  })

  test('treats animDur<=0 as an instantly-visible group (entryT=exitT=1)', () => {
    const result = computeAnimationPhase(0, 0, 0, 'fade', 1080)

    expect(result.entryT).toBe(1)
    expect(result.exitT).toBe(1)
    expect(result.animAlpha).toBe(1)
  })
})

// ── measureTrackedWidth ──────────────────────────────────────────

describe('measureTrackedWidth', () => {
  test('returns the raw measured width when tracking is 0', () => {
    const width = measureTrackedWidth('abc', 0, () => 42)

    expect(width).toBe(42)
  })

  test('sums per-character widths plus tracking between characters', () => {
    // "ab" -> char widths 5 each, tracking 2 between them: 5 + 2 + 5 = 12
    const width = measureTrackedWidth('ab', 2, () => 5)

    expect(width).toBe(12)
  })

  test('adds no trailing tracking after the last character', () => {
    // "a" (single char) -> just its own width, no tracking added
    const width = measureTrackedWidth('a', 3, () => 7)

    expect(width).toBe(7)
  })
})

// ── computeRowLineGap ────────────────────────────────────────────

describe('computeRowLineGap', () => {
  test('returns 0 when lineHeight is 1 (no extra gap)', () => {
    expect(computeRowLineGap(20, 1)).toBe(0)
  })

  test('scales proportionally to textH for lineHeight > 1', () => {
    expect(computeRowLineGap(20, 1.2)).toBeCloseTo(4, 10)
  })
})

// ── splitIntoRows ────────────────────────────────────────────────

describe('splitIntoRows', () => {
  const w = (width: number) => ({ width })

  test('keeps all words on one row when total width fits maxW', () => {
    const words = [w(10), w(10), w(10)]

    const rows = splitIntoRows(words, 1, 100, 5)

    expect(rows).toEqual([words])
  })

  test('wraps into multiple rows when total width exceeds maxW', () => {
    const words = [w(30), w(30), w(30)]

    const rows = splitIntoRows(words, 1, 50, 5)

    expect(rows.length).toBeGreaterThan(1)
    expect(rows.flat()).toEqual(words)
  })

  test('never wraps a single word even if it alone exceeds maxW', () => {
    const words = [w(1000)]

    const rows = splitIntoRows(words, 1, 50, 5)

    expect(rows).toEqual([words])
  })

  test('splits into a fixed number of lines when numLines > 1', () => {
    const words = [w(1), w(1), w(1), w(1)]

    const rows = splitIntoRows(words, 2, 1000, 5)

    expect(rows.length).toBe(2)
    expect(rows[0].length).toBe(2)
    expect(rows[1].length).toBe(2)
  })

  test('drops empty trailing rows when numLines exceeds the word count', () => {
    const words = [w(1)]

    const rows = splitIntoRows(words, 3, 1000, 5)

    expect(rows).toEqual([words])
  })
})

// ── computeRowWidths ─────────────────────────────────────────────

describe('computeRowWidths', () => {
  test('sums word widths plus inter-word spacing per row', () => {
    const rows = [[{ width: 10 }, { width: 20 }]]

    const widths = computeRowWidths(rows, 5)

    // 10 + 5 (space) + 20 = 35
    expect(widths).toEqual([35])
  })

  test('adds no spacing for a single-word row', () => {
    const rows = [[{ width: 10 }]]

    const widths = computeRowWidths(rows, 5)

    expect(widths).toEqual([10])
  })
})

// ── computeBgBox ─────────────────────────────────────────────────

describe('computeBgBox', () => {
  test('includes stroke padding on both width and height', () => {
    const result = computeBgBox(100, 8, 3, 0, 1, 20, 0, 8, 0)

    // bgW = 100 + 8*2 + 3*2 + 0 = 122
    expect(result.bgW).toBe(122)
    // totalTextH = 1*20 + 0*0 = 20; bgH = 20 + 8*2 + 3*2 + 0 = 42
    expect(result.totalTextH).toBe(20)
    expect(result.bgH).toBe(42)
  })

  test('stacks totalTextH across multiple rows with the row line gap', () => {
    const result = computeBgBox(100, 8, 0, 0, 3, 20, 4, 8, 0)

    // totalTextH = 3*20 + 2*4 = 68
    expect(result.totalTextH).toBe(68)
  })
})

// ── computeAlignShift ────────────────────────────────────────────

describe('computeAlignShift', () => {
  test('applies no shift for center/middle alignment', () => {
    const result = computeAlignShift('center', 'middle', 40, 40)

    expect(result.alignShiftX).toBe(0)
    expect(result.alignShiftY).toBe(0)
  })

  test('shifts left/top by negative half the extra slack', () => {
    const result = computeAlignShift('left', 'top', 40, 20)

    expect(result.alignShiftX).toBe(-20)
    expect(result.alignShiftY).toBe(-10)
  })

  test('shifts right/bottom by positive half the extra slack', () => {
    const result = computeAlignShift('right', 'bottom', 40, 20)

    expect(result.alignShiftX).toBe(20)
    expect(result.alignShiftY).toBe(10)
  })
})

// ── computeWordPositions ─────────────────────────────────────────

describe('computeWordPositions', () => {
  test('advances the cursor by word width plus space width within a row', () => {
    const rows = [[{ width: 10 }, { width: 20 }]]
    const rowWidths = [35] // 10 + 5(space) + 20

    const { wordXPos, wordYPos } = computeWordPositions(
      rows,
      rowWidths,
      /* cx */ 100,
      /* cy */ 200,
      /* alignShiftX */ 0,
      /* alignShiftY */ 0,
      /* txOff */ 0,
      /* tyOff */ 0,
      /* totalTextH */ 20,
      /* textH */ 20,
      /* rowLineGap */ 0,
      /* effectiveSpaceW */ 5
    )

    // rowY = cy - totalTextH/2 + textH/2 + 0 = 200
    expect(wordYPos).toEqual([200, 200])
    // first word x = cx - rowWidths[0]/2 = 100 - 17.5 = 82.5
    expect(wordXPos[0]).toBeCloseTo(82.5, 10)
    // second word x = first + width(10) + space(5) = 97.5
    expect(wordXPos[1]).toBeCloseTo(97.5, 10)
  })

  test('stacks row Y positions using textH + rowLineGap per row', () => {
    const rows = [[{ width: 10 }], [{ width: 10 }]]
    const rowWidths = [10, 10]

    const { wordYPos } = computeWordPositions(rows, rowWidths, 0, 0, 0, 0, 0, 0, 40, 20, 5, 0)

    // totalTextH=40, textH=20, rowLineGap=5
    // row0 Y = 0 - 20 + 10 + 0 = -10
    // row1 Y = 0 - 20 + 10 + 1*(20+5) = 15
    expect(wordYPos[0]).toBeCloseTo(-10, 10)
    expect(wordYPos[1]).toBeCloseTo(15, 10)
  })
})

// ── computeWordProgress ──────────────────────────────────────────

describe('computeWordProgress', () => {
  test('returns 0 when the word is not active', () => {
    expect(computeWordProgress(5, 0, 1, false)).toBe(0)
  })

  test('returns fractional progress through an active word span', () => {
    expect(computeWordProgress(0.5, 0, 1, true)).toBeCloseTo(0.5, 10)
  })

  test('clamps progress to 1 when currentTime is past the word end', () => {
    expect(computeWordProgress(5, 0, 1, true)).toBe(1)
  })

  test('clamps progress to 0 when currentTime precedes the word start', () => {
    expect(computeWordProgress(-1, 0, 1, true)).toBe(0)
  })
})

// ── computeCrossfadeFactors ──────────────────────────────────────

describe('computeCrossfadeFactors', () => {
  test('fi ramps to 1 once fully past the fade-in duration after start', () => {
    const { fi } = computeCrossfadeFactors(1, 0, 10, 0.06)

    expect(fi).toBe(1)
  })

  test('fo ramps to 1 while well before the fade-out window near end', () => {
    const { fo } = computeCrossfadeFactors(1, 0, 10, 0.06)

    expect(fo).toBe(1)
  })

  test('both factors are mid-ramp exactly at start/end of a symmetric window', () => {
    const { fi, fo } = computeCrossfadeFactors(0.03, 0, 0.06, 0.06)

    expect(fi).toBeCloseTo(0.5, 10)
    expect(fo).toBeCloseTo(0.5, 10)
  })
})

// ── computeBounceAmount ──────────────────────────────────────────

describe('computeBounceAmount', () => {
  test('returns 0 at wordProg=0 and wordProg=1 (sine starts/ends at 0)', () => {
    expect(computeBounceAmount(20, 0.18, 0)).toBe(0)
    expect(computeBounceAmount(20, 0.18, 1)).toBeCloseTo(0, 10)
  })

  test('peaks at textH*strength when wordProg=0.5 (sin(pi/2)=1)', () => {
    const result = computeBounceAmount(20, 0.18, 0.5)

    expect(result).toBeCloseTo(20 * 0.18, 10)
  })
})

// ── hexToRgb / lerpColor ─────────────────────────────────────────

describe('hexToRgb', () => {
  test('parses a #-prefixed hex string into [r,g,b]', () => {
    expect(hexToRgb('#ff0080')).toEqual([255, 0, 128])
  })

  test('parses a hex string without the # prefix', () => {
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0])
  })
})

describe('lerpColor', () => {
  test('returns the first color at t=0', () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], 0)).toBe('rgb(255,0,0)')
  })

  test('returns the second color at t=1', () => {
    expect(lerpColor([255, 0, 0], [0, 0, 255], 1)).toBe('rgb(0,0,255)')
  })

  test('rounds interpolated channel values at t=0.5', () => {
    expect(lerpColor([0, 0, 0], [255, 255, 255], 0.5)).toBe('rgb(128,128,128)')
  })
})
