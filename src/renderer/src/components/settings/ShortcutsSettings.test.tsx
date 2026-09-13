/**
 * Static-markup test (node env, react-dom/server) for Settings → Shortcuts:
 * it must render the whole shared inventory, same as the `?` overlay does.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShortcutsSettings } from './ShortcutsSettings'
import { SHORTCUT_SECTIONS } from '../../lib/shortcuts'

describe('ShortcutsSettings', () => {
  test('renders every section title and item from the shared constant', () => {
    // Act
    const html = renderToStaticMarkup(<ShortcutsSettings />)

    // Assert
    for (const section of SHORTCUT_SECTIONS) {
      expect(html).toContain(section.title)
      for (const item of section.items) {
        expect(html).toContain(item.description)
      }
    }
  })

  test('keys render as styled kbd chips', () => {
    expect(renderToStaticMarkup(<ShortcutsSettings />)).toContain('<kbd class="kbd">')
  })
})
