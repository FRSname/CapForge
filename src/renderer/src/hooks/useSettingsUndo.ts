/**
 * Undo/redo stack for StudioSettings.
 *
 * Uses refs to avoid re-renders on every push. Snapshots are debounced by
 * 500ms so slider drags don't flood the stack — only the final resting value
 * is recorded. The push/pop/cap-at-50/debounce mechanics live in the pure
 * lib/undoStack module (unit-tested there); this hook only owns the
 * React-specific wiring (refs, setSettings).
 */

import { useCallback, useRef } from 'react'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { createDebouncedUndoPusher, popSnapshot, pushSnapshot } from '../lib/undoStack'
import type { DebouncedUndoPusher } from '../lib/undoStack'

function snap(s: StudioSettings): StudioSettings {
  return JSON.parse(JSON.stringify(s))
}

export function useSettingsUndo(
  settings: StudioSettings,
  setSettings: (s: StudioSettings) => void
) {
  const undoStack = useRef<StudioSettings[]>([])
  const redoStack = useRef<StudioSettings[]>([])

  // Created lazily on first use (inside an event-handler callback, never
  // during render) so the commit closure over the stack refs above is only
  // built once per hook instance without tripping the "ref access during
  // render" lint rule.
  const pusherRef = useRef<DebouncedUndoPusher<StudioSettings> | null>(null)
  const getPusher = useCallback((): DebouncedUndoPusher<StudioSettings> => {
    if (pusherRef.current === null) {
      pusherRef.current = createDebouncedUndoPusher<StudioSettings>((snapshot) => {
        undoStack.current = pushSnapshot(undoStack.current, snapshot)
        redoStack.current = []
      })
    }
    return pusherRef.current
  }, [])

  /** Push current settings onto the undo stack (debounced). */
  const push = useCallback(
    (current: StudioSettings) => {
      getPusher().push(snap(current))
    },
    [getPusher]
  )

  const undo = useCallback(() => {
    // Flush any pending debounced push first.
    pusherRef.current?.flush()

    if (undoStack.current.length === 0) return
    redoStack.current = pushSnapshot(redoStack.current, snap(settings))
    const { stack, popped } = popSnapshot(undoStack.current)
    undoStack.current = stack
    if (popped) setSettings(popped)
  }, [settings, setSettings])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current = pushSnapshot(undoStack.current, snap(settings))
    const { stack, popped } = popSnapshot(redoStack.current)
    redoStack.current = stack
    if (popped) setSettings(popped)
  }, [settings, setSettings])

  return { push, undo, redo }
}
