/**
 * Per-key undo histories — the primitive behind per-track settings undo.
 *
 * `useSettingsUndo` is a thin wrapper over this (refs + setSettings), and the
 * vitest node environment cannot exercise a hook whose state must survive
 * across renders, so the keying contract is pinned here where it is plain data.
 */

import { describe, expect, test, vi } from 'vitest'
import { createKeyedUndoStacks, MAX_HISTORY } from './undoStack'

/** No debounce, so a push is committed the moment it is made. */
const stacks = () => createKeyedUndoStacks<string>(0)

describe('createKeyedUndoStacks', () => {
  test('a push on one key is invisible to another', () => {
    const s = stacks()
    s.push('a', 'A1')
    s.flush('a')

    expect(s.depth('a')).toEqual({ undo: 1, redo: 0 })
    expect(s.depth('b')).toEqual({ undo: 0, redo: 0 })
    // The whole point: Cmd+Z on the other tab must do nothing at all.
    expect(s.undo('b', 'B-current')).toBeUndefined()
    expect(s.depth('b')).toEqual({ undo: 0, redo: 0 })
    // …and must not have consumed A's history either.
    expect(s.undo('a', 'A2')).toBe('A1')
  })

  test('undo/redo round-trips within one key', () => {
    const s = stacks()
    s.push('a', 'A1')
    s.flush('a')

    expect(s.undo('a', 'A2')).toBe('A1')
    expect(s.depth('a')).toEqual({ undo: 0, redo: 1 })
    expect(s.redo('a', 'A1')).toBe('A2')
    expect(s.depth('a')).toEqual({ undo: 1, redo: 0 })
  })

  test('a fresh push clears only that key’s redo stack', () => {
    const s = stacks()
    s.push('a', 'A1')
    s.push('b', 'B1')
    s.flush('a')
    s.flush('b')
    s.undo('a', 'A2')
    s.undo('b', 'B2')
    expect(s.depth('a').redo).toBe(1)
    expect(s.depth('b').redo).toBe(1)

    s.push('a', 'A3')
    s.flush('a')
    expect(s.depth('a').redo).toBe(0)
    expect(s.depth('b').redo).toBe(1)
  })

  test('history caps per key, not across keys', () => {
    const s = stacks()
    for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
      s.push('a', `A${i}`)
      s.flush('a')
      s.push('b', `B${i}`)
      s.flush('b')
    }
    expect(s.depth('a').undo).toBe(MAX_HISTORY)
    expect(s.depth('b').undo).toBe(MAX_HISTORY)
    // The oldest entry was dropped, the newest survived.
    expect(s.undo('a', 'now')).toBe(`A${MAX_HISTORY + 9}`)
  })

  test('a burst on one key coalesces without touching the other', () => {
    vi.useFakeTimers()
    try {
      const s = createKeyedUndoStacks<string>(500)
      s.push('a', 'A-before-drag')
      s.push('a', 'A-mid-drag')
      s.push('b', 'B-before-drag')
      vi.advanceTimersByTime(500)

      // Only the FIRST snapshot of each burst is committed (drag semantics).
      expect(s.depth('a')).toEqual({ undo: 1, redo: 0 })
      expect(s.undo('a', 'A-after')).toBe('A-before-drag')
      expect(s.undo('b', 'B-after')).toBe('B-before-drag')
    } finally {
      vi.useRealTimers()
    }
  })

  test('undo flushes only the pending push of its own key', () => {
    vi.useFakeTimers()
    try {
      const s = createKeyedUndoStacks<string>(500)
      s.push('a', 'A1')
      s.push('b', 'B1')
      // No timer has fired: both are still pending.
      expect(s.undo('a', 'A2')).toBe('A1')
      expect(s.depth('b')).toEqual({ undo: 0, redo: 0 })
    } finally {
      vi.useRealTimers()
    }
  })
})
