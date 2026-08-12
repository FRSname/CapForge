/**
 * What the Canvas preview actually *draws* in RSVP mode.
 *
 * The numeric layout is pinned against the Pillow reference in
 * `lib/overlayGeometry.rsvp.test.ts`; this file pins the decisions that only exist
 * in the hook — the three-piece active word, the context dimming reaching the
 * STROKE as well as the fill, the reticle's exemption from the edge fade, the
 * background box framing the band, and `wordStyle` being ignored.
 *
 * The vitest environment is plain `node`, so there is no DOM canvas: the hook is
 * driven through `react-dom/server` (which runs `useRef`/`useCallback` and skips
 * effects) with a **recording** 2D context. Every assertion is therefore about the
 * real call sequence the browser would receive, not about a re-implementation.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { useSubtitleOverlay } from './useSubtitleOverlay'
import { STUDIO_DEFAULTS, type StudioSettings } from '../components/studio/StudioPanel'
import { computeRsvpReticleRects } from '../lib/overlayGeometry'
import type { Segment } from '../types/app'

// ── Recording 2D context ─────────────────────────────────────────

/** One drawing call plus the context state that was in force for it. */
interface Recorded {
  op: string
  args: number[]
  text: string
  alpha: number
  fill: string
  stroke: string
  font: string
  composite: string
}

interface GradientRecord {
  x0: number
  x1: number
  stops: Array<[number, string]>
}

const STYLE_KEYS = [
  'globalAlpha',
  'fillStyle',
  'strokeStyle',
  'font',
  'globalCompositeOperation',
  'lineWidth',
  'lineJoin',
  'textAlign',
  'textBaseline',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
] as const

/** Per-character advance at font size 10, so a width is trivially predictable:
 *  `measureText(s).width === s.length * size / 10`. */
const CHAR_W_AT_10 = 1

function createRecordingContext() {
  const ops: Recorded[] = []
  const gradients: GradientRecord[] = []
  const stack: Record<string, unknown>[] = []

  const ctx: Record<string, unknown> = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    globalCompositeOperation: 'source-over',
    lineWidth: 0,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  }

  const fontSize = (): number => {
    const match = /(\d+(?:\.\d+)?)px/.exec(String(ctx.font))
    return match ? Number(match[1]) : 10
  }

  const record = (op: string, args: number[] = [], text = ''): void => {
    ops.push({
      op,
      args,
      text,
      alpha: ctx.globalAlpha as number,
      fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '<gradient>',
      stroke: String(ctx.strokeStyle),
      font: String(ctx.font),
      composite: String(ctx.globalCompositeOperation),
    })
  }

  Object.assign(ctx, {
    save: () => {
      const snapshot: Record<string, unknown> = {}
      for (const key of STYLE_KEYS) snapshot[key] = ctx[key]
      stack.push(snapshot)
    },
    restore: () => {
      const snapshot = stack.pop()
      if (snapshot) Object.assign(ctx, snapshot)
    },
    clearRect: () => record('clearRect'),
    translate: (x: number, y: number) => record('translate', [x, y]),
    scale: (x: number, y: number) => record('scale', [x, y]),
    setTransform: (...a: number[]) => record('setTransform', a),
    measureText: (s: string) => {
      const size = fontSize()
      return {
        width: (s.length * CHAR_W_AT_10 * size) / 10,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
        fontBoundingBoxAscent: size * 0.9,
      }
    },
    fillText: (t: string, x: number, y: number) => record('fillText', [x, y], t),
    strokeText: (t: string, x: number, y: number) => record('strokeText', [x, y], t),
    fillRect: (x: number, y: number, w: number, h: number) => record('fillRect', [x, y, w, h]),
    beginPath: () => record('beginPath'),
    moveTo: (x: number, y: number) => record('moveTo', [x, y]),
    lineTo: (x: number, y: number) => record('lineTo', [x, y]),
    quadraticCurveTo: (...a: number[]) => record('quadraticCurveTo', a),
    closePath: () => record('closePath'),
    fill: () => record('fill'),
    createLinearGradient: (x0: number, _y0: number, x1: number, _y1: number) => {
      const gradient: GradientRecord = { x0, x1, stops: [] }
      gradients.push(gradient)
      return {
        addColorStop: (offset: number, color: string) => gradient.stops.push([offset, color]),
      }
    },
  })

  return { ctx, ops, gradients }
}

// ── Harness ──────────────────────────────────────────────────────

const RES_W = 1000
const RES_H = 500
const FONT_SIZE = 40
/** textH = ascent + descent = 0.8*size + 0.2*size = the font size exactly. */
const TEXT_H = FONT_SIZE
const CHAR_W = (CHAR_W_AT_10 * FONT_SIZE) / 10 // 4 px per character

const WORDS = [
  { word: 'alpha', start: 0, end: 0.5 },
  { word: 'bravo', start: 0.5, end: 1 },
  { word: 'charlie', start: 1, end: 1.5 },
]

const GROUP: Segment = {
  id: 'g0',
  text: 'alpha bravo charlie',
  start: 0,
  end: 1.5,
  words: WORDS.map((w) => ({ ...w })),
}

const BASE_SETTINGS: StudioSettings = {
  ...STUDIO_DEFAULTS,
  fontName: 'Test',
  fontSize: FONT_SIZE,
  animationType: 'none',
  bgOpacity: 0,
  outlineWidth: 4,
  outlineColor: '#112233',
  textColor: '#FFFFFF',
  activeColor: '#F5C842',
  shadowEnabled: false,
  readingMode: 'rsvp',
}

/** Band geometry implied by the settings above: posX 50 %, maxWidth 90 %. */
const BAND_LEFT = RES_W / 2 - (RES_W * 0.9) / 2 // 50
const BAND_WIDTH = RES_W * 0.9 // 900
const PIVOT = BAND_LEFT + BAND_WIDTH * (STUDIO_DEFAULTS.rsvpPivotX / 100) // 365
/** posY 82 %, no vertical offsets, one row → the row centre is cy itself. */
const ROW_CENTER_Y = RES_H * (STUDIO_DEFAULTS.posY / 100)

function draw(
  settings: Partial<StudioSettings>,
  t: number,
  group: Segment | Segment[] = GROUP
) {
  const { ctx, ops, gradients } = createRecordingContext()
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement

  const Probe = () => {
    const overlay = useSubtitleOverlay({
      canvasRef: { current: canvas },
      anchorRef: { current: null },
      segments: Array.isArray(group) ? group : [group],
      settings: { ...BASE_SETTINGS, ...settings },
      resolution: [RES_W, RES_H],
    })
    overlay.draw(t)
    return null
  }
  renderToStaticMarkup(createElement(Probe))

  return { ops, gradients }
}

const texts = (ops: Recorded[], op = 'fillText') => ops.filter((o) => o.op === op)

// Mid-hold on 'bravo' (index 1): 0.3 s past its start, well clear of the 60 ms slide.
const MID_HOLD_T = 0.8
// wordX = [0, 24, 48] (word 5*4 px + space 4 px). 'bravo' focuses on index 1, so
// its focus offset is 24 + 4 + 4/2 = 30 and the line translates by PIVOT - 30.
const LINE_X = PIVOT - 30
const ALPHA_X = LINE_X
const BRAVO_X = LINE_X + 24
const CHARLIE_X = LINE_X + 48

/** The one glyph drawn in the focus colour. */
const focusGlyph = (ops: Recorded[]) =>
  ops.filter((o) => o.op === 'fillText' && o.fill === STUDIO_DEFAULTS.rsvpFocusColor)

describe('RSVP: the active word is drawn in three pieces', () => {
  test('prefix / focus glyph / suffix, in the focus and active colours', () => {
    const { ops } = draw({}, MID_HOLD_T)
    const drawn = texts(ops)

    expect(drawn.map((o) => o.text)).toEqual(['alpha', 'b', 'r', 'avo', 'charlie'])
    const [alpha, prefix, focus, suffix, charlie] = drawn
    expect(prefix.fill).toBe(BASE_SETTINGS.activeColor)
    expect(focus.fill).toBe(STUDIO_DEFAULTS.rsvpFocusColor)
    expect(suffix.fill).toBe(BASE_SETTINGS.activeColor)
    // The pen walks with the layout's own advances, so the focus glyph's CENTRE
    // lands on the pivot column.
    expect(alpha.args[0]).toBeCloseTo(ALPHA_X, 9)
    expect(charlie.args[0]).toBeCloseTo(CHARLIE_X, 9)
    expect(prefix.args[0]).toBeCloseTo(BRAVO_X, 9)
    expect(focus.args[0]).toBeCloseTo(BRAVO_X + CHAR_W, 9)
    expect(focus.args[0] + CHAR_W / 2).toBeCloseTo(PIVOT, 9)
    expect(suffix.args[0]).toBeCloseTo(BRAVO_X + 2 * CHAR_W, 9)
  })

  test('the tracking gap is added between the pieces, not only inside them', () => {
    const tracking = 7
    // With tracking the draw primitive walks character by character, so the pieces
    // show up as individual glyphs; the focus colour is what identifies the middle.
    const { ops } = draw({ tracking }, MID_HOLD_T)
    const drawn = texts(ops)
    const [focus] = focusGlyph(ops)
    const at = drawn.indexOf(focus)
    const prefixChar = drawn[at - 1]
    const suffixChar = drawn[at + 1]

    expect([prefixChar.text, focus.text, suffixChar.text]).toEqual(['b', 'r', 'a'])
    // One gap per drawn character (n gaps) where a measurement counts n-1: the
    // focus glyph is one `tracking` further right than a naive prefix width, which
    // is exactly what `rsvpTrackingGap` adds at the layout AND the draw site.
    expect(focus.args[0]).toBeCloseTo(prefixChar.args[0] + CHAR_W + tracking, 9)
    expect(suffixChar.args[0]).toBeCloseTo(focus.args[0] + CHAR_W + tracking, 9)
    // ...and the glyph is still centred on the pivot, unmoved by the tracking.
    expect(focus.args[0] + CHAR_W / 2).toBeCloseTo(PIVOT, 9)
  })

  test('every word sits on one row — `lines` is forced to 1', () => {
    const { ops } = draw({ lines: 3 }, MID_HOLD_T)
    const drawn = texts(ops)

    expect(new Set(drawn.map((o) => o.args[1])).size).toBe(1)
    expect(drawn.map((o) => o.text)).toEqual(['alpha', 'b', 'r', 'avo', 'charlie'])
  })

  test('a per-word pos_offset_x moves the word AND its focus glyph', () => {
    const nudged: Segment = {
      ...GROUP,
      words: WORDS.map((w, i) => (i === 1 ? { ...w, overrides: { pos_offset_x: 30 } } : { ...w })),
    }
    const { ops } = draw({}, MID_HOLD_T, nudged)
    const focus = texts(ops)[2]

    expect(focus.args[0] + CHAR_W / 2).toBeCloseTo(PIVOT + 30, 9)
  })
})

describe('RSVP: context words are dimmed, fill and stroke together', () => {
  test('the non-anchor words draw at animAlpha * rsvpContextOpacity', () => {
    const { ops } = draw({}, MID_HOLD_T)
    const drawn = texts(ops)
    const context = [drawn[0], drawn[4]]

    for (const word of context) {
      expect(word.alpha).toBeCloseTo(STUDIO_DEFAULTS.rsvpContextOpacity, 9)
      expect(word.fill).toBe(BASE_SETTINGS.textColor)
    }
    // The anchor word's three pieces are NOT dimmed.
    for (const piece of drawn.slice(1, 4)) expect(piece.alpha).toBe(1)
  })

  test('the outline is dimmed too — not a solid outline around a ghost', () => {
    const { ops } = draw({}, MID_HOLD_T)
    const stroked = texts(ops, 'strokeText')

    expect(stroked.map((o) => o.text)).toEqual(['alpha', 'b', 'r', 'avo', 'charlie'])
    // globalAlpha covers the stroke, which is why Canvas needs no equivalent of
    // Pillow's explicit `_dim_alpha` on `stroke_rgba`.
    expect(stroked[0].alpha).toBeCloseTo(STUDIO_DEFAULTS.rsvpContextOpacity, 9)
    expect(stroked[4].alpha).toBeCloseTo(STUDIO_DEFAULTS.rsvpContextOpacity, 9)
    expect(stroked[1].alpha).toBe(1)
    expect(stroked[0].stroke).toBe(BASE_SETTINGS.outlineColor)
  })

  test('a per-word text_color overrides only that context word', () => {
    const tinted: Segment = {
      ...GROUP,
      words: WORDS.map((w, i) =>
        i === 0 ? { ...w, overrides: { text_color: '#00FF00' } } : { ...w }
      ),
    }
    const { ops } = draw({}, MID_HOLD_T, tinted)
    const drawn = texts(ops)

    expect(drawn[0].fill).toBe('#00FF00')
    expect(drawn[4].fill).toBe(BASE_SETTINGS.textColor)
  })

  test('a per-word active_word_color recolours the anchor word around its focus glyph', () => {
    const tinted: Segment = {
      ...GROUP,
      words: WORDS.map((w, i) =>
        i === 1 ? { ...w, overrides: { active_word_color: '#123456' } } : { ...w }
      ),
    }
    const { ops } = draw({}, MID_HOLD_T, tinted)
    const drawn = texts(ops)

    expect([drawn[1].fill, drawn[3].fill]).toEqual(['#123456', '#123456'])
    expect(drawn[2].fill).toBe(STUDIO_DEFAULTS.rsvpFocusColor)
  })
})

describe('RSVP: the pivot reticle', () => {
  const reticleRects = (ops: Recorded[]) =>
    ops.filter((o) => o.op === 'fillRect' && o.fill === STUDIO_DEFAULTS.rsvpFocusColor)

  test('draws the four EM boxes at the pivot, in the focus colour', () => {
    const { ops } = draw({}, MID_HOLD_T)
    const expected = computeRsvpReticleRects(PIVOT, ROW_CENTER_Y, TEXT_H)

    expect(reticleRects(ops).map((o) => o.args)).toEqual(expected.map((r) => [r.x, r.y, r.w, r.h]))
  })

  test('is a clean no-op when switched off', () => {
    const { ops } = draw({ rsvpReticle: false }, MID_HOLD_T)

    expect(reticleRects(ops)).toEqual([])
  })

  test('is NOT dimmed by the edge fade: it is composited outside the mask', () => {
    // A pivot of 0 sits inside the fade ramp — legal (`rsvpPivotX` is ge=0) and
    // exactly where a masked reticle would vanish.
    const { ops } = draw({ rsvpPivotX: 0 }, MID_HOLD_T)
    const mask = ops.findIndex((o) => o.composite === 'destination-in')
    const rects = reticleRects(ops)

    expect(mask).toBeGreaterThan(-1)
    for (const rect of rects) {
      expect(rect.alpha).toBe(1)
      // Drawn after the mask, and *under* the already-masked caption.
      expect(ops.indexOf(rect)).toBeGreaterThan(mask)
      expect(rect.composite).toBe('destination-over')
    }
    expect(rects).toHaveLength(4)
  })

  test('with the fade off it is drawn between the per-word boxes and the words', () => {
    const { ops } = draw({ rsvpEdgeFade: 0 }, MID_HOLD_T)
    const rects = reticleRects(ops)

    expect(ops.some((o) => o.composite !== 'source-over')).toBe(false)
    expect(rects).toHaveLength(4)
    const firstWord = ops.findIndex((o) => o.op === 'fillText')
    expect(ops.indexOf(rects[0])).toBeLessThan(firstWord)
  })
})

describe('RSVP: the edge fade', () => {
  test('masks the caption with the band ramp — a gradient, never a clip', () => {
    const { ops, gradients } = draw({}, MID_HOLD_T)
    const fade = STUDIO_DEFAULTS.rsvpEdgeFade / 100

    expect(gradients).toHaveLength(1)
    expect(gradients[0].x0).toBeCloseTo(BAND_LEFT, 9)
    expect(gradients[0].x1).toBeCloseTo(BAND_LEFT + BAND_WIDTH, 9)
    expect(gradients[0].stops.map(([, color]) => color)).toEqual([
      'rgba(0,0,0,0)',
      'rgba(0,0,0,1)',
      'rgba(0,0,0,1)',
      'rgba(0,0,0,0)',
    ])
    expect(gradients[0].stops.map(([offset]) => offset)).toEqual([0, fade, 1 - fade, 1])

    // Applied as one destination-in fill over the WHOLE canvas (so everything
    // outside the band is cleared by the gradient's alpha-0 ends), with the pop
    // transform reset because the band is in frame coordinates.
    const maskFill = ops.find((o) => o.composite === 'destination-in' && o.op === 'fillRect')!
    expect(maskFill.args).toEqual([0, 0, RES_W, RES_H])
    expect(maskFill.fill).toBe('<gradient>')
    const reset = ops.filter((o) => o.op === 'setTransform')
    expect(reset).toHaveLength(1)
    expect(reset[0].args).toEqual([1, 0, 0, 1, 0, 0])
    expect(ops.indexOf(reset[0])).toBeLessThan(ops.indexOf(maskFill))
    // Every glyph is drawn BEFORE the mask, so a straddling word dissolves.
    expect(Math.max(...texts(ops).map((o) => ops.indexOf(o)))).toBeLessThan(ops.indexOf(maskFill))
  })

  test('0 is a clean no-op: no gradient, no compositing tricks', () => {
    const { ops, gradients } = draw({ rsvpEdgeFade: 0 }, MID_HOLD_T)

    expect(gradients).toEqual([])
    expect(ops.filter((o) => o.op === 'setTransform')).toEqual([])
    expect(ops.every((o) => o.composite === 'source-over')).toBe(true)
  })

  test('masks the per-word background boxes as well as the text', () => {
    const boxed: Segment = {
      ...GROUP,
      words: WORDS.map((w, i) =>
        i === 0 ? { ...w, overrides: { word_bg_opacity: 0.9, word_bg_color: '#FF0000' } } : { ...w }
      ),
    }
    const { ops } = draw({}, MID_HOLD_T, boxed)
    const box = ops.findIndex((o) => o.op === 'fill' && o.fill === '#FF0000')
    const mask = ops.findIndex((o) => o.composite === 'destination-in')

    expect(box).toBeGreaterThan(-1)
    expect(box).toBeLessThan(mask)
  })
})

describe('RSVP: background boxes', () => {
  test('the group box spans the whole band, centred on the BAND not on cx', () => {
    // `textOffsetX` moves the band (it feeds the row centre), which is what makes
    // this discriminating: a box centred on `cx` would sit 40 px to the left.
    const offset = 40
    const settings = { bgOpacity: 50, bgColor: '#010203', marginH: 0, marginV: 0 }
    const { ops } = draw({ ...settings, textOffsetX: offset }, MID_HOLD_T)
    // roundRect() moves to (x + r, y) first, so the first moveTo carries the box's
    // left edge; the group box is the only rounded rect drawn here.
    const radius = STUDIO_DEFAULTS.bgRadius
    const strokePad = BASE_SETTINGS.outlineWidth * 2
    const boxW = BAND_WIDTH + strokePad // no padding, no extras
    const bandCenter = RES_W / 2 + offset

    expect(ops.find((o) => o.op === 'moveTo')!.args[0]).toBeCloseTo(
      bandCenter - boxW / 2 + radius,
      9
    )

    // Wrap mode still centres its box on cx and sizes it to the TEXT, so the two
    // modes really are different boxes.
    const wrap = draw({ ...settings, textOffsetX: offset, readingMode: 'wrap' }, MID_HOLD_T)
    const wrapLeft = wrap.ops.find((o) => o.op === 'moveTo')!.args[0]
    expect(wrapLeft).toBeGreaterThan(bandCenter - boxW / 2 + radius)
  })

  test('a context word keeps a dimmed box; the anchor word keeps a full one', () => {
    const boxes = { word_bg_opacity: 0.8, word_bg_color: '#FF0000' }
    const boxed: Segment = {
      ...GROUP,
      words: WORDS.map((w) => ({ ...w, overrides: { ...boxes } })),
    }
    const { ops } = draw({}, MID_HOLD_T, boxed)
    const fills = ops.filter((o) => o.op === 'fill' && o.fill === '#FF0000')

    expect(fills).toHaveLength(3)
    expect(fills[0].alpha).toBeCloseTo(0.8 * STUDIO_DEFAULTS.rsvpContextOpacity, 9)
    expect(fills[1].alpha).toBeCloseTo(0.8, 9)
    expect(fills[2].alpha).toBeCloseTo(0.8 * STUDIO_DEFAULTS.rsvpContextOpacity, 9)
  })
})

describe('RSVP ignores the decoration modes', () => {
  test('no highlight pill is drawn, whatever wordStyle says', () => {
    const { ops } = draw({ wordStyle: 'highlight' }, MID_HOLD_T)
    const pill = ops.filter((o) => o.op === 'fill' && o.fill === BASE_SETTINGS.activeColor)

    expect(pill).toEqual([])
    // ...and the words are still the RSVP three-piece split, not highlight's
    // "active word in the highlight text colour".
    expect(texts(ops).map((o) => o.text)).toEqual(['alpha', 'b', 'r', 'avo', 'charlie'])
  })

  test('a per-word word_transition override changes nothing', () => {
    const scaled: Segment = {
      ...GROUP,
      words: WORDS.map((w, i) =>
        i === 1 ? { ...w, overrides: { word_transition: 'scale', scale_factor: 2 } } : { ...w }
      ),
    }
    const plain = draw({}, MID_HOLD_T)
    const withOverride = draw({}, MID_HOLD_T, scaled)

    expect(withOverride.ops.filter((o) => o.op === 'scale')).toEqual([])
    expect(withOverride.ops.map((o) => [o.op, o.text, o.args])).toEqual(
      plain.ops.map((o) => [o.op, o.text, o.args])
    )
  })
})

describe('wrap mode is untouched by the RSVP branch', () => {
  test('words are wrapped, centred and the highlight pill is drawn', () => {
    const { ops, gradients } = draw({ readingMode: 'wrap', wordStyle: 'highlight' }, MID_HOLD_T)
    const drawn = texts(ops)

    // Whole words, no three-piece split, and one row centred on cx.
    expect(drawn.map((o) => o.text)).toEqual(['alpha', 'bravo', 'charlie'])
    const rowW = 5 * CHAR_W + CHAR_W + 5 * CHAR_W + CHAR_W + 7 * CHAR_W
    expect(drawn[0].args[0]).toBeCloseTo(RES_W / 2 - rowW / 2, 9)
    // The pill (activeColor fill) is back, and no RSVP guide or mask is drawn.
    expect(ops.some((o) => o.op === 'fill' && o.fill === BASE_SETTINGS.activeColor)).toBe(true)
    expect(gradients).toEqual([])
    expect(ops.every((o) => o.composite === 'source-over')).toBe(true)
    expect(ops.filter((o) => o.op === 'fillRect')).toEqual([])
  })
})

// ── Reels: one line across consecutive groups ────────────────────
// The rule itself is pinned against its Python twin in `lib/rsvpReels.test.ts`;
// what is asserted here is that the hook *uses* it — that a group boundary inside
// a reel is drawn as one line, and that a real gap still separates two lines.

/** Groups that leave no blank frame between them: `a.end === b.start`. */
function touchingGroups(...chunks: string[][]): Segment[] {
  const groups: Segment[] = []
  let t = 0
  chunks.forEach((chunk, gi) => {
    const words = chunk.map((word, i) => ({ word, start: t + i * 0.5, end: t + (i + 1) * 0.5 }))
    groups.push({
      id: `g${gi}`,
      text: chunk.join(' '),
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
    })
    t = words[words.length - 1].end
  })
  return groups
}

describe('RSVP draws a reel, not a group', () => {
  test('the words of both groups are on one line', () => {
    const groups = touchingGroups(['alpha', 'bravo'], ['charlie', 'delta'])
    // Mid-hold on 'charlie' — the first word of the SECOND group.
    const { ops } = draw({}, groups[1].start + 0.3, groups)

    const drawn = texts(ops)
    // 'charlie' is the anchor, so it arrives as three pieces; everything else is
    // whole — and crucially the previous group's words are still drawn.
    expect(drawn.map((o) => o.text).join('|')).toBe('alpha|bravo|ch|a|rlie|delta')
  })

  test('the line is continuous: word spacing does not reset at the boundary', () => {
    const groups = touchingGroups(['alpha', 'bravo'], ['charlie', 'delta'])
    const { ops } = draw({}, groups[1].start + 0.3, groups)

    const drawn = texts(ops)
    const [alpha, bravo, charlie] = [drawn[0], drawn[1], drawn[2]]
    // Advances are `word length * CHAR_W + space`, uniformly across the boundary:
    // if the second group started a new line, 'charlie' would jump backwards.
    const space = CHAR_W
    expect(bravo.args[0] - alpha.args[0]).toBeCloseTo('alpha'.length * CHAR_W + space, 9)
    expect(charlie.args[0] - bravo.args[0]).toBeCloseTo('bravo'.length * CHAR_W + space, 9)
  })

  test('the anchor is the reel-wide index, so the focus glyph still sits on the pivot', () => {
    const groups = touchingGroups(['alpha', 'bravo'], ['charlie', 'delta'])
    const { ops } = draw({}, groups[1].start + 0.3, groups)

    const [focus] = focusGlyph(ops)
    // 'charlie' is 7 chars → ORP index 2 ('a'), whose centre lands on the pivot.
    expect(focus.text).toBe('a')
    expect(focus.args[0] + CHAR_W / 2).toBeCloseTo(PIVOT, 9)
  })

  test('a real gap still separates the two lines', () => {
    const [first] = touchingGroups(['alpha', 'bravo'])
    const second: Segment = {
      id: 'g1',
      text: 'charlie delta',
      start: 3,
      end: 4,
      words: [
        { word: 'charlie', start: 3, end: 3.5 },
        { word: 'delta', start: 3.5, end: 4 },
      ],
    }
    const { ops } = draw({}, 3.3, [first, second])

    // Only the second group's words — the first ended 2s earlier and is gone.
    // 'charlie' is the anchor, so it arrives as its three pieces.
    expect(texts(ops).map((o) => o.text)).toEqual(['ch', 'a', 'rlie', 'delta'])
  })

  test('wrap mode is untouched — the second group is not joined', () => {
    const groups = touchingGroups(['alpha', 'bravo'], ['charlie', 'delta'])
    const { ops } = draw({ readingMode: 'wrap' }, groups[1].start + 0.3, groups)

    expect(texts(ops).map((o) => o.text)).toEqual(['charlie', 'delta'])
  })
})

describe('RSVP culls the parts of a reel that are off-window', () => {
  /**
   * 90 words of 12 characters: ~4700px of line against a 900px band and a
   * ~1550px window (band + 2 × the 8em bleed), so there is line to spare on both
   * sides — with a shorter reel every case below would draw everything and pin
   * nothing.
   */
  const LONG_REEL = touchingGroups(
    ...Array.from({ length: 30 }, (_, g) => [`word${g}aaaaaa`, `word${g}bbbbbb`, `word${g}cccccc`])
  )

  test('only the words near the band are drawn', () => {
    const words = LONG_REEL.flatMap((g) => g.words)
    // Half-way through the reel, so there is plenty of line on both sides.
    const middle = words[words.length / 2]
    const { ops } = draw({}, middle.start + 0.3, LONG_REEL)

    const drawn = texts(ops)
    expect(drawn.length).toBeGreaterThan(0)
    // +2: the anchor word is drawn as three pieces rather than one.
    expect(drawn.length).toBeLessThan(words.length + 2)
    expect(drawn.length).toBeLessThan(words.length / 2)
  })

  test('every drawn word intersects the visible window', () => {
    // The cull must be pixel-neutral, so what it drops must be off-window and
    // what it keeps must not be. Checked against the drawn x positions rather
    // than against a re-implementation of the range.
    const words = LONG_REEL.flatMap((g) => g.words)
    const middle = words[words.length / 2]
    const { ops } = draw({ rsvpEdgeFade: 12 }, middle.start + 0.3, LONG_REEL)

    const bleed = TEXT_H * 8 + BASE_SETTINGS.outlineWidth // RSVP_CULL_BLEED_EM, no shadow
    for (const drawn of texts(ops)) {
      const width = drawn.text.length * CHAR_W
      expect(drawn.args[0] + width).toBeGreaterThanOrEqual(BAND_LEFT - bleed)
      expect(drawn.args[0]).toBeLessThanOrEqual(BAND_LEFT + BAND_WIDTH + bleed)
    }
  })

  test('nothing is culled when the whole line fits', () => {
    const { ops } = draw({}, MID_HOLD_T)

    expect(texts(ops).map((o) => o.text)).toEqual(['alpha', 'b', 'r', 'avo', 'charlie'])
  })
})
