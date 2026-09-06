/**
 * Static-markup tests (node env, react-dom/server) for ColorSwatch's gradient mode.
 *
 * The popover only exists once opened, and this harness has no jsdom, so the
 * interactive half (open, edit a stop, add/remove) is not reachable here. What
 * IS reachable — and is what a regression would break first — is the collapsed
 * row: whether a gradient value is *recognised* at all, whether the swatch shows
 * it, and whether `allowGradient` actually gates the feature. The gradient
 * grammar itself is pinned by `lib/gradient.test.ts` against the shared fixture.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ColorSwatch, clampStopOffset, widestSegmentIndex } from './ColorSwatch'
import { gradientToCss, parseGradient } from '../../lib/gradient'

const GRADIENT = 'linear-gradient(45deg, #FF0080 0%, #21D4FD 100%)'

function render(props: Parameters<typeof ColorSwatch>[0]) {
  return renderToStaticMarkup(<ColorSwatch {...props} />)
}

describe('ColorSwatch', () => {
  test('paints a plain hex on the swatch and keeps the editable hex field', () => {
    const html = render({ label: 'Text', value: '#D4952A', onChange: () => {} })
    expect(html).toContain('background:#D4952A')
    expect(html).toContain('#D4952A')
    expect(html).toContain('placeholder="#RRGGBB"')
  })

  test('paints a gradient value on the swatch when allowGradient is set', () => {
    const html = render({
      label: 'Text',
      value: GRADIENT,
      onChange: () => {},
      allowGradient: true,
    })
    expect(html).toContain('linear-gradient(45deg, #FF0080 0%, #21D4FD 100%)')
    expect(html).toContain('title="Gradient"')
    // The hex input is replaced by a summary — a gradient string does not fit,
    // and typing one into a 7-char hex field is not a thing anyone can do.
    expect(html).toContain('2 stops')
    expect(html).not.toContain('placeholder="#RRGGBB"')
  })

  test('without allowGradient a gradient value is NOT treated as one', () => {
    // The gate is real: the other four colour swatches must keep the solid-only
    // UI, because nothing downstream honours a gradient on them.
    const html = render({ label: 'Active', value: GRADIENT, onChange: () => {} })
    expect(html).toContain('placeholder="#RRGGBB"')
    expect(html).not.toContain('title="Gradient"')
    expect(html).not.toContain('stops')
  })

  test('a malformed gradient falls back to the solid UI', () => {
    // `parseGradient` rejects it, so the component must not render a
    // half-initialised gradient editor around a value it cannot represent.
    const html = render({
      label: 'Text',
      value: 'linear-gradient(90deg, rgb(1,2,3) 0%, #00FF00 100%)',
      onChange: () => {},
      allowGradient: true,
    })
    expect(html).toContain('placeholder="#RRGGBB"')
    expect(html).not.toContain('title="Gradient"')
  })
})

describe('clampStopOffset', () => {
  const stops = [
    { offset: 0, color: '#FF0000' },
    { offset: 0.4, color: '#00FF00' },
    { offset: 1, color: '#0000FF' },
  ]

  test('passes a value that is already between its neighbours', () => {
    expect(clampStopOffset(stops, 1, 25)).toBeCloseTo(0.25, 6)
  })

  test('leaves a middle stop alone while it is still between its neighbours', () => {
    // Stop 2's upper neighbour is at 100%, so 95% is legitimately reachable —
    // the clamp must not over-constrain.
    expect(clampStopOffset(stops, 1, 95)).toBeCloseTo(0.95, 6)
  })

  test('clamps a middle stop to the neighbour it is dragged past', () => {
    const tight = [
      { offset: 0.2, color: '#FF0000' },
      { offset: 0.4, color: '#00FF00' },
      { offset: 0.5, color: '#0000FF' },
    ]
    expect(clampStopOffset(tight, 1, 95)).toBeCloseTo(0.5, 6) // up into stop 3
    expect(clampStopOffset(tight, 1, 0)).toBeCloseTo(0.2, 6) // down into stop 1
  })

  test('the first and last stops are bounded by 0 and 1', () => {
    expect(clampStopOffset(stops, 0, -50)).toBe(0)
    expect(clampStopOffset(stops, 2, 500)).toBe(1)
    // ...but a first stop still cannot pass the one after it.
    expect(clampStopOffset(stops, 0, 90)).toBeCloseTo(0.4, 6)
  })

  test('a non-finite drag falls back to the lower bound rather than NaN', () => {
    expect(clampStopOffset(stops, 1, Number.NaN)).toBeCloseTo(0, 6)
  })

  test('the clamped result always re-parses — which is the whole point', () => {
    // An out-of-order list fails `parseGradient`, and ColorSwatch reads its mode
    // back off the committed value, so an unclamped drag would drop the editor
    // out of gradient mode. Every clamped drag must survive the round trip.
    for (const percent of [-100, 0, 10, 39, 40, 41, 80, 100, 250]) {
      const moved = stops.map((s, i) =>
        i === 1 ? { ...s, offset: clampStopOffset(stops, 1, percent) } : s
      )
      const css = gradientToCss({ angle: 90, stops: moved })
      expect(parseGradient(css), `${percent}% produced ${css}`).not.toBeNull()
    }
  })
})

describe('widestSegmentIndex', () => {
  const at = (...offsets: number[]) =>
    widestSegmentIndex(offsets.map((offset) => ({ offset, color: '#FFFFFF' })))

  test('picks the widest gap, not the last one', () => {
    expect(at(0, 0.5, 0.5)).toBe(1) // 0–0.5 wide, 0.5–0.5 dead
    expect(at(0, 0.1, 1)).toBe(2)
  })

  test('ties resolve to the earlier segment, deterministically', () => {
    expect(at(0, 0.5, 1)).toBe(1)
  })

  test('a two-stop gradient has exactly one segment', () => {
    expect(at(0, 1)).toBe(1)
    expect(at(0.3, 0.3)).toBe(1)
  })

  test('the chosen segment always has room when any segment does', () => {
    // The property that keeps a newly added stop movable: splitting a
    // zero-width segment would give it identical neighbours.
    const stops = [0, 0.9, 0.9, 0.9].map((offset) => ({ offset, color: '#FFFFFF' }))
    const i = widestSegmentIndex(stops)
    expect(stops[i].offset - stops[i - 1].offset).toBeGreaterThan(0)
  })
})
