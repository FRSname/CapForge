import { useCallback, useRef, useState } from 'react'
import type { Segment } from '../types/app'
import { popSnapshot, pushSnapshot } from '../lib/undoStack'

type EditorState = {
  segments: Segment[]
  groups: Segment[]
  groupsEdited: boolean
}

function snapshot(state: EditorState): EditorState {
  return JSON.parse(JSON.stringify(state))
}

export function useUndoRedo(
  segments: Segment[],
  setSegments: (s: Segment[]) => void,
  groups: Segment[],
  setGroups: (g: Segment[]) => void,
  groupsEdited: boolean,
  setGroupsEdited: (v: boolean) => void
) {
  const undoStack = useRef<EditorState[]>([])
  const redoStack = useRef<EditorState[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Set to true immediately before restoring state so the caller's group-sync
  // useEffect can detect a restore and skip overwriting the snapshot.
  const isRestoringRef = useRef(false)

  const updateFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  /** Push the current editor state onto the undo stack (call before an edit). */
  const pushUndo = useCallback(() => {
    undoStack.current = pushSnapshot(
      undoStack.current,
      snapshot({ segments, groups, groupsEdited })
    )
    redoStack.current = []
    updateFlags()
  }, [segments, groups, groupsEdited, updateFlags])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    redoStack.current = pushSnapshot(
      redoStack.current,
      snapshot({ segments, groups, groupsEdited })
    )
    const { stack, popped } = popSnapshot(undoStack.current)
    undoStack.current = stack
    if (!popped) return
    isRestoringRef.current = true
    setSegments(popped.segments)
    setGroups(popped.groups)
    setGroupsEdited(popped.groupsEdited)
    updateFlags()
  }, [segments, groups, groupsEdited, setSegments, setGroups, setGroupsEdited, updateFlags])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current = pushSnapshot(
      undoStack.current,
      snapshot({ segments, groups, groupsEdited })
    )
    const { stack, popped } = popSnapshot(redoStack.current)
    redoStack.current = stack
    if (!popped) return
    isRestoringRef.current = true
    setSegments(popped.segments)
    setGroups(popped.groups)
    setGroupsEdited(popped.groupsEdited)
    updateFlags()
  }, [segments, groups, groupsEdited, setSegments, setGroups, setGroupsEdited, updateFlags])

  /** Clear both stacks (e.g. when segments are replaced wholesale). */
  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    updateFlags()
  }, [updateFlags])

  return { pushUndo, undo, redo, clear, canUndo, canRedo, isRestoringRef }
}
