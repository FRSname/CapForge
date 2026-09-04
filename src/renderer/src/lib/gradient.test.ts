/**
 * TypeScript half of the gradient core contract.
 *
 * `lib/gradient.ts` is one of **three** implementations of the same grammar and
 * gradient-line formula; the twins are `backend/exporters/gradient.py` (Pillow,
 * the source of truth) and `GRADIENT_RUNTIME_JS` in
 * `backend/exporters/hyperframes_gradient_runtime.py`.
 *
 * All three suites read the same fixture,
 * `backend/tests/fixtures/gradient_cases.json`. Never hand-write an expected
 * value here — add a row to the fixture.
 *
 * Twins of this file: `backend/tests/test_gradient_core.py` and
 * `lib/gradient.embedded.test.ts`.
 */

import { describe, expect, test } from 'vitest'
import {
  GRADIENT_PREFIX,
  MAX_GRADIENT_LENGTH,
  MAX_STOPS,
  MIN_STOPS,
  flatColor,
  flatHex,
  gradientLine,
  gradientToCss,
  parseGradient,
} from './gradient'
import {
  NON_STRING_VALUES,
  REJECTED,
  loadGradientFixtures,
  overLongGradient,
} from './gradientFixtures.testutil'

const fixtures = loadGradientFixtures()
const CLOSE = fixtures.closeDigits

describe('parseGradient', () => {
  test.each(fixtures.parse)('$note', ({ input, expected, note }) => {
    const spec = parseGradient(input)

    if (expected === null) {
      expect(spec, note).toBeNull()
      return
    }

    expect(spec, note).not.toBeNull()
    expect(spec!.angle, note).toBeCloseTo(expected.angle, CLOSE)
    expect(
      spec!.stops.map((s) => [s.offset, s.color]),
      note
    ).toEqual(expected.stops)
  })

  test('rejects an over-long string on length alone', () => {
    expect(MAX_GRADIENT_LENGTH).toBe(fixtures.parseLongInput.maxLength)
    const overLong = overLongGradient()
    expect(overLong.length).toBeGreaterThan(MAX_GRADIENT_LENGTH)
    expect(parseGradient(overLong)).toBeNull()
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) expect(parseGradient(value)).toBeNull()
  })

  test('exposes the shared bounds', () => {
    expect([MIN_STOPS, MAX_STOPS]).toEqual([2, 8])
    expect(GRADIENT_PREFIX).toBe('linear-gradient(')
  })
})

describe('gradientLine', () => {
  test.each(fixtures.line)('$angle deg — $note', ({ angle, box, expected, note }) => {
    const spec = parseGradient(`linear-gradient(${angle}deg, #FF0000 0%, #00FF00 100%)`)
    expect(spec).not.toBeNull()
    const got = gradientLine(spec!, box)
    const axes = ['x0', 'y0', 'x1', 'y1']
    got.forEach((value, i) => {
      expect(value, `${axes[i]}: ${note}`).toBeCloseTo(expected[i], CLOSE)
    })
  })
})

describe('gradientToCss', () => {
  test.each(fixtures.toCss)('$note', ({ input, expected, note }) => {
    const spec = parseGradient(input)
    expect(spec, note).not.toBeNull()
    expect(gradientToCss(spec!), note).toBe(expected)
  })

  test.each(fixtures.toCss)('round-trips back to the same spec — $note', ({ input }) => {
    // The canonical form is inside the grammar: the guard is not one-way.
    const spec = parseGradient(input)
    expect(spec).not.toBeNull()
    expect(parseGradient(gradientToCss(spec!))).toEqual(spec)
  })
})

describe('flatHex', () => {
  test.each(fixtures.flatHex)('$note', ({ input, expected, note }) => {
    expect(flatHex(input, REJECTED), note).toBe(expected === null ? REJECTED : expected)
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) expect(flatHex(value, REJECTED)).toBe(REJECTED)
  })
})

describe('flatColor', () => {
  test.each(fixtures.flatColor)('$note', ({ input, expected, note }) => {
    expect(flatColor(input, REJECTED), note).toBe(expected === null ? REJECTED : expected)
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) expect(flatColor(value, REJECTED)).toBe(REJECTED)
  })
})
