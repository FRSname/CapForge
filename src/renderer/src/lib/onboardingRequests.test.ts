/**
 * "Reopen the guide" from Settings → General, without threading a callback
 * through App.tsx. Same listener-set shape as `settingsNavigation.ts`.
 */

import { describe, expect, test, vi } from 'vitest'
import { onOnboardingRequested, requestOnboarding } from './onboardingRequests'

describe('onboardingRequests', () => {
  test('nobody listening reports false so the caller can say so', () => {
    expect(requestOnboarding('guide')).toBe(false)
  })

  test('a listener receives the kind until it unsubscribes', () => {
    const listener = vi.fn()
    const off = onOnboardingRequested(listener)

    expect(requestOnboarding('guide')).toBe(true)
    expect(listener).toHaveBeenCalledWith('guide')

    expect(requestOnboarding('whats-new')).toBe(true)
    expect(listener).toHaveBeenLastCalledWith('whats-new')

    off()
    expect(requestOnboarding('guide')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  test('every listener hears the request', () => {
    const one = vi.fn()
    const two = vi.fn()
    const offOne = onOnboardingRequested(one)
    const offTwo = onOnboardingRequested(two)

    requestOnboarding('whats-new')
    expect(one).toHaveBeenCalledWith('whats-new')
    expect(two).toHaveBeenCalledWith('whats-new')

    offOne()
    offTwo()
  })
})
