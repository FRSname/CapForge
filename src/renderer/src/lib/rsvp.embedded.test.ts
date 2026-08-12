/**
 * Pins the **third** RSVP implementation: the JS embedded in the HTML/GSAP
 * caption layer (`RSVP_RUNTIME_JS` in
 * `backend/exporters/hyperframes_rsvp_runtime.py`).
 *
 * That copy is otherwise only exercised inside a headless browser during a
 * HyperFrames render, so without this suite it can silently drift from
 * `lib/rsvp.ts` and `backend/exporters/rsvp.py` — the same bug class as three
 * drifting ORP tables (`docs/caption-parity.md`). Here the constant is extracted
 * from the Python source, evaluated standalone, and run against the *same five
 * fixtures* the other two suites use.
 *
 * That the block evaluates at all is itself part of the contract: the functions
 * must not reference GSAP, `document` or `window`, so Phase 4 can call them from
 * the runtime while this test calls them from bare node.
 *
 * What this suite deliberately does **not** cover: that the constant is actually
 * spliced into the emitted runtime. It reads the constant from *source*, so
 * dropping the `+ RSVP_RUNTIME_JS` term would keep this green — that link is
 * pinned on the Python side, by
 * `test_hyperframes_project.py::test_classic_captions_embed_the_rsvp_core`.
 */

import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RSVP_ORP_TABLE, lastStartedIndex } from './rsvp'
import {
  ASTRAL_CHAR,
  CHAR_W,
  NFD_TOKENS,
  NO_COMPOSITION,
  SWEEP_MAX_LENGTH,
  fixedWidth,
  isCombiningMark,
  loadRsvpFixtures,
} from './rsvpFixtures.testutil'

const {
  orpCases,
  focusOffsetCases,
  focusMeasure,
  focusSlicesCases,
  lastStartedCases,
  lineOffsetCases,
  CLOSE_DIGITS,
} = loadRsvpFixtures()

const SOURCE = join(process.cwd(), 'backend', 'exporters', 'hyperframes_rsvp_runtime.py')

/** Shape of the embedded helper object, as consumed here. */
interface EmbeddedRsvp {
  ORP_TABLE: Array<{ maxLength: number; index: number }>
  codePoints(token: string): string[]
  orpIndex(token: string): number
  focusSlices(token: string, f: number): { prefix: string; focus: string; suffix: string }
  focusOffset(wordX: number, token: string, f: number, measure: (s: string) => number): number
  lastStartedIndex(
    t: number,
    words: ReadonlyArray<{ start: number; end: number }>,
    count?: number | null
  ): number
  lineOffsetAt(
    t: number,
    words: ReadonlyArray<{ start: number; end: number }>,
    focusOffsets: readonly number[],
    pivotPx: number,
    slideDuration: number
  ): number
}

/**
 * Pull `RSVP_RUNTIME_JS = r"""…"""` out of the Python source. Anchored on the
 * constant name (not a line number) so it survives edits above and below it.
 */
function extractRuntimeJs(): string {
  const py = readFileSync(SOURCE, 'utf8')
  const match = /RSVP_RUNTIME_JS = r"""([\s\S]*?)"""/.exec(py)
  if (!match) throw new Error(`RSVP_RUNTIME_JS not found in ${SOURCE}`)
  const js = match[1]
  if (!js.includes('lineOffsetAt')) {
    throw new Error('extracted RSVP_RUNTIME_JS does not define lineOffsetAt')
  }
  return js
}

/** Evaluate the block in isolation — no GSAP, no DOM, no globals injected. */
function loadEmbeddedRsvp(): EmbeddedRsvp {
  const js = extractRuntimeJs()
  return new Function(`${js}\n; return __capRsvp;`)() as EmbeddedRsvp
}

const embedded = loadEmbeddedRsvp()

describe('embedded RSVP runtime (hyperframes_rsvp_runtime.py)', () => {
  test('evaluates standalone and exposes the functions plus the table', () => {
    expect(typeof embedded.codePoints).toBe('function')
    expect(typeof embedded.orpIndex).toBe('function')
    expect(typeof embedded.focusSlices).toBe('function')
    expect(typeof embedded.focusOffset).toBe('function')
    expect(typeof embedded.lastStartedIndex).toBe('function')
    expect(typeof embedded.lineOffsetAt).toBe('function')
    expect(Array.isArray(embedded.ORP_TABLE)).toBe(true)
  })

  test('the block has no GSAP/DOM dependency', () => {
    // Comments stripped first — they legitimately *mention* GSAP's ease names.
    const code = extractRuntimeJs().replace(/\/\/.*$/gm, '')
    for (const forbidden of ['gsap', 'document', 'window', 'tl.']) {
      expect(code.toLowerCase()).not.toContain(forbidden)
    }
  })

  test('every global it defines is __cap-prefixed', () => {
    // The block is spliced into a top-level inline <script> alongside GSAP, the
    // HyperFrames scaffold and (in co-author mode) CLI-installed components, so an
    // unprefixed global like `RSVP` would be a needless collision surface.
    const code = extractRuntimeJs().replace(/\/\/.*$/gm, '')
    // Column 0 only: locals inside the methods are indented and are not globals.
    const declared = Array.from(
      code.matchAll(/^(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm)
    ).map((m) => m[1])
    expect(declared).toEqual(['__capRsvp'])
    for (const name of declared) expect(name.startsWith('__cap')).toBe(true)
  })

  test('its ORP table equals the shared table exported by lib/rsvp.ts', () => {
    // Derived from the TS twin rather than restated as a literal, so this is a real
    // cross-copy drift check: editing one table without the other fails here.
    expect(embedded.ORP_TABLE).toEqual(
      RSVP_ORP_TABLE.map((bp) => ({ maxLength: bp.maxLength, index: bp.index }))
    )
    expect(embedded.ORP_TABLE[embedded.ORP_TABLE.length - 1].maxLength).toBe(Infinity)
  })

  test.each(orpCases.map((c) => [c.token, c.index] as const))(
    'orpIndex(%j) === %i',
    (token, index) => {
      expect(embedded.orpIndex(token)).toBe(index)
    }
  )

  test(`orpIndex agrees with its own table for every length up to ${SWEEP_MAX_LENGTH}`, () => {
    for (let len = 0; len <= SWEEP_MAX_LENGTH; len++) {
      const token = 'x'.repeat(len)
      if (len === 0) {
        expect(embedded.orpIndex(token)).toBe(0)
        continue
      }
      const row = embedded.ORP_TABLE.find((bp) => len <= bp.maxLength)
      expect(embedded.orpIndex(token)).toBe(Math.min(Math.max(row!.index, 0), len - 1))
    }
  })

  test('orpIndex counts code points, not UTF-16 code units', () => {
    // Astral chars double the code-unit length; the focus index must not move.
    for (let len = 0; len <= SWEEP_MAX_LENGTH; len++) {
      expect(embedded.orpIndex(ASTRAL_CHAR.repeat(len))).toBe(embedded.orpIndex('x'.repeat(len)))
    }
  })

  test('codePoints keeps astral glyphs and lone surrogates whole', () => {
    expect(embedded.codePoints('a🎬b')).toEqual(['a', '🎬', 'b'])
    expect(embedded.codePoints('a\ud83cb')).toEqual(['a', '\ud83c', 'b'])
    // The embedded copy is the only one whose callers are untyped, so nullish
    // input must not throw inside the runtime.
    expect(embedded.codePoints(undefined as unknown as string)).toEqual([])
  })

  test('codePoints NFC-composes the token, like both twins', () => {
    for (const decomposed of NFD_TOKENS) {
      expect(embedded.codePoints(decomposed)).toEqual(Array.from(decomposed.normalize('NFC')))
    }
  })

  test.each(NFD_TOKENS)('NFD and NFC spellings of %j are indistinguishable', (decomposed) => {
    // Without the NFC pin the focus glyph can be a bare combining mark, which this
    // runtime draws on a dotted circle (U+25CC) while Pillow draws the mark alone.
    const composed = decomposed.normalize('NFC')
    expect(composed).not.toBe(decomposed)

    expect(embedded.orpIndex(decomposed)).toBe(embedded.orpIndex(composed))
    expect(embedded.focusSlices(decomposed, embedded.orpIndex(decomposed))).toEqual(
      embedded.focusSlices(composed, embedded.orpIndex(composed))
    )
    expect(embedded.focusOffset(0, decomposed, embedded.orpIndex(decomposed), fixedWidth)).toBe(
      embedded.focusOffset(0, composed, embedded.orpIndex(composed), fixedWidth)
    )
    expect(
      isCombiningMark(embedded.focusSlices(decomposed, embedded.orpIndex(decomposed)).focus)
    ).toBe(false)
  })

  test('a mark with no precomposed form is the documented residual', () => {
    // ACCEPTED DELTA: U+0348 has no composition, so the focus glyph really is the
    // mark. Pinned in all three suites so the residual is known, not a surprise.
    expect(NO_COMPOSITION.normalize('NFC')).toBe(NO_COMPOSITION)
    const focus = embedded.focusSlices(NO_COMPOSITION, embedded.orpIndex(NO_COMPOSITION)).focus
    expect(isCombiningMark(focus)).toBe(true)
  })

  // Shared prefix/focus/suffix split cases, incl. astral + unpaired surrogate.
  test.each(focusSlicesCases.map((c) => [c.name, c] as const))(
    'focusSlices fixture — %s',
    (_name, c) => {
      const f = c.f === null ? embedded.orpIndex(c.token) : c.f
      expect(embedded.focusSlices(c.token, f)).toEqual({
        prefix: c.prefix,
        focus: c.focus,
        suffix: c.suffix,
      })
    }
  )

  test('focusSlices rebuilds every fixture token and handles the degenerate inputs', () => {
    for (const { token, f } of focusSlicesCases) {
      const i = f === null ? embedded.orpIndex(token) : f
      const s = embedded.focusSlices(token, i)
      // The pieces rebuild the token's NFC form (which for an already-composed
      // token — every case but the NFD ones — is the token itself).
      expect(s.prefix + s.focus + s.suffix).toBe(token.normalize('NFC'))
    }
    expect(embedded.focusSlices('', 0)).toEqual({ prefix: '', focus: '', suffix: '' })
    for (const junk of ['', null, undefined, '2', {}, []] as unknown[]) {
      expect(embedded.focusSlices('the', junk as number)).toEqual({
        prefix: '',
        focus: 't',
        suffix: 'he',
      })
    }
  })

  test('focusOffset centres on the focus glyph, and clamps out-of-range f', () => {
    expect(embedded.focusOffset(100, 'the', 1, fixedWidth)).toBe(100 + CHAR_W + CHAR_W / 2)
    expect(embedded.focusOffset(0, 'the', 9, fixedWidth)).toBe(2 * CHAR_W + CHAR_W / 2)
    expect(embedded.focusOffset(0, 'the', -3, fixedWidth)).toBe(CHAR_W / 2)
    expect(embedded.focusOffset(0, 'the', NaN, fixedWidth)).toBe(CHAR_W / 2)
    expect(embedded.focusOffset(42, '', 0, fixedWidth)).toBe(42)
  })

  test('focusOffset treats a non-numeric f like the TS twin (Number.isFinite)', () => {
    // Global isFinite() coerces: isFinite('') and isFinite(null) are BOTH true, so
    // Math.trunc would produce 0 by accident and any other string would produce
    // NaN -> a NaN offset. Number.isFinite rejects all of them up front, which is
    // what `lib/rsvp.ts` does.
    for (const junk of ['', null, undefined, '2', {}, []] as unknown[]) {
      expect(embedded.focusOffset(0, 'the', junk as number, fixedWidth)).toBe(CHAR_W / 2)
    }
  })

  // Shared focus-offset cases, incl. astral + unpaired surrogate.
  test.each(focusOffsetCases.map((c) => [c.name, c] as const))(
    'focusOffset fixture — %s',
    (_name, c) => {
      const f = c.f === null ? embedded.orpIndex(c.token) : c.f
      expect(embedded.focusOffset(c.wordX, c.token, f, focusMeasure)).toBeCloseTo(
        c.expected,
        CLOSE_DIGITS
      )
    }
  )

  // The anchor both the line's position and the HTML layer's colouring read — the
  // same shared fixture the TS and Python suites assert against.
  test.each(lastStartedCases.map((c) => [c.name, c] as const))(
    'lastStartedIndex — %s',
    (_name, c) => {
      // `count: null` means "omit the argument" (the Python twin's `None`).
      const actual =
        c.count === null
          ? embedded.lastStartedIndex(c.t, c.words)
          : embedded.lastStartedIndex(c.t, c.words, c.count)
      expect(actual).toBe(c.expected)
    }
  )

  test('lastStartedIndex reads an explicit null count as "all of them"', () => {
    // This copy's callers are untyped, so a null must mean Python's `None` rather
    // than `Math.min(null, len) === 0`. The TS twin does the same.
    for (const c of lastStartedCases) {
      expect(embedded.lastStartedIndex(c.t, c.words, null)).toBe(
        embedded.lastStartedIndex(c.t, c.words)
      )
    }
  })

  test('lastStartedIndex agrees with lib/rsvp.ts outside the fixture too', () => {
    // A real cross-copy drift check between the two JS twins, over a t sweep on the
    // inputs where this rule and `start <= t < end` disagree: reordered starts and
    // overlapping timings. Derived from the TS twin rather than restated.
    const groups = [
      [
        { start: 1.5, end: 2.0 },
        { start: 1.0, end: 1.5 },
      ],
      [
        { start: 1.0, end: 1.6 },
        { start: 1.5, end: 2.0 },
      ],
      [
        { start: 0.0, end: 0.5 },
        { start: 0.5, end: 1.0 },
        { start: 1.2, end: 1.7 },
      ],
    ]
    for (const words of groups) {
      for (let i = -10; i <= 250; i += 5) {
        const t = i / 100
        for (const count of [undefined, null, 0, 1, words.length, 99] as Array<
          number | null | undefined
        >) {
          expect(embedded.lastStartedIndex(t, words, count)).toBe(lastStartedIndex(t, words, count))
        }
      }
    }
  })

  test('lastStartedIndex is the anchor lineOffsetAt parks the line on', () => {
    // Derived, not restated: with the slide off, lineOffsetAt is exactly
    // `pivot - focusOffsets[lastStartedIndex(...)]`, so this copy cannot place the
    // line by one rule and colour by another.
    for (const c of lineOffsetCases) {
      const count = Math.min(c.words.length, c.focusOffsets.length)
      if (count === 0) continue
      const active = embedded.lastStartedIndex(c.t, c.words, count)
      expect(embedded.lineOffsetAt(c.t, c.words, c.focusOffsets, c.pivotPx, 0)).toBeCloseTo(
        c.pivotPx - c.focusOffsets[active],
        CLOSE_DIGITS
      )
    }
  })

  test.each(lineOffsetCases.map((c) => [c.name, c] as const))('lineOffsetAt — %s', (_name, c) => {
    const actual = embedded.lineOffsetAt(c.t, c.words, c.focusOffsets, c.pivotPx, c.slideDuration)
    expect(actual).toBeCloseTo(c.expected, CLOSE_DIGITS)
  })

  test('lineOffsetAt handles the degenerate inputs the same way', () => {
    expect(embedded.lineOffsetAt(1, [], [], 400, 0.1)).toBe(400)
    expect(embedded.lineOffsetAt(5, [{ start: 0, end: 1 }], [10, 999], 400, 0.1)).toBe(390)
    expect(embedded.lineOffsetAt(NaN, [{ start: 0, end: 1 }], [10], 400, 0.1)).toBe(390)
  })
})
