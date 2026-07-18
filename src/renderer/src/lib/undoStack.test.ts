import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDebouncedUndoPusher, MAX_HISTORY, popSnapshot, pushSnapshot } from './undoStack'

describe('pushSnapshot', () => {
  test('appends a snapshot to an empty stack', () => {
    const stack = pushSnapshot([], 'a')
    expect(stack).toEqual(['a'])
  })

  test('appends to the end of an existing stack', () => {
    const stack = pushSnapshot(['a', 'b'], 'c')
    expect(stack).toEqual(['a', 'b', 'c'])
  })

  test('does not mutate the input stack', () => {
    const input = ['a', 'b']
    const stack = pushSnapshot(input, 'c')
    expect(input).toEqual(['a', 'b'])
    expect(stack).not.toBe(input)
  })

  test('drops the oldest entry once the stack exceeds maxHistory', () => {
    const full = Array.from({ length: 5 }, (_, i) => i)
    const stack = pushSnapshot(full, 5, 5)
    expect(stack).toEqual([1, 2, 3, 4, 5])
    expect(stack.length).toBe(5)
  })

  test('defaults to capping at MAX_HISTORY (50) when no cap is given', () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => i)
    const stack = pushSnapshot(full, 999)
    expect(stack.length).toBe(MAX_HISTORY)
    expect(stack[0]).toBe(1) // oldest (0) dropped
    expect(stack[stack.length - 1]).toBe(999)
  })
})

describe('popSnapshot', () => {
  test('pops the most recently pushed (last) snapshot', () => {
    const { stack, popped } = popSnapshot(['a', 'b', 'c'])
    expect(popped).toBe('c')
    expect(stack).toEqual(['a', 'b'])
  })

  test('returns an empty new stack and undefined popped for an empty stack', () => {
    const input: string[] = []
    const { stack, popped } = popSnapshot(input)
    expect(popped).toBeUndefined()
    expect(stack).toEqual([])
    expect(stack).not.toBe(input)
  })

  test('does not mutate the input stack', () => {
    const input = ['a', 'b']
    popSnapshot(input)
    expect(input).toEqual(['a', 'b'])
  })
})

describe('createDebouncedUndoPusher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('does not commit before the delay elapses', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    vi.advanceTimersByTime(499)

    expect(commit).not.toHaveBeenCalled()
  })

  test('commits the pushed snapshot once the delay elapses', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    vi.advanceTimersByTime(500)

    expect(commit).toHaveBeenCalledExactlyOnceWith('a')
  })

  test('coalesces a burst of pushes into a single commit of the FIRST value', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('first')
    vi.advanceTimersByTime(200)
    pusher.push('second')
    vi.advanceTimersByTime(200)
    pusher.push('third')
    vi.advanceTimersByTime(500)

    expect(commit).toHaveBeenCalledExactlyOnceWith('first')
  })

  test('each push resets the debounce timer', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    vi.advanceTimersByTime(400)
    expect(commit).not.toHaveBeenCalled()

    pusher.push('b') // resets the 500ms window
    vi.advanceTimersByTime(400)
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(commit).toHaveBeenCalledExactlyOnceWith('a')
  })

  test('a new burst after a commit starts a fresh coalescing window', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    vi.advanceTimersByTime(500)
    expect(commit).toHaveBeenCalledExactlyOnceWith('a')

    pusher.push('b')
    vi.advanceTimersByTime(500)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenLastCalledWith('b')
  })

  test('flush() commits a pending snapshot immediately without waiting for the timer', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    pusher.flush()

    expect(commit).toHaveBeenCalledExactlyOnceWith('a')

    // The now-cancelled timer must not fire a second commit.
    vi.advanceTimersByTime(500)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  test('flush() is a no-op when nothing is pending', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.flush()

    expect(commit).not.toHaveBeenCalled()
  })

  test('cancel() discards a pending snapshot without committing', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit, 500)

    pusher.push('a')
    pusher.cancel()
    vi.advanceTimersByTime(1000)

    expect(commit).not.toHaveBeenCalled()
  })

  test('uses a 500ms default delay when none is passed', () => {
    const commit = vi.fn()
    const pusher = createDebouncedUndoPusher(commit)

    pusher.push('a')
    vi.advanceTimersByTime(499)
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledExactlyOnceWith('a')
  })
})
