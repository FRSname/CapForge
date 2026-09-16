/**
 * "Open Settings on this category" from anywhere in the renderer, without
 * threading a callback through App.tsx: the always-mounted SettingsDialog
 * listens, a card asks.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  onSettingsCategoryRequested,
  onSettingsCloseRequested,
  requestSettingsCategory,
  requestSettingsClose,
} from './settingsNavigation'

describe('settingsNavigation', () => {
  test('nobody listening reports false so the caller can fall back', () => {
    expect(requestSettingsCategory('collections')).toBe(false)
  })

  test('a listener receives the category until it unsubscribes', () => {
    const listener = vi.fn()
    const off = onSettingsCategoryRequested(listener)

    expect(requestSettingsCategory('collections')).toBe(true)
    expect(listener).toHaveBeenCalledWith('collections', {})

    off()
    expect(requestSettingsCategory('channels')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('a focus rides along: the folder to select in Settings → Folders', () => {
    const listener = vi.fn()
    const off = onSettingsCategoryRequested(listener)

    expect(requestSettingsCategory('collections', { collectionId: 'uck26' })).toBe(true)
    expect(listener).toHaveBeenCalledWith('collections', { collectionId: 'uck26' })

    off()
  })
})

describe('settings close requests', () => {
  test('nobody listening reports false, so the tour can warn instead', () => {
    expect(requestSettingsClose()).toBe(false)
  })

  test('a listener is called until it unsubscribes', () => {
    const listener = vi.fn()
    const off = onSettingsCloseRequested(listener)

    expect(requestSettingsClose()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    off()
    expect(requestSettingsClose()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('closing and opening are separate channels', () => {
    const openListener = vi.fn()
    const closeListener = vi.fn()
    const offOpen = onSettingsCategoryRequested(openListener)
    const offClose = onSettingsCloseRequested(closeListener)

    requestSettingsClose()
    expect(openListener).not.toHaveBeenCalled()

    requestSettingsCategory('general')
    expect(closeListener).toHaveBeenCalledTimes(1)

    offOpen()
    offClose()
  })
})
