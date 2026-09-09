/**
 * Undo/redo stack for StudioSettings.
 *
 * Uses refs to avoid re-renders on every push. Snapshots are debounced by
 * 500ms so slider drags don't flood the stack — only the final resting value
 * is recorded. The push/pop/cap-at-50/debounce mechanics live in the pure
 * lib/undoStack module (unit-tested there); this hook only owns the
 * React-specific wiring (refs, setSettings).
 *
 * Histories are **per caption track**: `key` selects which one push/undo/redo
 * address, so Cmd+Z on the Polish tab can never restore a value the user set on
 * the English one (D5). A caller that passes no key gets one history, which is
 * exactly the previous behaviour.
 */

import { useCallback, useRef } from 'react'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { createKeyedUndoStacks } from '../lib/undoStack'
import type { KeyedUndoStacks } from '../lib/undoStack'

/** History key used when the caller tracks no key of its own. */
export const DEFAULT_UNDO_KEY = 'default'

function snap(s: StudioSettings): StudioSettings {
  return JSON.parse(JSON.stringify(s))
}

export interface SettingsUndo {
  push: (current: StudioSettings) => void
  undo: () => void
  redo: () => void
}

export function useSettingsUndo(
  settings: StudioSettings,
  setSettings: (s: StudioSettings) => void,
  key: string = DEFAULT_UNDO_KEY
): SettingsUndo {
  // Created lazily on first use (inside an event-handler callback, never
  // during render) so the per-key stacks are only built once per hook instance
  // without tripping the "ref access during render" lint rule.
  const stacksRef = useRef<KeyedUndoStacks<StudioSettings> | null>(null)
  const getStacks = useCallback((): KeyedUndoStacks<StudioSettings> => {
    if (stacksRef.current === null) {
      stacksRef.current = createKeyedUndoStacks<StudioSettings>()
    }
    return stacksRef.current
  }, [])

  /** Push current settings onto the active key's undo stack (debounced). */
  const push = useCallback(
    (current: StudioSettings) => {
      getStacks().push(key, snap(current))
    },
    [getStacks, key]
  )

  const undo = useCallback(() => {
    const popped = getStacks().undo(key, snap(settings))
    if (popped) setSettings(popped)
  }, [getStacks, key, settings, setSettings])

  const redo = useCallback(() => {
    const popped = getStacks().redo(key, snap(settings))
    if (popped) setSettings(popped)
  }, [getStacks, key, settings, setSettings])

  return { push, undo, redo }
}
