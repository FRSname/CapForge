/**
 * Undo/redo stack for StudioSettings.
 *
 * Uses refs to avoid re-renders on every push. Snapshots are debounced by
 * 500ms so slider drags don't flood the stack — only the final resting value
 * is recorded.
 */

import { useCallback, useRef } from 'react'
import type { StudioSettings } from '../components/studio/StudioPanel'

const MAX_HISTORY = 50

function snap(s: StudioSettings): StudioSettings {
  return JSON.parse(JSON.stringify(s))
}

export function useSettingsUndo(
  settings: StudioSettings,
  setSettings: (s: StudioSettings) => void,
) {
  const undoStack = useRef<StudioSettings[]>([])
  const redoStack = useRef<StudioSettings[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the last pushed snapshot so debounced pushes capture the state
  // at the moment push() was first called (before the slider moved further).
  const pendingRef = useRef<StudioSettings | null>(null)

  /** Push current settings onto the undo stack (debounced). */
  const push = useCallback((current: StudioSettings) => {
    if (!pendingRef.current) {
      pendingRef.current = snap(current)
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (pendingRef.current) {
        undoStack.current.push(pendingRef.current)
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
        redoStack.current.length = 0
        pendingRef.current = null
      }
    }, 500)
  }, [])

  const undo = useCallback(() => {
    // Flush any pending debounced push first
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      if (pendingRef.current) {
        undoStack.current.push(pendingRef.current)
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
        redoStack.current.length = 0
        pendingRef.current = null
      }
    }
    if (undoStack.current.length === 0) return
    redoStack.current.push(snap(settings))
    const prev = undoStack.current.pop()!
    setSettings(prev)
  }, [settings, setSettings])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push(snap(settings))
    const next = redoStack.current.pop()!
    setSettings(next)
  }, [settings, setSettings])

  return { push, undo, redo }
}
