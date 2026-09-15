/**
 * The pure half of `useLibraryList`: how a burst of `library_changed` frames
 * becomes refetches. A 100-file import fires one frame per record as each
 * duration and poster lands; the list must refetch once per quiet window, not
 * 100 times — and must not starve while the pool is still busy. The hook itself
 * is not mounted (the vitest environment is plain node).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LIBRARY_REFETCH_MAX_WAIT_MS,
  LIBRARY_REFETCH_QUIET_MS,
  createQuietWindow,
} from './useLibraryList'

describe('createQuietWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('the constants are the ones the hook is tuned to', () => {
    expect(LIBRARY_REFETCH_QUIET_MS).toBe(400)
    expect(LIBRARY_REFETCH_MAX_WAIT_MS).toBeGreaterThan(LIBRARY_REFETCH_QUIET_MS)
  })

  test('one poke fires once, after the quiet window', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire)
    quiet.poke()
    vi.advanceTimersByTime(LIBRARY_REFETCH_QUIET_MS - 1)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(LIBRARY_REFETCH_MAX_WAIT_MS * 2)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  test('a synchronous burst of 100 frames fires once', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire)
    for (let i = 0; i < 100; i++) quiet.poke()
    vi.advanceTimersByTime(LIBRARY_REFETCH_MAX_WAIT_MS * 2)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  test('each poke inside the window pushes the refetch back', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire, 400, 10_000)
    quiet.poke()
    vi.advanceTimersByTime(300)
    quiet.poke()
    vi.advanceTimersByTime(300)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  test('a steady trickle still refetches at the max wait — cards fill in as the pool works', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire, 400, 2000)
    // 100 frames, 300 ms apart (a probe + one frame per record): 30 s of events.
    for (let i = 0; i < 100; i++) {
      quiet.poke()
      vi.advanceTimersByTime(300)
    }
    vi.advanceTimersByTime(400)
    // One per 2 s cap across 30 s, plus the trailing one — never one per frame.
    expect(fire.mock.calls.length).toBeGreaterThanOrEqual(15)
    expect(fire.mock.calls.length).toBeLessThanOrEqual(17)
  })

  test('a poke after a refetch starts a new window', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire)
    quiet.poke()
    vi.advanceTimersByTime(LIBRARY_REFETCH_QUIET_MS)
    quiet.poke()
    vi.advanceTimersByTime(LIBRARY_REFETCH_QUIET_MS)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  test('cancel drops a pending refetch (the screen went inactive)', () => {
    const fire = vi.fn()
    const quiet = createQuietWindow(fire)
    quiet.poke()
    quiet.cancel()
    vi.advanceTimersByTime(LIBRARY_REFETCH_MAX_WAIT_MS * 2)
    expect(fire).not.toHaveBeenCalled()
  })
})
