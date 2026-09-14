/**
 * Unit tests for the app Settings search index — the pure half of the Settings
 * dialog (rail order, and which categories a query keeps visible).
 */

import { describe, expect, test } from 'vitest'
import {
  APP_SETTINGS_CATEGORIES,
  APP_SETTINGS_ENTRIES,
  filterAppSettings,
} from './appSettingsIndex'

describe('APP_SETTINGS_CATEGORIES', () => {
  test('is the six panes in rail order', () => {
    expect(APP_SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      'general',
      'channel',
      'collections',
      'transcription',
      'claude',
      'shortcuts',
    ])
  })

  test('every entry files under a known category', () => {
    const ids = new Set(APP_SETTINGS_CATEGORIES.map((c) => c.id))
    for (const entry of APP_SETTINGS_ENTRIES) {
      expect(ids.has(entry.category)).toBe(true)
    }
  })
})

describe('filterAppSettings', () => {
  test('an empty query lists every category in rail order and no entries', () => {
    // Act
    const res = filterAppSettings('')

    // Assert
    expect(res.categories).toEqual([
      'general',
      'channel',
      'collections',
      'transcription',
      'claude',
      'shortcuts',
    ])
    expect(res.entries).toEqual([])
  })

  test('"collection" and "event" lead to Collections', () => {
    expect(filterAppSettings('collection').categories).toContain('collections')
    expect(filterAppSettings('event').categories).toContain('collections')
  })

  test('"template" finds the template in both places it lives', () => {
    const { categories } = filterAppSettings('template')
    expect(categories).toContain('channel')
    expect(categories).toContain('collections')
  })

  test('a whitespace-only query is treated as empty', () => {
    expect(filterAppSettings('   ')).toEqual(filterAppSettings(''))
  })

  test('"token" matches transcription only', () => {
    // Act
    const res = filterAppSettings('token')

    // Assert
    expect(res.categories).toEqual(['transcription'])
    expect(res.entries.map((e) => e.label)).toContain('HuggingFace Token')
  })

  test('"skill" matches claude only', () => {
    expect(filterAppSettings('skill').categories).toEqual(['claude'])
  })

  test('"dark" matches general only', () => {
    // Act
    const res = filterAppSettings('dark')

    // Assert
    expect(res.categories).toEqual(['general'])
    expect(res.entries.map((e) => e.label)).toEqual(['Appearance'])
  })

  test('matching is case-insensitive and trims the query', () => {
    expect(filterAppSettings('  SKILL  ').categories).toEqual(['claude'])
  })

  test('a nonsense query matches nothing', () => {
    // Act
    const res = filterAppSettings('zzzqqq')

    // Assert
    expect(res.categories).toEqual([])
    expect(res.entries).toEqual([])
  })
})
