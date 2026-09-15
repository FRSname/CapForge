/**
 * "Open Settings on this category" from anywhere in the renderer, without
 * threading a callback through App.tsx: the always-mounted SettingsDialog
 * listens, a card asks.
 */

import { describe, expect, test, vi } from 'vitest'
import { onSettingsCategoryRequested, requestSettingsCategory } from './settingsNavigation'

describe('settingsNavigation', () => {
  test('nobody listening reports false so the caller can fall back', () => {
    expect(requestSettingsCategory('collections')).toBe(false)
  })

  test('a listener receives the category until it unsubscribes', () => {
    const listener = vi.fn()
    const off = onSettingsCategoryRequested(listener)

    expect(requestSettingsCategory('collections')).toBe(true)
    expect(listener).toHaveBeenCalledWith('collections')

    off()
    expect(requestSettingsCategory('channel')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
