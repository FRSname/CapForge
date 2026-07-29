import { describe, expect, test } from 'vitest'
import { mergeFontCatalogs, sortFavoritesFirst, type FontInfo } from './fonts'

describe('mergeFontCatalogs', () => {
  test('merges and alphabetizes installed, bundled, and custom fonts', () => {
    const fonts = mergeFontCatalogs(
      ['Verdana', 'Arial'],
      [{ name: 'Caviar Dreams', path: '/bundle/caviar.ttf' }],
      [{ name: 'Brand Font', path: '/user/brand.otf' }]
    )

    expect(fonts.map((font) => `${font.name}:${font.source}`)).toEqual([
      'Arial:system',
      'Brand Font:custom',
      'Caviar Dreams:bundled',
      'Verdana:system',
    ])
  })

  test('prefers custom and bundled files over duplicate system family names', () => {
    const fonts = mergeFontCatalogs(
      ['Inter', 'Arial'],
      [{ name: 'Inter', path: '/bundle/inter.ttf' }],
      [{ name: 'ARIAL', path: '/user/arial.ttf' }]
    )

    expect(fonts).toEqual([
      { name: 'ARIAL', path: '/user/arial.ttf', source: 'custom' },
      { name: 'Inter', path: '/bundle/inter.ttf', source: 'bundled' },
    ])
  })

  test('ignores blank installed-family names', () => {
    expect(mergeFontCatalogs(['', '   '], [], [])).toEqual([])
  })
})

describe('sortFavoritesFirst', () => {
  const font = (name: string): FontInfo => ({ name, path: '', source: 'system' })
  const catalog = [font('Arial'), font('Inter'), font('Montserrat'), font('Verdana')]

  test('pins favorites to the top, preserving order within each bucket', () => {
    const result = sortFavoritesFirst(catalog, new Set(['Montserrat', 'Arial']))

    expect(result.map((f) => f.name)).toEqual(['Arial', 'Montserrat', 'Inter', 'Verdana'])
  })

  test('returns the list untouched when there are no favorites', () => {
    expect(sortFavoritesFirst(catalog, new Set())).toBe(catalog)
  })

  test('ignores favorites that are not installed — no phantom rows', () => {
    const result = sortFavoritesFirst(catalog, new Set(['Uninstalled Font']))

    expect(result).toBe(catalog)
    expect(result).toHaveLength(catalog.length)
  })

  test('matching is exact, not case- or substring-based', () => {
    const result = sortFavoritesFirst(catalog, new Set(['inter']))

    expect(result.map((f) => f.name)).toEqual(['Arial', 'Inter', 'Montserrat', 'Verdana'])
  })
})
