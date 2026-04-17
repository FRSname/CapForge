/**
 * Undo/redo stack for segments — ports _pushUndo/performUndo/performRedo from app.js.
 *
 * Each entry is a deep-cloned snapshot of the segments array. The stack is
 * capped at 50 entries. Any new edit clears the redo stack.
 */

import { useCallback, useRef, useState } from 'react'
import type { Segment } from '../types/app'

const MAX_HISTORY = 50

function snapshot(segments: Segment[]): Segment[] {
  return JSON.parse(JSON.stringify(segments))
}

export function useUndoRedo(segments: Segment[], setSegments: (s: Segment[]) => void) {
  const undoStack = useRef<Segment[][]>([])
  const redoStack = useRef<Segment[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  /** Push the current segments onto the undo stack (call before an edit). */
  const pushUndo = useCallback(() => {
    undoStack.current.push(snapshot(segments))
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current.length = 0
    updateFlags()
  }, [segments, updateFlags])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    redoStack.current.push(snapshot(segments))
    const prev = undoStack.current.pop()!
    setSegments(prev)
    updateFlags()
  }, [segments, setSegments, updateFlags])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push(snapshot(segments))
    const next = redoStack.current.pop()!
    setSegments(next)
    updateFlags()
  }, [segments, setSegments, updateFlags])

  /** Clear both stacks (e.g. when segments are replaced wholesale). */
  const clear = useCallback(() => {
    undoStack.current.length = 0
    redoStack.current.length = 0
    updateFlags()
  }, [updateFlags])

  return { pushUndo, undo, redo, clear, canUndo, canRedo }
}
