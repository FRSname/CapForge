/**
 * Pure, canvas-free geometry/animation math extracted from useSubtitleOverlay.ts.
 *
 * IMPORTANT: this is one of THREE caption renderers that must stay pixel-identical
 * (Canvas preview ↔ backend Pillow ↔ HyperFrames HTML runtime — see CLAUDE.md
 * "Preview ↔ Render Parity"). These functions were moved verbatim out of the hook —
 * same constants, same order of float operations. Do not "simplify" the arithmetic;
 * changing it here silently breaks parity with the other two renderers.
 *
 * The RSVP half (everything named `rsvp*` below) is the Canvas twin of
 * `backend/exporters/rsvp_layout.py`, which is the **source of truth**: read its
 * module docstring before touching any of it. The shared scalar core it builds on
 * (ORP table, code-point slicing, the eased line offset, the colour anchor) lives
 * in `./rsvp.ts` and is never re-derived here.
 */

import {
  focusOffset,
  focusSlices,
  lastStartedIndex,
  lineOffsetAt,
  orpIndex,
  type RsvpWordTiming,
} from './rsvp'

/** Shared quadratic ease-out: clamps to [0,1] then applies 1-(1-v)². */
export function quadEaseOut(v: number): number {
  v = Math.max(0, Math.min(1, v))
  return 1 - (1 - v) ** 2
}

/** Linear interpolation from a to b at t (t is not clamped — callers control range). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface AnimationPhase {
  entryT: number
  exitT: number
  phaseT: number
  animAlpha: number
  slideOffset: number
  popScale: number
}

/** Group-level entry/exit animation phase (fade/slide/pop). `animation` is the
 *  StudioSettings.animationType value; unrecognized values fall through with
 *  animAlpha=1, slideOffset=0, popScale=1. */
export function computeAnimationPhase(
  age: number,
  remaining: number,
  animDur: number,
  animation: string,
  resH: number
): AnimationPhase {
  const entryT = animDur > 0 ? quadEaseOut(age / animDur) : 1
  const exitT = animDur > 0 ? quadEaseOut(remaining / animDur) : 1
  const phaseT = Math.min(entryT, exitT)

  let animAlpha = 1
  let slideOffset = 0
  let popScale = 1

  if (animation === 'fade') {
    animAlpha = phaseT
  }
  if (animation === 'slide') {
    animAlpha = phaseT
    const slidePx = resH * 0.04
    slideOffset = entryT < 1 ? slidePx * (1 - entryT) : slidePx * (1 - exitT) * -1
  }
  if (animation === 'pop') {
    animAlpha = phaseT
    if (entryT < 1) popScale = 0.85 + 0.15 * entryT
  }

  return { entryT, exitT, phaseT, animAlpha, slideOffset, popScale }
}

/** Word width including per-character tracking (letter-spacing), given a
 *  measurement callback so this stays canvas-free (caller supplies ctx.measureText). */
export function measureTrackedWidth(
  text: string,
  tracking: number,
  measureCharWidth: (s: string) => number
): number {
  if (tracking === 0) return measureCharWidth(text)
  let w = 0
  for (let ci = 0; ci < text.length; ci++) {
    w += measureCharWidth(text[ci])
    if (ci < text.length - 1) w += tracking
  }
  return w
}

/** Row gap added between wrapped caption lines. */
export function computeRowLineGap(textH: number, lineHeight: number): number {
  return textH * (lineHeight - 1)
}

/** Greedy word-wrap (numLines<=1) or fixed N-line split (numLines>1) — mirrors
 *  the backend/HTML runtime's row-splitting so wrap points match exactly. */
export function splitIntoRows<T extends { width: number }>(
  words: T[],
  numLines: number,
  maxW: number,
  spaceW: number
): T[][] {
  const rows: T[][] = []
  if (numLines <= 1) {
    // Greedy word-wrap: if total width exceeds maxWidth, break into rows
    const totalW = words.reduce((s, m, i) => s + m.width + (i > 0 ? spaceW : 0), 0)
    if (totalW > maxW && words.length > 1) {
      let row: T[] = []
      let rowW = 0
      for (const m of words) {
        const addW = row.length > 0 ? spaceW + m.width : m.width
        if (row.length > 0 && rowW + addW > maxW) {
          rows.push(row)
          row = [m]
          rowW = m.width
        } else {
          row.push(m)
          rowW += addW
        }
      }
      if (row.length) rows.push(row)
    } else {
      rows.push(words)
    }
  } else {
    const perRow = Math.ceil(words.length / numLines)
    for (let r = 0; r < numLines; r++) {
      const slice = words.slice(r * perRow, (r + 1) * perRow)
      if (slice.length) rows.push(slice)
    }
  }
  return rows
}

/** Total width of each row (words + inter-word spacing). */
export function computeRowWidths<T extends { width: number }>(
  rows: T[][],
  spaceW: number
): number[] {
  return rows.map((row) => {
    let w = 0
    row.forEach((m, i) => {
      w += m.width
      if (i < row.length - 1) w += spaceW
    })
    return w
  })
}

export interface BgBoxResult {
  bgW: number
  bgH: number
  totalTextH: number
}

/** Background box size — includes stroke padding so it matches the backend
 *  when outline width > 0. */
export function computeBgBox(
  maxRowW: number,
  padH: number,
  strokePad: number,
  bgWidthExtra: number,
  rowsLength: number,
  textH: number,
  rowLineGap: number,
  padV: number,
  bgHeightExtra: number
): BgBoxResult {
  const bgW = maxRowW + padH * 2 + strokePad * 2 + bgWidthExtra
  const totalTextH = rowsLength * textH + (rowsLength - 1) * rowLineGap
  const bgH = totalTextH + padV * 2 + strokePad * 2 + bgHeightExtra
  return { bgW, bgH, totalTextH }
}

export interface AlignShift {
  alignShiftX: number
  alignShiftY: number
}

/** Slack-driven text shift within the bg box when bgWidthExtra/bgHeightExtra > 0
 *  and alignment isn't center/middle. */
export function computeAlignShift(
  alignH: string,
  alignV: string,
  bgWidthExtra: number,
  bgHeightExtra: number
): AlignShift {
  const alignShiftX =
    alignH === 'left' ? -bgWidthExtra / 2 : alignH === 'right' ? bgWidthExtra / 2 : 0
  const alignShiftY =
    alignV === 'top' ? -bgHeightExtra / 2 : alignV === 'bottom' ? bgHeightExtra / 2 : 0
  return { alignShiftX, alignShiftY }
}

export interface WordPositions {
  wordXPos: number[]
  wordYPos: number[]
}

/** Per-word cursor advancement: lays out each row centered on cx, stacking rows
 *  centered on cy. wordYPos is the visual centre of each row (not baseline). */
export function computeWordPositions<T extends { width: number }>(
  rows: T[][],
  rowWidths: number[],
  cx: number,
  cy: number,
  alignShiftX: number,
  alignShiftY: number,
  txOff: number,
  tyOff: number,
  totalTextH: number,
  textH: number,
  rowLineGap: number,
  effectiveSpaceW: number
): WordPositions {
  const wordXPos: number[] = []
  const wordYPos: number[] = []
  rows.forEach((row, ri) => {
    const rowY = cy + alignShiftY + tyOff - totalTextH / 2 + textH / 2 + ri * (textH + rowLineGap)
    let wx = cx + alignShiftX + txOff - rowWidths[ri] / 2
    row.forEach((m) => {
      wordXPos.push(wx)
      wordYPos.push(rowY)
      wx += m.width + effectiveSpaceW
    })
  })
  return { wordXPos, wordYPos }
}

// ── RSVP ("Spritz" speed-reading) layout ────────────────────────
//
// Twin of `backend/exporters/rsvp_layout.py`; that module's docstring is the spec
// and Pillow is the source of truth. Nothing here re-derives the shared scalar
// core in `./rsvp.ts` (ORP table, code-point slicing, the ease, the anchor rule).

/**
 * The horizontal window every RSVP fraction is measured against.
 *
 * Deliberately **not** a new width concept: it is the usable caption width the
 * wrap path already enforces (`resolution_w * max_width`, i.e. the hook's `maxW`),
 * centred on the row's own anchor.
 */
export interface CaptionBand {
  left: number
  width: number
}

/**
 * The caption band of a row whose text is centred on `rowCenterX`.
 *
 * `rowCenterX` must be the exact centre the row's text is placed around —
 * `cx + alignShiftX + txOff`, the Canvas twin of the `center_x` Pillow hands
 * `_draw_word_list` — so band, pivot, reticle, edge fade and the group background
 * box all sit on the same column as the text.
 */
export function rsvpCaptionBand(bandWidth: number, rowCenterX: number): CaptionBand {
  return { left: rowCenterX - bandWidth / 2, width: bandWidth }
}

/** The pivot (focus) column for a 0–1 fraction of the band (0 = left, 1 = right). */
export function rsvpPivotColumn(band: CaptionBand, fraction: number): number {
  return band.left + band.width * fraction
}

/**
 * The one inter-character gap a prefix measurement is short of.
 *
 * `measureTrackedWidth` counts `n - 1` gaps (as does Pillow's `_measure_tracked`),
 * so the pen position of the character *after* a non-empty prefix is one
 * `tracking` further right. `focusOffset` takes a single `measure` callback and
 * cannot express that, so both the layout below and the hook's three-piece pen
 * walk add it from here — one helper, so the two cannot drift. With `tracking = 0`
 * (the default) it is 0 and both reduce to a plain prefix measurement.
 */
export function rsvpTrackingGap(prefix: string, tracking: number): number {
  return prefix && tracking ? tracking : 0
}

/** One word of an RSVP line: its token, its line advance and its timing. */
export interface RsvpWordMetric extends RsvpWordTiming {
  word: string
  width: number
}

export interface RsvpLayoutInput {
  /** The group's words in line order (`lines` is forced to 1 — one unwrapped row). */
  words: readonly RsvpWordMetric[]
  /**
   * `(wordIndex, text) -> advance width` for a *prefix* of a word, measured in
   * that word's OWN font, so a per-word font/size override still lands its focus
   * glyph on the pivot. Tracking must be honoured with the `n - 1` convention.
   */
  measurePrefix: (index: number, text: string) => number
  /** Inter-word advance (the wrap path's `effectiveSpaceW`). */
  spaceW: number
  tracking: number
  pivotPx: number
  /** Slide length in plain SECONDS; `<= 0` snaps. */
  slideDuration: number
  currentTime: number
  // Vertical placement — the wrap path's inputs, used with the identical formula.
  cy: number
  alignShiftY: number
  tyOff: number
  totalTextH: number
  textH: number
}

export interface RsvpPositions extends WordPositions {
  /** Each word's left edge in line-origin space, i.e. before `lineX`. */
  wordX: number[]
  /** Each word's focus-glyph centre in line-origin space. */
  focusOffsets: number[]
  /** The whole line's x translation at `currentTime`. */
  lineX: number
  /**
   * The word the line is parked on (`lastStartedIndex`) — and therefore the ONLY
   * word that gets the focus/active colours. Deliberately **not** the
   * `start <= t < end` test the decoration modes use: that has no answer in
   * inter-word silence, and where the two merely disagree (overlapping timings, a
   * manually reordered group) it would colour a word that is not on the pivot.
   */
  anchorIndex: number
  /** Visual centre of the single row (the reticle's `centerY`). */
  rowCenterY: number
}

/**
 * Lay a group out as one unwrapped RSVP row and solve the line translation.
 *
 * The Canvas twin of `rsvp_layout.layout_line()` plus its caller's vertical
 * placement: `wordXPos` is absolute (`wordX[i] + lineX`), `wordYPos` is the row's
 * visual centre repeated, exactly as {@link computeWordPositions} reports for a
 * single row — so a per-word `fontSizeScale` stays centred on the line's midline
 * through the same baseline shift the wrap path uses.
 */
export function computeRsvpPositions({
  words,
  measurePrefix,
  spaceW,
  tracking,
  pivotPx,
  slideDuration,
  currentTime,
  cy,
  alignShiftY,
  tyOff,
  totalTextH,
  textH,
}: RsvpLayoutInput): RsvpPositions {
  const wordX: number[] = []
  let x = 0
  for (const w of words) {
    wordX.push(x)
    x += w.width + spaceW
  }

  const focusOffsets = words.map((w, i) => {
    const f = orpIndex(w.word)
    const offset = focusOffset(wordX[i], w.word, f, (s) => measurePrefix(i, s))
    return offset + rsvpTrackingGap(focusSlices(w.word, f).prefix, tracking)
  })

  const lineX = lineOffsetAt(currentTime, words, focusOffsets, pivotPx, slideDuration)
  // Same expression as computeWordPositions' `rowY` with ri = 0.
  const rowCenterY = cy + alignShiftY + tyOff - totalTextH / 2 + textH / 2

  return {
    wordXPos: wordX.map((wx) => wx + lineX),
    wordYPos: words.map(() => rowCenterY),
    wordX,
    focusOffsets,
    lineX,
    anchorIndex: lastStartedIndex(currentTime, words),
    rowCenterY,
  }
}

/**
 * Alpha multiplier for one RSVP word: the anchor word is undimmed, every other
 * word is dimmed by `rsvpContextOpacity`.
 *
 * Applied as `ctx.globalAlpha`, which dims the **fill, the stroke and the drop
 * shadow together** — Pillow had to dim its stroke explicitly (`_dim_alpha`)
 * because dimming only the fill drew context words as solid outlines around a
 * ghost. The same multiplier scales a context word's per-word background box, so
 * a dimmed word never keeps a full-strength box.
 */
export function rsvpWordAlpha(
  animAlpha: number,
  contextOpacity: number,
  isAnchor: boolean
): number {
  return isAnchor ? animAlpha : animAlpha * contextOpacity
}

// Reticle geometry — every value is a multiple of the line's text height, so the
// reticle scales with font size. Must stay equal to `rsvp_layout.py`'s constants
// of the same names (pinned there by backend/tests/test_rsvp_reticle.py).

/** Total length of each rule, as a multiple of the line's text height. */
export const RETICLE_RULE_LEN_EM = 1.1
/** Rule/notch thickness, as a multiple of text height (floored at 1 px). */
export const RETICLE_THICKNESS_EM = 0.055
/** Clearance between the line's text box and the nearer edge of each rule. */
export const RETICLE_GAP_EM = 0.32
/** Length of the notch that points from each rule back toward the text. */
export const RETICLE_NOTCH_LEN_EM = 0.2

/** A `fillRect`-ready box: exclusive at the far edge, like a CSS box. */
export interface RsvpRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The pivot reticle: a short rule with an inward notch, above and below the line.
 *
 * Returned in Pillow's draw order (upper rule, lower rule, upper notch, lower
 * notch). Pillow fills the **half-open** box `[x0, x1) x [y0, y1)` precisely so
 * that its drawn size *is* the EM formula — `ImageDraw.rectangle` includes both
 * endpoints while `fillRect(x, y, w, h)` does not — so Canvas can use the formula
 * directly, and rule and notch come out exactly contiguous.
 */
export function computeRsvpReticleRects(
  pivotPx: number,
  centerY: number,
  textH: number
): RsvpRect[] {
  const thickness = Math.max(1, textH * RETICLE_THICKNESS_EM)
  const halfLen = (textH * RETICLE_RULE_LEN_EM) / 2
  const gap = textH * RETICLE_GAP_EM
  const notch = textH * RETICLE_NOTCH_LEN_EM
  const halfThick = thickness / 2

  const top = centerY - textH / 2 - gap // inner edge of the upper rule
  const bottom = centerY + textH / 2 + gap // inner edge of the lower rule
  const ruleX = pivotPx - halfLen
  const ruleW = pivotPx + halfLen - ruleX
  const notchX = pivotPx - halfThick
  const notchW = pivotPx + halfThick - notchX

  return [
    { x: ruleX, y: top - thickness, w: ruleW, h: thickness },
    { x: ruleX, y: bottom, w: ruleW, h: thickness },
    // Notches point back toward the text so the eye is guided to the pivot.
    { x: notchX, y: top, w: notchW, h: notch },
    { x: notchX, y: bottom - notch, w: notchW, h: notch },
  ]
}

/**
 * Alpha (0–1) of the edge-fade ramp at column centre `x` — the twin of
 * `rsvp_layout._fade_alpha` (which reports 0–255).
 *
 * 0 → 1 over the leftmost `rsvpEdgeFade` of the band, 1 → 0 over the rightmost,
 * and 0 outside the band by continuity — the band is a window, so a focus column
 * placed inside the ramp genuinely dims (not clamped: silently rewriting the
 * user's pivot would be worse than the visible consequence). A fade of 0 is a
 * clean **no-op**: no mask at all, so an unmasked line may overflow the band,
 * which is what "no edge fade" means.
 */
export function rsvpEdgeFadeAlpha(x: number, band: CaptionBand, fadeFrac: number): number {
  const fadePx = band.width * fadeFrac
  if (!(fadePx > 0)) return 1
  const right = band.left + band.width
  if (x < band.left || x > right) return 0
  const distance = Math.min(x - band.left, right - x)
  return Math.min(Math.max(distance / fadePx, 0), 1)
}

/** The edge fade's gradient stops, as `[offset, alpha]` pairs across the band. */
export type RsvpFadeStop = readonly [offset: number, alpha: number]

/**
 * Colour stops for the edge-fade gradient, spanning the band from `left` to
 * `right` — an alpha **mask**, never a clip, so a word straddling the band edge
 * dissolves instead of being sliced.
 *
 * `null` when the fade is off (or the band is degenerate), which the caller must
 * treat as "apply no mask", mirroring `apply_edge_fade`'s early return. The
 * terminal stops sit at alpha 0, and a canvas gradient extends its end stops, so
 * a `destination-in` fill also clears every pixel outside the band — the same
 * continuity `_fade_alpha` gets from returning 0 there.
 *
 * The ramp fraction is clamped to 0.5 (where the two ramps meet at alpha 1);
 * `rsvp_edge_fade` is `le=0.5` in `VideoRenderConfig`, so that is the schema's own
 * ceiling rather than a Canvas-only limit.
 */
export function rsvpFadeGradientStops(band: CaptionBand, fadeFrac: number): RsvpFadeStop[] | null {
  if (!(band.width * fadeFrac > 0)) return null
  const f = Math.min(fadeFrac, 0.5)
  return [
    [0, 0],
    [f, 1],
    [1 - f, 1],
    [1, 0],
  ]
}

/** 0..1 progress of the active word through its own [start,end) span; 0 when inactive. */
export function computeWordProgress(
  currentTime: number,
  start: number,
  end: number,
  isActive: boolean
): number {
  const wordDur = Math.max(end - start, 0.001)
  return isActive ? Math.min(Math.max((currentTime - start) / wordDur, 0), 1) : 0
}

export interface CrossfadeFactors {
  fi: number
  fo: number
}

/** Crossfade word_transition timing: fade-in factor (fi) and fade-out factor (fo),
 *  each ramping over `duration` seconds at the word's start/end. */
export function computeCrossfadeFactors(
  currentTime: number,
  start: number,
  end: number,
  duration: number
): CrossfadeFactors {
  const fi = Math.min(Math.max((currentTime - start) / duration, 0), 1)
  const fo = Math.min(Math.max((end - currentTime) / duration, 0), 1)
  return { fi, fo }
}

/** Vertical bounce offset for the 'bounce' word_transition (sine arc over word progress). */
export function computeBounceAmount(textH: number, strength: number, wordProg: number): number {
  return textH * strength * Math.sin(wordProg * Math.PI)
}

// ── Color helpers (canvas-free) ─────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.startsWith('#') ? hex.slice(1) : hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): string {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(',')})`
}
