/**
 * RSVP ("Spritz" speed-reading) caption core — the pure geometry shared by all
 * three renderers.
 *
 * RSVP shows one unwrapped line of a group's words and slides it horizontally so
 * that one letter of the active word — the Optimal Recognition Point (ORP) —
 * always lands on a fixed pivot column. The eye never moves; the text moves
 * under it.
 *
 * ## This file has two twins
 *
 * The same functions and the same table exist in:
 *   - `backend/exporters/rsvp.py` (Pillow renderer, the source of truth)
 *   - `RSVP_RUNTIME_JS` in `backend/exporters/hyperframes_rsvp_runtime.py`
 *     (HTML/GSAP layer)
 *
 * Change one and you must change all three — three drifting copies is exactly
 * the bug class the parity suite exists to catch. All three are pinned by the
 * same literal fixtures under `backend/tests/fixtures/` —
 * `rsvp_orp_cases.json`, `rsvp_focus_offset_cases.json`,
 * `rsvp_focus_slices_cases.json` and `rsvp_line_offset_cases.json` — which the
 * TS, Python and embedded-JS suites all read.
 *
 * ## Invariants
 *
 * - **Presentation only.** Nothing here reads or writes a `Word`'s timing; it
 *   consumes `start` values and returns pixels. RSVP never re-times, re-orders
 *   or re-slices words (CLAUDE.md → Word-timing locality).
 * - **Measurement is injected.** The caller passes a `measure` callback so each
 *   renderer keeps its own equivalent primitive (Canvas `measureText().width` ↔
 *   PIL `font.getlength()` ↔ in-browser `measureText`, per
 *   `docs/caption-parity.md:11-21`). This module never touches a font, a canvas
 *   or the DOM.
 * - **`lineOffsetAt` is a pure function of `t`.** No accumulated state, no
 *   "previous frame" — so seeking backwards lands on exactly the same offset as
 *   playing forwards to the same time.
 * - **Tokens are indexed in Unicode code points, never UTF-16 code units.** See
 *   {@link codePoints}; the Python twin's `len()`/slicing is the reference.
 */

/**
 * Upper bound of the last ORP breakpoint. Using +Infinity (Python `math.inf`,
 * JS `Infinity`) rather than a null/None sentinel keeps the lookup branch-free
 * and identical in all three languages.
 */
export const UNBOUNDED_TOKEN_LENGTH = Number.POSITIVE_INFINITY

/** One row of the Spritz ORP table: "tokens up to this long focus at `index`". */
export interface OrpBreakpoint {
  /** Inclusive upper bound on token length. */
  readonly maxLength: number
  /** 0-based index of the focus character. */
  readonly index: number
}

/**
 * The Spritz ORP table, as data so tests can assert against it instead of
 * re-deriving a hand-written mapping.
 *
 * | token length | focus index |
 * |---|---|
 * | ≤ 1 | 0 |
 * | 2–5 | 1 |
 * | 6–9 | 2 |
 * | 10–13 | 3 |
 * | ≥ 14 | 4 |
 *
 * Confirmed 9/9 against the reference clip (see
 * `docs/plans/rsvp-speed-reading-mode.md`). Rows are ordered by ascending
 * `maxLength`; the first row whose bound the token fits wins.
 *
 * Frozen at runtime, rows included: `readonly` is erased when TS compiles, while
 * the Python twin is a real `tuple` of `NamedTuple`s that cannot be mutated at
 * all. `Object.freeze` keeps the immutability contract (CLAUDE.md) true in both
 * languages rather than only in the type checker.
 */
export const RSVP_ORP_TABLE: readonly OrpBreakpoint[] = Object.freeze([
  Object.freeze({ maxLength: 1, index: 0 }),
  Object.freeze({ maxLength: 5, index: 1 }),
  Object.freeze({ maxLength: 9, index: 2 }),
  Object.freeze({ maxLength: 13, index: 3 }),
  Object.freeze({ maxLength: UNBOUNDED_TOKEN_LENGTH, index: 4 }),
])

/**
 * Split `token` into its Unicode **code points**.
 *
 * The unit of the whole ORP contract is the code point, because the Pillow
 * renderer — the declared source of truth (`docs/caption-parity.md`) — indexes a
 * Python `str`, and that counts code points. JS `String#length` and `token[i]`
 * count UTF-16 **code units**, so indexing a token natively would diverge on any
 * astral (non-BMP) character: `"🎬clap"` is 5 code points but 6 code units, so
 * the table lookup lands on a different row (index 1 vs 2), and `"a🎬b"[1]` is
 * half of the emoji — a lone surrogate handed to `measureText`/`fillText`, i.e.
 * a different pivot offset *and* tofu on screen.
 *
 * `Array.from` iterates code points, which also fixes the malformed case: an
 * **unpaired surrogate counts as exactly one unit and is sliced whole**, never
 * merged with a neighbour. That matches Python, where a lone surrogate is
 * likewise one `str` element, so all three renderers agree on the index and the
 * offset even for input that cannot render (it draws as tofu everywhere rather
 * than differing per renderer). Pinned by the lone-surrogate fixture cases in
 * `backend/tests/fixtures/rsvp_orp_cases.json`.
 *
 * Exported (the embedded twin exposes `__capRsvp.codePoints` publicly, so the two
 * stay symmetric) because every renderer that draws or measures a sliced token
 * needs this unit — hand-rolling `Array.from` at each call site is how a fourth
 * copy of the rule appears.
 */
export function codePoints(token: string): string[] {
  return Array.from(token)
}

/**
 * The one clamp both focus accessors share, so an out-of-range or junk `f` can
 * never mean two different things in {@link focusOffset} and
 * {@link focusSlices}.
 *
 * `len` is a **code point** count. `f` out of range is clamped into
 * `[0, len - 1]`; a non-finite (or, from an untyped caller, non-numeric) `f` is
 * read as 0. `Number.isFinite` rather than the coercing global `isFinite` is what
 * makes `''` and `null` behave identically here and in the embedded twin. The
 * Python twin raises on a non-`int` instead, deliberately — its signature is
 * typed, so a wrong type there is a bug to surface rather than swallow.
 */
function clampFocusIndex(len: number, f: number): number {
  if (len <= 0) return 0
  const raw = Number.isFinite(f) ? Math.trunc(f) : 0
  return Math.min(Math.max(raw, 0), len - 1)
}

/** The active word split for drawing: before / at / after the focus glyph.
 *  `prefix + focus + suffix === token` always holds. */
export interface FocusSlices {
  readonly prefix: string
  readonly focus: string
  readonly suffix: string
}

/**
 * Split `token` around its focus character, in **code points**.
 *
 * The single source of that split for all three renderers — Pillow draws the
 * active word as three pieces, the Canvas preview draws three pieces and the HTML
 * layer emits three spans, so hand-rolling the code-point rule a fourth time is
 * how the renderers would drift. Slicing goes through {@link codePoints}, which
 * also keeps an **unpaired surrogate** whole (one unit, never split or dropped)
 * instead of cutting an astral glyph in half.
 *
 * `f` is clamped by `clampFocusIndex`. An empty token has nothing to split and
 * yields three empty strings.
 */
export function focusSlices(token: string, f: number): FocusSlices {
  const chars = codePoints(token)
  if (chars.length === 0) return { prefix: '', focus: '', suffix: '' }

  const i = clampFocusIndex(chars.length, f)
  return {
    prefix: chars.slice(0, i).join(''),
    focus: chars[i],
    suffix: chars.slice(i + 1).join(''),
  }
}

/**
 * Focus-character index for a whitespace token.
 *
 * The length counted is that of the **whole token, punctuation included** —
 * Spritz tokenizes on whitespace, so `saccades,` is length 9 → index 2. The
 * empty string yields 0. Length is in **code points** ({@link codePoints}), so
 * `"🎬clap"` is 5 → index 1, not 6 → index 2.
 *
 * The result is always a valid index into `token`: a table row that would point
 * past the end (only reachable if the table is edited) is clamped to the last
 * character, never returned out of range.
 */
export function orpIndex(token: string): number {
  const len = codePoints(token).length
  if (len === 0) return 0

  let index = RSVP_ORP_TABLE[RSVP_ORP_TABLE.length - 1].index
  for (const breakpoint of RSVP_ORP_TABLE) {
    if (len <= breakpoint.maxLength) {
      index = breakpoint.index
      break
    }
  }
  return Math.min(Math.max(index, 0), len - 1)
}

/**
 * Centre of the focus character, in the same space as `wordX`.
 *
 *     focusOffset = wordX + measure(token[0:f]) + measure(token[f]) / 2
 *
 * `wordX` is the token's left edge on the unwrapped line, so the return value is
 * "how far from the line's origin this word's focus glyph sits". The
 * prefix/focus split comes from {@link focusSlices}, so `f` is a **code point**
 * index and an astral glyph is measured whole instead of as a surrogate half. `f`
 * out of range (or non-finite) is clamped into `[0, codePointCount - 1]`; an empty
 * token has no glyph to centre on and returns `wordX` unchanged **without
 * calling** `measure`, so the answer cannot depend on what a caller's
 * `measure('')` reports.
 */
export function focusOffset(
  wordX: number,
  token: string,
  f: number,
  measure: (s: string) => number
): number {
  if (token.length === 0) return wordX

  const { prefix, focus } = focusSlices(token, f)
  return wordX + measure(prefix) + measure(focus) / 2
}

/**
 * The slice of a word's timing RSVP reads.
 *
 * Only `start` is read — the active word is "the last one whose `start` has
 * passed" ({@link lineOffsetAt}). `end` is still **required** so this type is
 * structurally satisfied by a real `Word` and by the fixture rows verbatim:
 * callers pass their words straight through instead of mapping them to a
 * narrower shape, and the three suites feed the same `{start, end}` JSON to all
 * three implementations.
 */
export interface RsvpWordTiming {
  readonly start: number
  readonly end: number
}

/**
 * The line's x translation at time `t`, eased between consecutive words.
 *
 * The line is laid out once (giving one `focusOffsets` entry per word, in px
 * relative to the line's origin) and then translated as a whole, so the active
 * word's focus glyph sits on `pivotPx`:
 *
 *     target(i) = pivotPx - focusOffsets[i]
 *
 * The active word is the **last** word whose `start` is at or before `t` —
 * deliberately not the `start <= t < end` test the decoration modes use. Silence
 * between two words must *hold* the previous position; a `start <= t < end` test
 * would have no answer there and the line would snap.
 *
 * Between the previous word's target and the active one's, the line eases over
 * `slideDuration` seconds with the repo's shared quadratic ease-out
 * `1 - (1 - p)²`. That curve is GSAP **`power1.out`** — `power1` is quad,
 * `power2` is cubic (`docs/caption-parity.md:11-21`); "upgrading" it to `power2`
 * reintroduces a real mid-slide divergence between the renderers.
 *
 * @param t Time in seconds, on the same clock as `words[].start`.
 * @param words The group's words in line order.
 * @param focusOffsets One `focusOffset()` per word, in px from the line origin.
 * @param pivotPx The fixed pivot column, in px in the same space.
 * @param slideDuration Slide length in **plain seconds**; `<= 0` snaps.
 * @returns The x translation to apply to the whole line. With no words there is
 *   nothing to align, so the line sits at the pivot (`pivotPx`).
 */
export function lineOffsetAt(
  t: number,
  words: readonly RsvpWordTiming[],
  focusOffsets: readonly number[],
  pivotPx: number,
  slideDuration: number
): number {
  const count = Math.min(words.length, focusOffsets.length)
  if (count === 0) return pivotPx

  const target = (i: number): number => pivotPx - focusOffsets[i]

  // Last word whose start has passed; 0 before the first word starts (and for a
  // non-finite `t`, which no comparison matches).
  let active = 0
  for (let i = 0; i < count; i++) {
    if (words[i].start <= t) active = i
  }
  if (active === 0) return target(0)

  const elapsed = t - words[active].start
  // `!(x > 0)` also rejects a non-finite duration.
  if (!(slideDuration > 0) || elapsed >= slideDuration) return target(active)

  const p = elapsed / slideDuration
  const eased = 1 - (1 - p) ** 2
  const from = target(active - 1)
  return from + (target(active) - from) * eased
}
