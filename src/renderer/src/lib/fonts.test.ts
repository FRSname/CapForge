import { describe, expect, test } from 'vitest'
import { mergeFontCatalogs } from './fonts'

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
