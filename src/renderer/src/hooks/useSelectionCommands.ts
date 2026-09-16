/**
 * The state of the selection's commands: the inline Remove/Delete confirm and
 * the "Move to…" picker in the selection bar, and the selection's right-click
 * menu.
 *
 * The confirm, the picker and the menu belong to the selection they were
 * opened for (its `signature`): once the selection changes they read as
 * closed, so a confirm can never apply to items the question did not count,
 * and a menu that closed by unmounting never comes back at its old point.
 */

import { useCallback, useState } from 'react'
import type { MenuPoint } from '../components/library/PointMenu'
import type { BulkKind } from '../lib/libraryBulk'
import type { Selection } from '../lib/librarySelection'

export interface SelectionCommands {
  confirming: BulkKind | null
  moving: boolean
  /** Where the selection's menu is open; null when closed. */
  menuPoint: MenuPoint | null
  askConfirm: (kind: BulkKind) => void
  cancelConfirm: () => void
  toggleMove: () => void
  closeMove: () => void
  openMenu: (point: MenuPoint) => void
  closeMenu: () => void
}

/** The same keys in any order are the same selection. */
export function selectionSignature(selection: Selection): string {
  return [...selection.selected].sort().join('\n')
}

export function useSelectionCommands(signature: string): SelectionCommands {
  const [confirm, setConfirm] = useState<{ kind: BulkKind; signature: string } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ point: MenuPoint; signature: string } | null>(null)

  const askConfirm = useCallback(
    (kind: BulkKind) => {
      setMoving(null)
      setConfirm({ kind, signature })
    },
    [signature]
  )
  const toggleMove = useCallback(() => {
    setConfirm(null)
    setMoving((open) => (open === signature ? null : signature))
  }, [signature])
  const cancelConfirm = useCallback(() => setConfirm(null), [])
  const closeMove = useCallback(() => setMoving(null), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = useCallback((point: MenuPoint) => setMenu({ point, signature }), [signature])

  return {
    confirming: confirm !== null && confirm.signature === signature ? confirm.kind : null,
    moving: moving === signature,
    menuPoint: menu !== null && menu.signature === signature ? menu.point : null,
    askConfirm,
    cancelConfirm,
    toggleMove,
    closeMove,
    openMenu,
    closeMenu,
  }
}
