/**
 * The library's selection as React state, over the pure reducer
 * (`lib/librarySelection.ts`).
 *
 * The selection belongs to one location: a different `scopeKey` reads as
 * empty, so navigating resets it without an effect. What is no longer visible
 * (a refresh after Remove, a narrower search) is pruned at read time, and
 * every update starts from that pruned value, so a key that left the view
 * never comes back selected once the user has acted.
 */

import { useCallback, useState } from 'react'
import type { ItemKey, Selection } from '../lib/librarySelection'
import { EMPTY_SELECTION, pruneSelection } from '../lib/librarySelection'

interface Stored {
  scopeKey: string
  selection: Selection
}

export interface LibrarySelectionState {
  /** Pruned to what is visible. */
  selection: Selection
  /** Apply a reducer step; it receives the pruned selection. */
  update: (change: (current: Selection) => Selection) => void
}

export function useLibrarySelection(
  scopeKey: string,
  visible: readonly ItemKey[]
): LibrarySelectionState {
  const [stored, setStored] = useState<Stored>({ scopeKey, selection: EMPTY_SELECTION })
  const current = stored.scopeKey === scopeKey ? stored.selection : EMPTY_SELECTION
  const selection = pruneSelection(current, visible)

  const update = useCallback(
    (change: (current: Selection) => Selection) =>
      setStored((prev) => {
        const base = prev.scopeKey === scopeKey ? prev.selection : EMPTY_SELECTION
        return { scopeKey, selection: change(pruneSelection(base, visible)) }
      }),
    [scopeKey, visible]
  )

  return { selection, update }
}
