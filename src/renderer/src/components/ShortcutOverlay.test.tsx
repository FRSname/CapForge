/**
 * Static-markup tests (node env, react-dom/server) for the `?` overlay —
 * dialog semantics and that it renders every section from lib/shortcuts.ts.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShortcutOverlay } from './ShortcutOverlay'
import { SHORTCUT_SECTIONS } from '../lib/shortcuts'

describe('ShortcutOverlay', () => {
  test('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<ShortcutOverlay open={false} onClose={() => {}} />)
    expect(html).toBe('')
  })

  test('renders a modal dialog when open', () => {
    const html = renderToStaticMarkup(<ShortcutOverlay open onClose={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Keyboard shortcuts"')
    expect(html).toContain('pop-in')
  })

  test('renders every section and item from the shared constant', () => {
    const html = renderToStaticMarkup(<ShortcutOverlay open onClose={() => {}} />)
    for (const section of SHORTCUT_SECTIONS) {
      expect(html).toContain(section.title)
      for (const item of section.items) {
        expect(html).toContain(item.description)
      }
    }
  })

  test('keys render as styled kbd chips', () => {
    const html = renderToStaticMarkup(<ShortcutOverlay open onClose={() => {}} />)
    expect(html).toContain('<kbd class="kbd">')
  })
})
