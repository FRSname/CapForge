/**
 * Static-markup tests (node env, react-dom/server) for the shared modal scrim
 * and card. No DOM events here: Escape and the scrim click are wired in the
 * component and exercised by hand.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModalShell } from './ModalShell'

function shell(open: boolean, width?: string): string {
  return renderToStaticMarkup(
    <ModalShell open={open} onClose={() => {}} label="Test dialog" width={width}>
      <p>inner content</p>
    </ModalShell>
  )
}

describe('ModalShell', () => {
  test('closed renders nothing at all', () => {
    expect(shell(false)).toBe('')
  })

  test('open renders a labelled modal dialog around its children', () => {
    const html = shell(true)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Test dialog"')
    expect(html).toContain('inner content')
  })

  test('the card takes the default width, or the one asked for', () => {
    expect(shell(true)).toContain('w-[560px]')
    expect(shell(true, 'w-[520px]')).toContain('w-[520px]')
    expect(shell(true, 'w-[520px]')).not.toContain('w-[560px]')
  })

  test('colours come from the theme variables, never a hardcoded one', () => {
    const html = shell(true)
    expect(html).toContain('bg-[var(--color-surface)]')
    expect(html).toContain('z-[var(--z-modal)]')
    expect(html).not.toContain('bg-white')
    expect(html).not.toContain('text-white')
  })
})
