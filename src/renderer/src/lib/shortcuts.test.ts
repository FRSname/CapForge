/**
 * Shape sanity for the shared shortcut inventory — both Settings → Shortcuts
 * and the `?` ShortcutOverlay render from this constant.
 */

import { describe, expect, test } from 'vitest'
import { SHORTCUT_SECTIONS } from './shortcuts'

describe('SHORTCUT_SECTIONS', () => {
  test('has at least the five known sections with unique titles', () => {
    // Arrange / Act
    const titles = SHORTCUT_SECTIONS.map((s) => s.title)

    // Assert
    expect(titles).toEqual(
      expect.arrayContaining(['Global', 'Playback', 'Editor', 'Groups', 'Timeline'])
    )
    expect(new Set(titles).size).toBe(titles.length)
  })

  test('every item has at least one key and a non-empty description', () => {
    for (const section of SHORTCUT_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0)
      for (const item of section.items) {
        expect(item.keys.length).toBeGreaterThan(0)
        expect(item.keys.every((k) => k.length > 0)).toBe(true)
        expect(item.description.trim().length).toBeGreaterThan(0)
      }
    }
  })

  test('registers the ? overlay toggle and the ⌘1/⌘2 tab shortcuts', () => {
    // Arrange
    const allKeys = SHORTCUT_SECTIONS.flatMap((s) => s.items.flatMap((i) => i.keys))

    // Assert
    expect(allKeys).toContain('?')
    expect(allKeys).toContain('⌘1')
    expect(allKeys).toContain('⌘2')
  })

  test('the Global section documents ⌘, as the Settings dialog opener', () => {
    // Arrange
    const global = SHORTCUT_SECTIONS.find((s) => s.title === 'Global')

    // Assert
    expect(global?.items).toContainEqual({ keys: ['⌘,'], description: 'Open settings' })
  })

  test('documents the mouse gestures the on-canvas hints no longer state', () => {
    // The player's wheel hints are transient now (hooks/useTransientHint.ts):
    // shown once per session and then gone, so this inventory is the only
    // lasting place a user can look them up.
    const timeline = SHORTCUT_SECTIONS.find((s) => s.title === 'Timeline')
    const playback = SHORTCUT_SECTIONS.find((s) => s.title === 'Playback')

    expect(timeline?.items).toContainEqual({
      keys: ['Ctrl+Wheel'],
      description: 'Zoom timeline · video',
    })
    expect(timeline?.items).toContainEqual({ keys: ['Wheel'], description: 'Pan timeline' })
    expect(playback?.items).toContainEqual({
      keys: ['Dbl-click'],
      description: 'Toggle video zoom',
    })
  })

  test('descriptions are unique within each section (used as React keys)', () => {
    for (const section of SHORTCUT_SECTIONS) {
      const descriptions = section.items.map((i) => i.description)
      expect(new Set(descriptions).size).toBe(descriptions.length)
    }
  })
})
