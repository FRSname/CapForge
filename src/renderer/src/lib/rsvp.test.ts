/**
 * TypeScript half of the RSVP (Spritz speed-reading) core contract.
 *
 * `lib/rsvp.ts` is one of **three** implementations of the same ORP /
 * line-offset rules; the twins are `backend/exporters/rsvp.py` (Pillow) and
 * `RSVP_RUNTIME_JS` in `backend/exporters/hyperframes_rsvp_runtime.py`
 * (HTML/GSAP, pinned by `rsvp.embedded.test.ts`).
 *
 * All three suites read the **same four JSON fixtures** under
 * `backend/tests/fixtures/`, the way `groups.gaps.test.ts` shares its literal
 * table with `backend/tests/test_group_gap_closing.py`. A rule that changes in
 * one language and not the others fails loudly on the sides that did not change.
 * Never hand-write an expected value here — add it to the fixture.
 *
 * Vitest runs in the plain `node` environment (see CLAUDE.md → Testing), so
 * reading the fixtures off disk is fine.
 */

import { describe, expect, test } from 'vitest'
import {
  RSVP_ORP_TABLE,
  UNBOUNDED_TOKEN_LENGTH,
  codePoints,
  focusOffset,
  focusSlices,
  lineOffsetAt,
  orpIndex,
  type RsvpWordTiming,
} from './rsvp'
import {
  ASTRAL_CHAR,
  CHAR_W,
  MIN_FOCUS_OFFSET_CASES,
  MIN_FOCUS_SLICES_CASES,
  MIN_LINE_OFFSET_CASES,
  MIN_ORP_CASES,
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
  lineOffsetCases,
  CLOSE_DIGITS,
} = loadRsvpFixtures()

// ── Fixture sanity ─────────────────────────────────────────────────

describe('rsvp fixtures', () => {
  test('all four fixture files loaded with content', () => {
    // Guards the fixtures themselves — an unreadable file must not pass silently.
    expect(orpCases.length).toBeGreaterThanOrEqual(MIN_ORP_CASES)
    expect(focusOffsetCases.length).toBeGreaterThanOrEqual(MIN_FOCUS_OFFSET_CASES)
    expect(focusSlicesCases.length).toBeGreaterThanOrEqual(MIN_FOCUS_SLICES_CASES)
    expect(lineOffsetCases.length).toBeGreaterThanOrEqual(MIN_LINE_OFFSET_CASES)
  })

  test('the orp fixture still covers astral and unpaired-surrogate tokens', () => {
    // The code-point contract is only pinned while these cases exist; deleting
    // them must fail here rather than quietly re-open the UTF-16 divergence.
    const hasAstral = orpCases.some(({ token }) => Array.from(token).some((c) => c.length === 2))
    const hasLoneSurrogate = orpCases.some(({ token }) =>
      Array.from(token).some(
        (c) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff
      )
    )
    expect(hasAstral).toBe(true)
    expect(hasLoneSurrogate).toBe(true)
  })

  test('the orp fixture still covers a decomposed (non-NFC) token', () => {
    // The NFC contract is only pinned while an NFD case exists; deleting them must
    // fail here rather than quietly re-open "the focus glyph is a bare mark".
    expect(orpCases.some(({ token }) => token !== token.normalize('NFC'))).toBe(true)
    // ...and the residual: a mark with NO precomposed form, which NFC cannot fix.
    expect(
      orpCases.some(
        ({ token }) => token === token.normalize('NFC') && Array.from(token).some(isCombiningMark)
      )
    ).toBe(true)
  })
})

// ── NFC normalisation ──────────────────────────────────────────────
//
// The token is composed once, inside `codePoints`, so every rule below sees the
// same form the Python source of truth does (`unicodedata.normalize('NFC', s)`).

describe('NFC normalisation', () => {
  test('codePoints composes the token', () => {
    for (const decomposed of NFD_TOKENS) {
      expect(codePoints(decomposed)).toEqual(Array.from(decomposed.normalize('NFC')))
    }
  })

  test.each(NFD_TOKENS)('NFD and NFC spellings of %j are indistinguishable', (decomposed) => {
    // Same word, two spellings: the index, the split and the offset must all agree,
    // or a token typed on a system that hands out NFD reads as a different word.
    const composed = decomposed.normalize('NFC')
    expect(composed).not.toBe(decomposed)

    expect(orpIndex(decomposed)).toBe(orpIndex(composed))
    expect(focusSlices(decomposed, orpIndex(decomposed))).toEqual(
      focusSlices(composed, orpIndex(composed))
    )
    expect(focusOffset(0, decomposed, orpIndex(decomposed), fixedWidth)).toBe(
      focusOffset(0, composed, orpIndex(composed), fixedWidth)
    )
  })

  test.each(NFD_TOKENS)('the focus glyph of %j is never a bare combining mark', (token) => {
    expect(isCombiningMark(focusSlices(token, orpIndex(token)).focus)).toBe(false)
  })

  test('a mark with no precomposed form is the documented residual', () => {
    // ACCEPTED DELTA, pinned rather than assumed away: U+0348 has no composition,
    // so the focus glyph really is the mark. A change that fixes it must say so here.
    expect(NO_COMPOSITION.normalize('NFC')).toBe(NO_COMPOSITION)
    expect(isCombiningMark(focusSlices(NO_COMPOSITION, orpIndex(NO_COMPOSITION)).focus)).toBe(true)
  })
})

// ── orpIndex ───────────────────────────────────────────────────────

describe('orpIndex', () => {
  test.each(orpCases.map((c) => [c.token, c.index] as const))(
    'token %j focuses at index %i',
    (token, index) => {
      expect(orpIndex(token)).toBe(index)
    }
  )

  test('agrees with RSVP_ORP_TABLE for every length in the sweep', () => {
    // Derived from the exported table, not a second hand-written mapping, so
    // editing the table can never leave the function behind.
    for (let len = 0; len <= SWEEP_MAX_LENGTH; len++) {
      const token = 'x'.repeat(len)
      if (len === 0) {
        expect(orpIndex(token)).toBe(0)
        continue
      }
      const row = RSVP_ORP_TABLE.find((bp) => len <= bp.maxLength)
      expect(row).toBeDefined()
      expect(orpIndex(token)).toBe(Math.min(Math.max(row!.index, 0), len - 1))
    }
  })

  test('counts code points, not UTF-16 code units', () => {
    // Swapping every character for an astral one doubles the code-UNIT length but
    // must not move the focus index. `length`-based indexing fails this from
    // len 1 up.
    for (let len = 0; len <= SWEEP_MAX_LENGTH; len++) {
      expect(orpIndex(ASTRAL_CHAR.repeat(len))).toBe(orpIndex('x'.repeat(len)))
    }
  })

  test('never returns an index past the end of the token', () => {
    for (const { token } of orpCases) {
      // Bound in CODE POINTS — the code-unit length is looser for astral tokens,
      // so checking against `token.length` would pass a broken implementation.
      const len = Array.from(token).length
      if (len === 0) continue
      expect(orpIndex(token)).toBeGreaterThanOrEqual(0)
      expect(orpIndex(token)).toBeLessThanOrEqual(len - 1)
    }
  })

  test('the table is ordered and ends unbounded', () => {
    const bounds = RSVP_ORP_TABLE.map((bp) => bp.maxLength)
    expect(bounds).toEqual([...bounds].sort((a, b) => a - b))
    expect(bounds[bounds.length - 1]).toBe(UNBOUNDED_TOKEN_LENGTH)
    expect(Number.isFinite(UNBOUNDED_TOKEN_LENGTH)).toBe(false)
  })
})

// ── focusOffset ────────────────────────────────────────────────────

describe('focusOffset', () => {
  test('returns the focus glyph centre relative to the line origin', () => {
    // "the" -> f = 1, so one glyph of prefix plus half of 'h' past the left edge.
    expect(focusOffset(100, 'the', 1, fixedWidth)).toBe(100 + CHAR_W + CHAR_W / 2)
  })

  test('handles the first character', () => {
    expect(focusOffset(0, 'a', 0, fixedWidth)).toBe(5)
  })

  test('clamps an index past the end of the token', () => {
    // A table edit could point past a short token; the last glyph is the answer.
    expect(focusOffset(0, 'the', 9, fixedWidth)).toBe(25)
  })

  test('clamps a negative index', () => {
    expect(focusOffset(0, 'the', -3, fixedWidth)).toBe(5)
  })

  test('clamps a non-finite index instead of measuring undefined', () => {
    expect(focusOffset(0, 'the', NaN, fixedWidth)).toBe(5)
  })

  test('treats a non-numeric index as 0, like the embedded twin', () => {
    // `Number.isFinite` (not the coercing global `isFinite`) is what makes '' and
    // null behave the same in both JS copies; the casts stand in for the
    // untyped callers the embedded runtime has.
    for (const junk of ['', null, undefined, '2', {}, []] as unknown[]) {
      expect(focusOffset(0, 'the', junk as number, fixedWidth)).toBe(5)
    }
  })

  test('an empty token returns wordX unchanged', () => {
    expect(focusOffset(42, '', 0, fixedWidth)).toBe(42)
  })

  test('composes with orpIndex end to end', () => {
    const token = 'eliminates' // len 10 -> index 3
    expect(focusOffset(0, token, orpIndex(token), fixedWidth)).toBe(35)
  })

  // The shared prefix/focus/suffix cases, including the astral and
  // unpaired-surrogate ones. Widths come from the fixture's per-character table,
  // so a UTF-16-code-unit implementation measuring a surrogate half lands on a
  // different number instead of coincidentally matching.
  test.each(focusOffsetCases.map((c) => [c.name, c] as const))('fixture — %s', (_name, c) => {
    const f = c.f === null ? orpIndex(c.token) : c.f
    expect(focusOffset(c.wordX, c.token, f, focusMeasure)).toBeCloseTo(c.expected, CLOSE_DIGITS)
  })

  test('never hands a lone surrogate to measure for a well-formed token', () => {
    // The tofu failure mode: half an astral glyph reaching measureText/fillText.
    const seen: string[] = []
    const spy = (s: string): number => {
      seen.push(s)
      return s.length
    }
    for (const token of ['a🎬b', '🎬clap', '𝔘𝔫𝔦', 'ab🎬cd']) {
      focusOffset(0, token, orpIndex(token), spy)
    }
    for (const s of seen) {
      for (const ch of Array.from(s)) {
        const code = ch.charCodeAt(0)
        const isLoneSurrogate = ch.length === 1 && code >= 0xd800 && code <= 0xdfff
        expect(isLoneSurrogate).toBe(false)
      }
    }
  })
})

// ── codePoints / focusSlices ───────────────────────────────────────

describe('codePoints', () => {
  test('splits on code points, keeping astral glyphs whole', () => {
    expect(codePoints('a🎬b')).toEqual(['a', '🎬', 'b'])
    expect(codePoints('')).toEqual([])
  })

  test('an unpaired surrogate is exactly one unit', () => {
    // Malformed input must not be merged with a neighbour or dropped; the Python
    // twin sees one `str` element too.
    expect(codePoints('a\ud83cb')).toEqual(['a', '\ud83c', 'b'])
  })
})

describe('focusSlices', () => {
  // The shared prefix/focus/suffix cases, including the astral and
  // unpaired-surrogate ones. A code-unit implementation cuts a surrogate pair in
  // half and fails 7 of them, so the fixture — not a per-suite literal — is what
  // pins the code-point rule for all three renderers.
  test.each(focusSlicesCases.map((c) => [c.name, c] as const))('fixture — %s', (_name, c) => {
    const f = c.f === null ? orpIndex(c.token) : c.f
    expect(focusSlices(c.token, f)).toEqual({
      prefix: c.prefix,
      focus: c.focus,
      suffix: c.suffix,
    })
  })

  test('prefix + focus + suffix rebuilds every fixture token, NFC-composed', () => {
    // Derived, not restated: nothing may be dropped or duplicated by the split. The
    // pieces rebuild the token's NFC form — which for an already-composed token
    // (every case but the NFD ones) is the token itself.
    for (const { token, f } of focusSlicesCases) {
      const i = f === null ? orpIndex(token) : f
      const { prefix, focus, suffix } = focusSlices(token, i)
      expect(prefix + focus + suffix).toBe(token.normalize('NFC'))
    }
  })

  test('agrees with focusOffset, which is built from the same split', () => {
    // focusOffset === wordX + measure(prefix) + measure(focus)/2, so the two can
    // only diverge if one of them re-implements the slicing.
    for (const { token, f } of focusSlicesCases) {
      if (token === '') continue // no glyph to centre on; focusOffset returns wordX
      const i = f === null ? orpIndex(token) : f
      const { prefix, focus } = focusSlices(token, i)
      expect(focusOffset(7, token, i, focusMeasure)).toBeCloseTo(
        7 + focusMeasure(prefix) + focusMeasure(focus) / 2,
        CLOSE_DIGITS
      )
    }
  })

  test('never yields a lone surrogate for a well-formed token', () => {
    // The tofu failure mode, stated for the split as well as for the measurement.
    for (const token of ['a🎬b', '🎬clap', '𝔘𝔫𝔦', 'ab🎬cd']) {
      const { prefix, focus, suffix } = focusSlices(token, orpIndex(token))
      for (const piece of [prefix, focus, suffix]) {
        for (const ch of Array.from(piece)) {
          const code = ch.charCodeAt(0)
          expect(ch.length === 1 && code >= 0xd800 && code <= 0xdfff).toBe(false)
        }
      }
    }
  })

  test('an empty token yields three empty strings, not undefined', () => {
    expect(focusSlices('', 0)).toEqual({ prefix: '', focus: '', suffix: '' })
  })

  test('treats a non-numeric f as 0, like the embedded twin', () => {
    for (const junk of ['', null, undefined, '2', {}, []] as unknown[]) {
      expect(focusSlices('the', junk as number)).toEqual({
        prefix: '',
        focus: 't',
        suffix: 'he',
      })
    }
  })
})

// ── lineOffsetAt ───────────────────────────────────────────────────

describe('lineOffsetAt', () => {
  test.each(lineOffsetCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const actual = lineOffsetAt(c.t, c.words, c.focusOffsets, c.pivotPx, c.slideDuration)
    expect(actual).toBeCloseTo(c.expected, CLOSE_DIGITS)
  })

  test('is a pure function of t, so a backwards seek is exact', () => {
    const words: RsvpWordTiming[] = [
      { start: 0, end: 0.5 },
      { start: 0.5, end: 1 },
    ]
    const offsets = [10, 100]
    const forwards: number[] = []
    for (let i = 0; i < 100; i++) forwards.push(lineOffsetAt(i / 100, words, offsets, 400, 0.1))
    const backwards: number[] = []
    for (let i = 99; i >= 0; i--) backwards.push(lineOffsetAt(i / 100, words, offsets, 400, 0.1))
    expect(backwards).toEqual([...forwards].reverse())
  })

  test('ignores a focus offset that has no word', () => {
    // A ragged pair of inputs must not throw; the shorter list wins.
    expect(lineOffsetAt(5, [{ start: 0, end: 1 }], [10, 999], 400, 0.1)).toBe(390)
  })

  test('with no words returns the pivot', () => {
    expect(lineOffsetAt(1, [], [], 400, 0.1)).toBe(400)
  })

  test('a non-finite t falls back to the first word', () => {
    const words: RsvpWordTiming[] = [
      { start: 0, end: 0.5 },
      { start: 0.5, end: 1 },
    ]
    expect(lineOffsetAt(NaN, words, [10, 100], 400, 0.1)).toBe(390)
  })
})
