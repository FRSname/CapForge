import { describe, expect, test } from 'vitest'
import {
  CARD_SETTINGS,
  SETTINGS_REGISTRY,
  countCardDirty,
  filterSettings,
} from './settingsSearch'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'

describe('filterSettings', () => {
  test('returns null for an empty query', () => {
    // Arrange / Act / Assert
    expect(filterSettings('')).toBeNull()
  })

  test('returns null for a whitespace-only query', () => {
    expect(filterSettings('   ')).toBeNull()
  })

  test('matches a row by label', () => {
    // Act
    const result = filterSettings('Tracking')

    // Assert
    expect(result).not.toBeNull()
    expect(result!.matchedCards.has('typography')).toBe(true)
    expect(result!.matchedLabels.has('Tracking')).toBe(true)
  })

  test('matches a row by keyword — "shadow" hits the Colors card', () => {
    const result = filterSettings('shadow')

    expect(result).not.toBeNull()
    expect(result!.matchedCards.has('colors')).toBe(true)
    expect(result!.matchedLabels.has('Shadow')).toBe(true)
    expect(result!.matchedLabels.has('Blur')).toBe(true)
  })

  test('is case-insensitive', () => {
    const lower = filterSettings('shadow')
    const upper = filterSettings('SHADOW')

    expect(upper).not.toBeNull()
    expect([...upper!.matchedCards].sort()).toEqual([...lower!.matchedCards].sort())
    expect([...upper!.matchedLabels].sort()).toEqual([...lower!.matchedLabels].sort())
  })

  test('returns empty sets when nothing matches', () => {
    const result = filterSettings('zzzznotasetting')

    expect(result).not.toBeNull()
    expect(result!.matchedCards.size).toBe(0)
    expect(result!.matchedLabels.size).toBe(0)
  })

  test('"color" matches the Colors card by title and includes all its rows', () => {
    const result = filterSettings('color')

    expect(result).not.toBeNull()
    expect(result!.matchedCards.has('colors')).toBe(true)
    // Title match pulls in every Colors row, even ones without "color" in label/keywords.
    expect(result!.matchedLabels.has('Outline W')).toBe(true)
  })

  test('keyword "tiktok" surfaces the Safe zones row in Layout', () => {
    const result = filterSettings('tiktok')

    expect(result).not.toBeNull()
    expect(result!.matchedCards.has('layout')).toBe(true)
    expect(result!.matchedLabels.has('Safe zones')).toBe(true)
  })
})

describe('registry / card-keys consistency', () => {
  test('every registry entry points at a known card', () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(CARD_SETTINGS[entry.cardId]).toBeDefined()
    }
  })

  test('CARD_SETTINGS keys all exist on STUDIO_DEFAULTS', () => {
    for (const keys of Object.values(CARD_SETTINGS)) {
      for (const key of keys) {
        expect(key in STUDIO_DEFAULTS).toBe(true)
      }
    }
  })
})

describe('countCardDirty', () => {
  test('returns 0 when settings equal defaults', () => {
    expect(countCardDirty({ ...STUDIO_DEFAULTS }, STUDIO_DEFAULTS, 'typography')).toBe(0)
  })

  test('counts a changed number setting in its card only', () => {
    // Arrange
    const settings = { ...STUDIO_DEFAULTS, fontSize: STUDIO_DEFAULTS.fontSize + 10 }

    // Act / Assert
    expect(countCardDirty(settings, STUDIO_DEFAULTS, 'typography')).toBe(1)
    expect(countCardDirty(settings, STUDIO_DEFAULTS, 'colors')).toBe(0)
  })

  test('ignores sub-tolerance float drift', () => {
    const settings = { ...STUDIO_DEFAULTS, scaleFactor: STUDIO_DEFAULTS.scaleFactor + 0.0001 }

    expect(countCardDirty(settings, STUDIO_DEFAULTS, 'animation')).toBe(0)
  })

  test('counts fontName + fontPath change as one change (fontPath uncounted)', () => {
    const settings = { ...STUDIO_DEFAULTS, fontName: 'Inter-Bold', fontPath: '/x/Inter-Bold.ttf' }

    expect(countCardDirty(settings, STUDIO_DEFAULTS, 'typography')).toBe(1)
  })

  test('counts boolean and string changes', () => {
    const settings = { ...STUDIO_DEFAULTS, shadowEnabled: true, textColor: '#FF0000' }

    expect(countCardDirty(settings, STUDIO_DEFAULTS, 'colors')).toBe(2)
  })
})
