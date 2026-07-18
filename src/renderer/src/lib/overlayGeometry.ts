/**
 * Pure, canvas-free geometry/animation math extracted from useSubtitleOverlay.ts.
 *
 * IMPORTANT: this is one of THREE caption renderers that must stay pixel-identical
 * (Canvas preview ↔ backend Pillow ↔ HyperFrames HTML runtime — see CLAUDE.md
 * "Preview ↔ Render Parity"). These functions were moved verbatim out of the hook —
 * same constants, same order of float operations. Do not "simplify" the arithmetic;
 * changing it here silently breaks parity with the other two renderers.
 */

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
