/**
 * Pins the **third** gradient implementation: the JS embedded in the HTML/GSAP
 * caption layer (`GRADIENT_RUNTIME_JS` in
 * `backend/exporters/hyperframes_gradient_runtime.py`).
 *
 * That copy is otherwise only exercised inside a headless browser during a
 * HyperFrames render, so without this suite it can silently drift from
 * `lib/gradient.ts` and `backend/exporters/gradient.py` — the same bug class as
 * three drifting ORP tables (`docs/caption-parity.md`). Here the constant is
 * extracted from the Python source, evaluated standalone, and run against the
 * *same fixture* the other two suites use.
 *
 * That the block evaluates at all is itself part of the contract: it must not
 * reference GSAP, `document` or `window`, so the caption runtime can call it
 * while this test calls it from bare node.
 *
 * What this suite deliberately does **not** cover: that the constant is actually
 * spliced into the emitted runtime. It reads the constant from *source*, so
 * dropping the `+ GRADIENT_RUNTIME_JS` term would keep this green — that link is
 * pinned on the Python side, by
 * `test_hyperframes_project.py::test_classic_captions_embed_the_gradient_core`.
 */

import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NON_STRING_VALUES,
  REJECTED,
  loadGradientFixtures,
  overLongGradient,
} from './gradientFixtures.testutil'

const fixtures = loadGradientFixtures()
const CLOSE = fixtures.closeDigits

const SOURCE = join(process.cwd(), 'backend', 'exporters', 'hyperframes_gradient_runtime.py')

/** Shape of the embedded helper object, as consumed here. */
interface EmbeddedGradient {
  PREFIX: string
  MAX_LENGTH: number
  MIN_STOPS: number
  MAX_STOPS: number
  normalizeHex(value: string): string
  flatHex(value: unknown, fallback: string): string
  flatColor(value: unknown, fallback: string): string
  parse(value: unknown): { angle: number; stops: Array<{ offset: number; color: string }> } | null
  line(
    spec: { angle: number },
    box: readonly [number, number, number, number]
  ): [number, number, number, number]
  toCss(spec: { angle: number; stops: Array<{ offset: number; color: string }> }): string
}

/**
 * Pull `GRADIENT_RUNTIME_JS = r"""…"""` out of the Python source. Anchored on
 * the constant name (not a line number) so it survives edits above and below it.
 */
function extractRuntimeJs(): string {
  const py = readFileSync(SOURCE, 'utf8')
  const match = /GRADIENT_RUNTIME_JS = r"""([\s\S]*?)"""/.exec(py)
  if (!match) throw new Error(`GRADIENT_RUNTIME_JS not found in ${SOURCE}`)
  const js = match[1]
  if (!js.includes('toCss')) {
    throw new Error('extracted GRADIENT_RUNTIME_JS does not define toCss')
  }
  return js
}

/** Evaluate the block in isolation — no GSAP, no DOM, no globals injected. */
function loadEmbeddedGradient(): EmbeddedGradient {
  return new Function(`${extractRuntimeJs()}\n; return __capGradient;`)() as EmbeddedGradient
}

const embedded = loadEmbeddedGradient()

describe('embedded gradient runtime (hyperframes_gradient_runtime.py)', () => {
  test('evaluates standalone and exposes the functions plus the bounds', () => {
    expect(typeof embedded.parse).toBe('function')
    expect(typeof embedded.line).toBe('function')
    expect(typeof embedded.toCss).toBe('function')
    expect(typeof embedded.flatHex).toBe('function')
    expect(typeof embedded.flatColor).toBe('function')
    expect(typeof embedded.normalizeHex).toBe('function')
    expect([embedded.MIN_STOPS, embedded.MAX_STOPS]).toEqual([2, 8])
    expect(embedded.PREFIX).toBe('linear-gradient(')
    expect(embedded.MAX_LENGTH).toBe(fixtures.parseLongInput.maxLength)
  })

  test('the block has no GSAP/DOM dependency', () => {
    // Comments stripped first — they legitimately *mention* CSS and the DOM.
    const code = extractRuntimeJs().replace(/\/\/.*$/gm, '')
    for (const forbidden of ['gsap', 'document', 'window', 'tl.']) {
      expect(code.toLowerCase()).not.toContain(forbidden)
    }
  })

  test('every global it defines is __cap-prefixed', () => {
    // The block is spliced into a top-level inline <script> alongside GSAP, the
    // HyperFrames scaffold and (in co-author mode) CLI-installed components, so
    // an unprefixed global like `Gradient` would be a needless collision surface.
    const code = extractRuntimeJs().replace(/\/\/.*$/gm, '')
    const declared = Array.from(
      code.matchAll(/^(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm)
    ).map((m) => m[1])
    expect(declared).toEqual(['__capGradient'])
  })
})

describe('embedded parse', () => {
  test.each(fixtures.parse)('$note', ({ input, expected, note }) => {
    const spec = embedded.parse(input)

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
    expect(embedded.parse(overLongGradient())).toBeNull()
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) expect(embedded.parse(value)).toBeNull()
  })
})

describe('embedded line', () => {
  test.each(fixtures.line)('$angle deg — $note', ({ angle, box, expected, note }) => {
    const spec = embedded.parse(`linear-gradient(${angle}deg, #FF0000 0%, #00FF00 100%)`)
    expect(spec).not.toBeNull()
    const got = embedded.line(spec!, box)
    const axes = ['x0', 'y0', 'x1', 'y1']
    got.forEach((value, i) => {
      expect(value, `${axes[i]}: ${note}`).toBeCloseTo(expected[i], CLOSE)
    })
  })
})

describe('embedded toCss', () => {
  test.each(fixtures.toCss)('$note', ({ input, expected, note }) => {
    const spec = embedded.parse(input)
    expect(spec, note).not.toBeNull()
    expect(embedded.toCss(spec!), note).toBe(expected)
  })

  test.each(fixtures.toCss)('round-trips back to the same spec — $note', ({ input }) => {
    const spec = embedded.parse(input)
    expect(spec).not.toBeNull()
    expect(embedded.parse(embedded.toCss(spec!))).toEqual(spec)
  })
})

describe('embedded flatHex', () => {
  test.each(fixtures.flatHex)('$note', ({ input, expected, note }) => {
    expect(embedded.flatHex(input, REJECTED), note).toBe(
      expected === null ? REJECTED : expected
    )
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) {
      expect(embedded.flatHex(value, REJECTED)).toBe(REJECTED)
    }
  })
})

describe('embedded flatColor', () => {
  test.each(fixtures.flatColor)('$note', ({ input, expected, note }) => {
    expect(embedded.flatColor(input, REJECTED), note).toBe(
      expected === null ? REJECTED : expected
    )
  })

  test('rejects non-strings', () => {
    for (const value of NON_STRING_VALUES) {
      expect(embedded.flatColor(value, REJECTED)).toBe(REJECTED)
    }
  })
})
