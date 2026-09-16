/**
 * The registry the tour drives the app through: Settings opens and closes over
 * the existing `settingsNavigation` seam, and the workspace toggle goes to the
 * one navigator App registers.
 *
 * A missing navigator is a warning, never a throw: a step that cannot run its
 * action should still show its card.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { onSettingsCategoryRequested, onSettingsCloseRequested } from './settingsNavigation'
import { registerTourNavigator, runTourAction } from './tourNavigation'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runTourAction', () => {
  test('open-settings asks Settings for the category', () => {
    const listener = vi.fn()
    const off = onSettingsCategoryRequested(listener)

    runTourAction({ kind: 'open-settings', category: 'transcription' })
    expect(listener).toHaveBeenCalledWith('transcription', {})

    off()
  })

  test('close-settings asks Settings to close', () => {
    const listener = vi.fn()
    const off = onSettingsCloseRequested(listener)

    runTourAction({ kind: 'close-settings' })
    expect(listener).toHaveBeenCalledTimes(1)

    off()
  })

  test('set-workspace reaches the registered navigator', () => {
    const setWorkspace = vi.fn()
    const off = registerTourNavigator({ setWorkspace })

    runTourAction({ kind: 'set-workspace', workspace: 'publish' })
    expect(setWorkspace).toHaveBeenCalledWith('publish')

    off()
  })

  test('registering again replaces the navigator', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = registerTourNavigator({ setWorkspace: first })
    const offSecond = registerTourNavigator({ setWorkspace: second })

    runTourAction({ kind: 'set-workspace', workspace: 'captions' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('captions')

    offFirst()
    runTourAction({ kind: 'set-workspace', workspace: 'publish' })
    expect(second).toHaveBeenCalledTimes(2)

    offSecond()
  })

  test('without a navigator it warns and carries on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => runTourAction({ kind: 'set-workspace', workspace: 'publish' })).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })

  test('with nothing listening in Settings it warns and carries on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => runTourAction({ kind: 'open-settings', category: 'claude' })).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
