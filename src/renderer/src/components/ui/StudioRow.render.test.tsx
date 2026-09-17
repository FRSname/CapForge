/**
 * Static-markup tests (node env, react-dom/server) for StudioRow's chrome.
 *
 * Separate from `StudioRow.test.ts`, which pins the manual-entry clamp through
 * a pure helper and holds no JSX. What is checked here is the two things a
 * refactor breaks silently: the slider's `--fill` custom property (the styled
 * track in globals.css paints up to it, so a missing one shows an empty track)
 * and the reset glyph, which is only on-demand now — hover/focus for a clean
 * row, always for a dirty one.
 */

import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioRow } from './StudioRow'

function render(value: number) {
  return renderToStaticMarkup(
    <StudioRow label="Size" value={value} min={0} max={100} def={40} unit="px" onChange={vi.fn()} />
  )
}

describe('StudioRow', () => {
  test('paints the slider track up to the value', () => {
    expect(render(70)).toContain('--fill:70%')
    expect(render(0)).toContain('--fill:0%')
  })

  test('a clean row hides the reset glyph until the row is hovered or focused', () => {
    const html = render(40)

    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover:opacity-100')
    expect(html).toContain('focus-visible:opacity-100')
    // The hover class only works against a `group` ancestor.
    expect(html).toContain('class="group ')
    expect(html).toContain('color:var(--color-text-4)')
  })

  test('a dirty row keeps the reset glyph visible', () => {
    const html = render(70)

    expect(html).toContain('opacity-100')
    expect(html).not.toContain('opacity-0"')
    expect(html).not.toContain('group-hover:opacity-100')
  })

  test('names the reset target and its default for a screen reader', () => {
    expect(render(70)).toContain('aria-label="Reset Size to 40px"')
  })
})
