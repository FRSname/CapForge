/**
 * Test-only loader for the shared RSVP fixtures. **Not imported by app code** —
 * it reads from disk (`node:fs`) and only ever runs under vitest's `node`
 * environment.
 *
 * `backend/tests/fixtures/rsvp_orp_cases.json`,
 * `rsvp_focus_offset_cases.json`, `rsvp_focus_slices_cases.json`,
 * `rsvp_last_started_cases.json` and `rsvp_line_offset_cases.json` are the single
 * source of expected values for all three RSVP implementations:
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
 * The **other** active-word rule — `start <= t < end`, first match, `-1` for none —
 * which is what the decoration modes use and what RSVP deliberately does not. Not
 * an implementation of anything under test: it exists so the suites can assert
 * that `rsvp_last_started_cases.json` still contains cases where the two rules
 * *disagree*, i.e. that the fixture is actually pinning the rule rather than a set
 * of inputs both would get right. Mirrored by `_active_in_window` in
 * `backend/tests/test_rsvp_core.py`.
 */
export function activeInWindow(
  t: number,
  words: ReadonlyArray<{ readonly start: number; readonly end: number }>
): number {
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t && t < words[i].end) return i
  }
  return -1
}

/**
 * Minimum case counts. A fixture that shrinks below these is a fixture someone
 * gutted, not a suite that got simpler — named so the numbers are not bare
 * literals in two languages (mirrored by `MIN_*` in
 * `backend/tests/test_rsvp_core.py`).
 */
export const MIN_ORP_CASES = 20
/** Mirrored by `MIN_REEL_CASES` in `backend/tests/test_rsvp_reels.py`. */
export const MIN_REEL_CASES = 18
export const MIN_FOCUS_OFFSET_CASES = 8
export const MIN_FOCUS_SLICES_CASES = 8
export const MIN_LAST_STARTED_CASES = 15
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

export interface LastStartedCase {
  readonly name: string
  readonly words: ReadonlyArray<{ readonly start: number; readonly end: number }>
  /** `null` = "call it with no `count`" (Python `None`, JS `undefined`). */
  readonly count: number | null
  /** May be `NaN`; see {@link time}. */
  readonly t: number
  readonly expected: number
  /**
   * What the decoration modes' `start <= t < end` test would answer (first match,
   * or -1) — carried so the suites can assert the fixture still contains cases
   * where the two rules *disagree*, which is the whole reason this rule exists.
   */
  readonly activeInWindow: number
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

/** `null` (= "omit the argument", Python `None`) or a number. */
function optionalCount(value: unknown, where: string): number | null {
  return value === null ? null : num(value, where)
}

/**
 * A time value, with the one sentinel the fixtures need: **JSON has no `NaN`
 * literal**, so `"NaN"` (the string) means the float NaN. Spelled as a sentinel
 * rather than relying on a lenient parser because Python's `json` accepts a bare
 * `NaN` token and `JSON.parse` does not — a fixture that used it would load in one
 * language and throw in the other two.
 */
function time(value: unknown, where: string): number {
  if (value === 'NaN') return Number.NaN
  return num(value, where)
}

/** `[{start, end}, …]`, validated. Shared by the two fixtures that carry words. */
function wordTimings(value: unknown, where: string): Array<{ start: number; end: number }> {
  if (!Array.isArray(value)) throw new Error(`${where}: words must be an array`)
  return value.map((w, j) => {
    const word = obj(w, `${where}[${j}]`)
    return {
      start: num(word.start, `${where}[${j}].start`),
      end: num(word.end, `${where}[${j}].end`),
    }
  })
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
    const focusOffsets = c.focusOffsets
    if (!Array.isArray(focusOffsets)) throw new Error(`${at}: focusOffsets must be an array`)
    return {
      name: str(c.name, `${at}.name`),
      words: wordTimings(c.words, `${at}.words`),
      focusOffsets: focusOffsets.map((v, j) => num(v, `${at}.focusOffsets[${j}]`)),
      pivotPx: num(c.pivotPx, `${at}.pivotPx`),
      slideDuration: num(c.slideDuration, `${at}.slideDuration`),
      t: num(c.t, `${at}.t`),
      expected: num(c.expected, `${at}.expected`),
    }
  })
}

/** `rsvp_last_started_cases.json` → the time → active-word-index cases. */
export function loadLastStartedCases(): LastStartedCase[] {
  const file = 'rsvp_last_started_cases.json'
  const root = obj(readJson(file), file)
  return asArray(root.cases, `${file}.cases`).map((raw, i) => {
    const at = `${file}.cases[${i}]`
    const c = obj(raw, at)
    return {
      name: str(c.name, `${at}.name`),
      words: wordTimings(c.words, `${at}.words`),
      count: optionalCount(c.count, `${at}.count`),
      t: time(c.t, `${at}.t`),
      expected: num(c.expected, `${at}.expected`),
      activeInWindow: num(c.activeInWindow, `${at}.activeInWindow`),
    }
  })
}

/**
 * One normalised group in `rsvp_reel_cases.json`: the shape both reel
 * implementations map their own group type into. `start`/`end` may be the `"NaN"`
 * sentinel; `speaker`/`posX`/`posY` are `null` when unset.
 */
export interface ReelGroupRow {
  readonly start: number
  readonly end: number
  readonly speaker: string | null
  readonly posX: number | null
  readonly posY: number | null
}

export interface ReelCase {
  readonly name: string
  readonly groups: readonly ReelGroupRow[]
  /** Expected `[startIndex, endIndexExclusive]` ranges over `groups`. */
  readonly reels: ReadonlyArray<readonly [number, number]>
}

/** `null` or a number — an unset position-override component. */
function optionalNumber(value: unknown, where: string): number | null {
  return value === null ? null : num(value, where)
}

/**
 * `rsvp_reel_cases.json` → the shared break-rule cases.
 *
 * Read by `rsvpReels.test.ts` here and by `backend/tests/test_rsvp_reels.py` on the
 * other side, so the two implementations of the rule cannot drift.
 */
export function loadReelCases(): ReelCase[] {
  const file = 'rsvp_reel_cases.json'
  const root = obj(readJson(file), file)
  return asArray(root.cases, `${file}.cases`).map((raw, i) => {
    const at = `${file}.cases[${i}]`
    const c = obj(raw, at)
    if (!Array.isArray(c.groups)) throw new Error(`${at}.groups must be an array`)
    if (!Array.isArray(c.reels)) throw new Error(`${at}.reels must be an array`)
    return {
      name: str(c.name, `${at}.name`),
      groups: c.groups.map((rawGroup, j) => {
        const g = obj(rawGroup, `${at}.groups[${j}]`)
        return {
          start: time(g.start, `${at}.groups[${j}].start`),
          end: time(g.end, `${at}.groups[${j}].end`),
          speaker: g.speaker === null ? null : str(g.speaker, `${at}.groups[${j}].speaker`),
          posX: optionalNumber(g.posX, `${at}.groups[${j}].posX`),
          posY: optionalNumber(g.posY, `${at}.groups[${j}].posY`),
        }
      }),
      reels: c.reels.map((rawRange, j) => {
        const where = `${at}.reels[${j}]`
        if (!Array.isArray(rawRange) || rawRange.length !== 2) {
          throw new Error(`${where}: expected a [start, end] pair`)
        }
        return [num(rawRange[0], `${where}[0]`), num(rawRange[1], `${where}[1]`)] as const
      }),
    }
  })
}

/** Parse + validate all five fixtures. Throws (rather than yielding a silently
 *  empty/mis-shaped suite) if any file drifts from the expected shape. */
export function loadRsvpFixtures(): {
  orpCases: OrpCase[]
  focusOffsetCases: FocusOffsetCase[]
  /** `measure` for the focus-offset cases; see {@link buildMeasure}. */
  focusMeasure: (s: string) => number
  focusSlicesCases: FocusSlicesCase[]
  lastStartedCases: LastStartedCase[]
  lineOffsetCases: LineOffsetCase[]
  CLOSE_DIGITS: number
} {
  const focus = loadFocusFixture()
  return {
    orpCases: loadOrpCases(),
    focusOffsetCases: focus.cases,
    focusMeasure: focus.measure,
    focusSlicesCases: loadFocusSlicesCases(),
    lastStartedCases: loadLastStartedCases(),
    lineOffsetCases: loadLineOffsetCases(),
    CLOSE_DIGITS,
  }
}
