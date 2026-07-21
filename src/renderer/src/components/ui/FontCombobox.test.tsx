import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { FontInfo } from '../../lib/fonts'
import { filterFonts, FontCombobox, resolveFontSelection } from './FontCombobox'

// Invariant: the portaled dropdown (rendered only while `open`, via
// createPortal to document.body) must always carry `data-cf-popover` — any
// ancestor popup with its own document-level outside-click closer relies on
// that marker to avoid treating a click on an option as "outside" (see
// WordStylePopup's onMouseDown guard). This static-markup harness never sets
// `open` to true (that requires a real click + effect run under jsdom), so it
// cannot render the portal or assert the attribute — documenting the
// invariant here instead of forcing a fake test.

const FONTS: FontInfo[] = [
  { name: 'Arial', path: '', source: 'system' },
  { name: 'Caviar Dreams', path: '/bundle/caviar.ttf', source: 'bundled' },
  { name: 'My Brand', path: '/user/brand.otf', source: 'custom' },
]

describe('FontCombobox', () => {
  test('renders an editable, accessible collapsed font field', () => {
    const html = renderToStaticMarkup(
      <FontCombobox fonts={FONTS} value="Arial" emptyLabel="System default" onChange={vi.fn()} />
    )

    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-label="Font"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('value="Arial"')
  })

  test('filters case-insensitively by family and source label', () => {
    expect(filterFonts(FONTS, 'caviar').map((font) => font.name)).toEqual(['Caviar Dreams'])
    expect(filterFonts(FONTS, 'CUSTOM').map((font) => font.name)).toEqual(['My Brand'])
    expect(filterFonts(FONTS, 'installed').map((font) => font.name)).toEqual(['Arial'])
  })

  test('resolves the complete original selection for Escape rollback', () => {
    expect(resolveFontSelection(FONTS, 'My Brand')).toEqual({
      name: 'My Brand',
      path: '/user/brand.otf',
      source: 'custom',
    })
    expect(resolveFontSelection(FONTS, '')).toBeNull()
    expect(resolveFontSelection(FONTS, 'Missing Font')).toBeNull()
  })
})
