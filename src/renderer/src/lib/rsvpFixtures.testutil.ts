/**
 * Test-only loader for the shared RSVP fixtures. **Not imported by app code** —
 * it reads from disk (`node:fs`) and only ever runs under vitest's `node`
 * environment.
 *
 * `backend/tests/fixtures/rsvp_orp_cases.json`,
 * `rsvp_focus_offset_cases.json`, `rsvp_focus_slices_cases.json` and
 * `rsvp_line_offset_cases.json` are the single source of expected values for all
 * three RSVP implementations:
 *
 *   - `src/renderer/src/lib/rsvp.ts`            → `rsvp.test.ts`
 *   - `backend/exporters/rsvp.py`               → `backend/tests/test_rsvp_core.py`
 *   - `RSVP_RUNTIME_JS` (`hyperframes_rsvp_runtime.py`) → `rsvp.embedded.test.ts`
 *
 * Both TS suites go through this loader so neither can quietly read a different
 * file — or a different shape — than the other. It also owns the small pieces of
 * test scaffolding they share (the uniform-width `measure` stub, the astral
 * character, the float tolerance, the fixture-size minimums) for the same reason:
 * two copies of a stub are two things that can drift.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Vitest runs from the repo root, so fixtures resolve relative to `cwd`. */
const FIXTURE_DIR = join(process.cwd(), 'backend', 'tests', 'fixtures')

/**
 * Digits of agreement required of a float comparison (`toBeCloseTo`'s second
 * argument, i.e. a tolerance of 0.5e-9). The Python twin uses `abs=1e-9`. Tight
 * enough that a wrong ease or a wrong branch fails; loose enough for the IEEE754
 * residue of `t - start` (worst observed ~1.4e-13).
 *
 * Exposed only as a field on {@link loadRsvpFixtures}'s return value, so there is
 * exactly one way for a suite to reach it.
 */
const CLOSE_DIGITS = 9

/**
 * Longest token length the table-agreement sweeps cover — long enough to run past
 * the last finite ORP breakpoint (13) into the unbounded row.
 */
export const SWEEP_MAX_LENGTH = 24

/** A non-BMP (astral) character: two UTF-16 code units, one code point. */
export const ASTRAL_CHAR = '🎬'

/**
 * Decomposed (NFD) tokens: a letter followed by a COMBINING mark that Unicode
 * *does* have a precomposed form for. Written as `\uXXXX` escapes on purpose — a
 * literal `'\u00e9'` in a source file can be silently re-normalised by an editor
 * or a formatter, which would gut every NFC assertion that reads this.
 *
 * Shared by both TS suites (and mirrored by `NFD_TOKENS` in
 * `backend/tests/test_rsvp_core.py`) so the three languages test the same strings.
 */
export const NFD_TOKENS = [
  'e\u0301', // -> '\u00e9': one code point, so the ORP index moves too
  'cafe\u0301', // -> 'caf\u00e9'
  'nai\u0308ve', // -> 'na\u00efve': also crosses the 5/6 ORP breakpoint
  'n\u0303o', // -> '\u00f1o': same index, different focus glyph
] as const

/**
 * A combining mark with NO precomposed form (U+0348 COMBINING DOUBLE VERTICAL
 * LINE BELOW): the **residual accepted delta**. NFC leaves it decomposed, so it
 * can still be selected as the focus glyph.
 */
export const NO_COMPOSITION = 'a\u0348'

/**
 * Is this piece a **bare combining mark** (Unicode `Mn`)? The failure mode the NFC
 * pin removes: a focus glyph that is only a mark gets drawn on its own at an
 * advanced pen, which Pillow renders as a bare mark and a browser renders on a
 * dotted circle (U+25CC). The Python twin asks `unicodedata.combining(ch)`.
 */
export const isCombiningMark = (piece: string): boolean => /^\p{Mn}$/u.test(piece)

/**
 * Width of every character in the uniform `measure` stub, so an expected offset
 * is arithmetic rather than font data. The fixture-driven cases use the fixture's
 * own per-character table instead (see {@link loadFocusFixture}).
 */
export const CHAR_W = 10

/** The uniform-width `measure` stub. Deliberately code-UNIT based (`s.length`):
 *  it stands in for "a measurer that knows nothing about code points", which is
 *  fine because the cases that use it are ASCII. */
export const fixedWidth = (s: string): number => CHAR_W * s.length

/**
 * Minimum case counts. A fixture that shrinks below these is a fixture someone
 * gutted, not a suite that got simpler — named so the numbers are not bare
 * literals in two languages (mirrored by `MIN_*` in
 * `backend/tests/test_rsvp_core.py`).
 */
export const MIN_ORP_CASES = 20
export const MIN_FOCUS_OFFSET_CASES = 8
export const MIN_FOCUS_SLICES_CASES = 8
export const MIN_LINE_OFFSET_CASES = 10

export interface OrpCase {
  readonly token: string
  readonly index: number
}

export interface FocusOffsetCase {
  readonly name: string
  readonly wordX: number
  readonly token: string
  /** `null` means "derive it with `orpIndex(token)`" — the end-to-end case. */
  readonly f: number | null
  readonly expected: number
}

export interface FocusSlicesCase {
  readonly name: string
  readonly token: string
  /** `null` means "derive it with `orpIndex(token)`" — the end-to-end case. */
  readonly f: number | null
  readonly prefix: string
  readonly focus: string
  readonly suffix: string
}

export interface LineOffsetCase {
  readonly name: string
  readonly words: ReadonlyArray<{ readonly start: number; readonly end: number }>
  readonly focusOffsets: readonly number[]
  readonly pivotPx: number
  readonly slideDuration: number
  readonly t: number
  readonly expected: number
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'))
}

/**
 * Narrow to a plain object *before* any property access, so a `null` or a stray
 * array in the JSON produces this loader's descriptive message instead of a bare
 * `Cannot read properties of null`.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${where}: expected a JSON object, got ${JSON.stringify(value)}`)
  }
  return value
}

function asArray(data: unknown, file: string): unknown[] {
  if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array`)
  if (data.length === 0) throw new Error(`${file}: fixture is empty`)
  return data
}

function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${where}: expected a number, got ${JSON.stringify(value)}`)
  }
  return value
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${where}: expected a string, got ${JSON.stringify(value)}`)
  }
  return value
}

/** `null` (derive with `orpIndex`) or a number; anything else is a broken case. */
function focusIndex(value: unknown, where: string): number | null {
  return value === null ? null : num(value, where)
}

/**
 * Build the injected `measure` stub from a fixture's width table.
 *
 * Iterates **code points** (`Array.from`), matching the Python stub's
 * `for c in s`, so the stub itself is never the thing that diverges — the
 * implementation's own slicing is. A width table with a distinct width per
 * character is what makes a surrogate half measure differently from the astral
 * glyph it belongs to.
 */
function buildMeasure(charWidths: ReadonlyMap<string, number>, defaultWidth: number) {
  return (s: string): number => {
    let total = 0
    for (const ch of Array.from(s)) total += charWidths.get(ch) ?? defaultWidth
    return total
  }
}

/** `rsvp_orp_cases.json` → token/index pairs. */
export function loadOrpCases(): OrpCase[] {
  const file = 'rsvp_orp_cases.json'
  return asArray(readJson(file), file).map((raw, i) => {
    const c = obj(raw, `${file}[${i}]`)
    return {
      token: str(c.token, `${file}[${i}].token`),
      index: num(c.index, `${file}[${i}].index`),
    }
  })
}

/**
 * `rsvp_focus_offset_cases.json` → the cases plus the `measure` stub built from
 * the file's own `defaultCharWidth` / `charWidths` table.
 */
export function loadFocusFixture(): {
  cases: FocusOffsetCase[]
  measure: (s: string) => number
} {
  const file = 'rsvp_focus_offset_cases.json'
  const root = obj(readJson(file), file)
  const defaultCharWidth = num(root.defaultCharWidth, `${file}.defaultCharWidth`)
  const rawWidths = obj(root.charWidths, `${file}.charWidths`)
  const charWidths = new Map<string, number>(
    Object.entries(rawWidths).map(([ch, w]) => [
      ch,
      num(w, `${file}.charWidths[${JSON.stringify(ch)}]`),
    ])
  )

  const cases = asArray(root.cases, `${file}.cases`).map((raw, i) => {
    const at = `${file}.cases[${i}]`
    const c = obj(raw, at)
    return {
      name: str(c.name, `${at}.name`),
      wordX: num(c.wordX, `${at}.wordX`),
      token: str(c.token, `${at}.token`),
      f: focusIndex(c.f, `${at}.f`),
      expected: num(c.expected, `${at}.expected`),
    }
  })

  return { cases, measure: buildMeasure(charWidths, defaultCharWidth) }
}

/** `rsvp_focus_slices_cases.json` → the prefix/focus/suffix split cases. */
export function loadFocusSlicesCases(): FocusSlicesCase[] {
  const file = 'rsvp_focus_slices_cases.json'
  const root = obj(readJson(file), file)
  return asArray(root.cases, `${file}.cases`).map((raw, i) => {
    const at = `${file}.cases[${i}]`
    const c = obj(raw, at)
    return {
      name: str(c.name, `${at}.name`),
      token: str(c.token, `${at}.token`),
      f: focusIndex(c.f, `${at}.f`),
      prefix: str(c.prefix, `${at}.prefix`),
      focus: str(c.focus, `${at}.focus`),
      suffix: str(c.suffix, `${at}.suffix`),
    }
  })
}

/** `rsvp_line_offset_cases.json` → the time → x-translation cases. */
export function loadLineOffsetCases(): LineOffsetCase[] {
  const file = 'rsvp_line_offset_cases.json'
  return asArray(readJson(file), file).map((raw, i) => {
    const at = `${file}[${i}]`
    const c = obj(raw, at)
    const words = c.words
    if (!Array.isArray(words)) throw new Error(`${at}: words must be an array`)
    const focusOffsets = c.focusOffsets
    if (!Array.isArray(focusOffsets)) throw new Error(`${at}: focusOffsets must be an array`)
    return {
      name: str(c.name, `${at}.name`),
      words: words.map((w, j) => {
        const word = obj(w, `${at}.words[${j}]`)
        return {
          start: num(word.start, `${at}.words[${j}].start`),
          end: num(word.end, `${at}.words[${j}].end`),
        }
      }),
      focusOffsets: focusOffsets.map((v, j) => num(v, `${at}.focusOffsets[${j}]`)),
      pivotPx: num(c.pivotPx, `${at}.pivotPx`),
      slideDuration: num(c.slideDuration, `${at}.slideDuration`),
      t: num(c.t, `${at}.t`),
      expected: num(c.expected, `${at}.expected`),
    }
  })
}

/** Parse + validate all four fixtures. Throws (rather than yielding a silently
 *  empty/mis-shaped suite) if any file drifts from the expected shape. */
export function loadRsvpFixtures(): {
  orpCases: OrpCase[]
  focusOffsetCases: FocusOffsetCase[]
  /** `measure` for the focus-offset cases; see {@link buildMeasure}. */
  focusMeasure: (s: string) => number
  focusSlicesCases: FocusSlicesCase[]
  lineOffsetCases: LineOffsetCase[]
  CLOSE_DIGITS: number
} {
  const focus = loadFocusFixture()
  return {
    orpCases: loadOrpCases(),
    focusOffsetCases: focus.cases,
    focusMeasure: focus.measure,
    focusSlicesCases: loadFocusSlicesCases(),
    lineOffsetCases: loadLineOffsetCases(),
    CLOSE_DIGITS,
  }
}
