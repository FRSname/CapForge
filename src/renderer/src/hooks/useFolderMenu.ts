/**
 * Which folder's context menu is open and which folder name is being edited
 * in place — screen-wide state, because the same folder can show in the
 * sidebar and in the main area at once and only the one the user acted on
 * should change.
 *
 * The menu opens at a point in the window (the right-click, or under the `…`
 * button) and is drawn `position: fixed`, so the sidebar's scroll box never
 * clips it.
 */

import { useCallback, useState } from 'react'
import type { FolderEntry } from '../lib/libraryLocation'

/** Where a folder is shown: the sidebar tree, or a tile / list row in the main area. */
export type FolderSurface = 'sidebar' | 'main'

export interface FolderMenuPoint {
  x: number
  y: number
}

export interface FolderMenuAnchor extends FolderMenuPoint {
  folder: FolderEntry
  surface: FolderSurface
}

export interface FolderRenaming {
  id: string
  surface: FolderSurface
}

export interface FolderMenuState {
  menu: FolderMenuAnchor | null
  renaming: FolderRenaming | null
  openMenu: (folder: FolderEntry, surface: FolderSurface, point: FolderMenuPoint) => void
  closeMenu: () => void
  startRename: (id: string, surface: FolderSurface) => void
  stopRename: () => void
}

export function useFolderMenu(): FolderMenuState {
  const [menu, setMenu] = useState<FolderMenuAnchor | null>(null)
  const [renaming, setRenaming] = useState<FolderRenaming | null>(null)

  const openMenu = useCallback(
    (folder: FolderEntry, surface: FolderSurface, point: FolderMenuPoint) => {
      setRenaming(null)
      setMenu({ folder, surface, x: point.x, y: point.y })
    },
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])
  const startRename = useCallback((id: string, surface: FolderSurface) => {
    setMenu(null)
    setRenaming({ id, surface })
  }, [])
  const stopRename = useCallback(() => setRenaming(null), [])

  return { menu, renaming, openMenu, closeMenu, startRename, stopRename }
}
