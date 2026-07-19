import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { FontInfo } from '../../lib/fonts'
import { filterFonts, FontCombobox, resolveFontSelection } from './FontCombobox'

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
