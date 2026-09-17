/**
 * The theme mode's pure part: what a stored value means, and which of the two
 * palettes a mode resolves to. Every branch is covered here so `useTheme` has
 * no logic left to test in an environment that runs no effects.
 */

import { describe, expect, test } from 'vitest'
import { parseThemeMode, resolveLightMode, THEME_MODES } from './themeMode'

describe('THEME_MODES', () => {
  test('is exactly the three choices the Appearance control offers', () => {
    expect([...THEME_MODES]).toEqual(['light', 'dark', 'system'])
  })
})

describe('parseThemeMode', () => {
  test('passes the three known values through', () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
    expect(parseThemeMode('system')).toBe('system')
  })

  test('nothing stored means System — what a fresh install gets', () => {
    expect(parseThemeMode(null)).toBe('system')
    expect(parseThemeMode(undefined)).toBe('system')
    expect(parseThemeMode('')).toBe('system')
  })

  test('an unreadable value falls back to System rather than throwing', () => {
    expect(parseThemeMode('Light')).toBe('system')
    expect(parseThemeMode('auto')).toBe('system')
    expect(parseThemeMode('{"mode":"light"}')).toBe('system')
  })
})

describe('resolveLightMode', () => {
  test('an explicit mode ignores the OS preference', () => {
    expect(resolveLightMode('light', false)).toBe(true)
    expect(resolveLightMode('light', true)).toBe(true)
    expect(resolveLightMode('dark', true)).toBe(false)
    expect(resolveLightMode('dark', false)).toBe(false)
  })

  test('System follows the OS preference', () => {
    expect(resolveLightMode('system', true)).toBe(true)
    expect(resolveLightMode('system', false)).toBe(false)
  })
})
