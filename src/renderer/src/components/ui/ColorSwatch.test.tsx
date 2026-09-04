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
import { ColorSwatch } from './ColorSwatch'

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
