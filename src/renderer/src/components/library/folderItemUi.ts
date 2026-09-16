/**
 * What a folder tile, list row or sidebar entry needs from the screen: how to
 * open the folder, its menu and its inline rename, and the drag bindings.
 * Built once per surface by `LibraryScreen`, so the sidebar and the main area
 * each rename only their own copy of a folder.
 */

import type { MouseEvent } from 'react'
import type { FolderMenuPoint } from '../../hooks/useFolderMenu'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import { INERT_LIBRARY_DRAG } from '../../hooks/useLibraryDrag'
import type { RenameFolderResult } from '../../lib/folderActions'
import type { FolderEntry } from '../../lib/libraryLocation'

export interface FolderItemUi {
  drag: LibraryDrag
  /** The folder whose name is an input on this surface; null when none. */
  renamingId: string | null
  onOpen: (folder: FolderEntry) => void
  onOpenMenu: (folder: FolderEntry, point: FolderMenuPoint) => void
  /** Never rejects. */
  onRename: (folderId: string, name: string) => Promise<RenameFolderResult>
  onStopRename: () => void
}

/** Does nothing — for static markup. */
export const INERT_FOLDER_ITEM_UI: FolderItemUi = {
  drag: INERT_LIBRARY_DRAG,
  renamingId: null,
  onOpen: () => {},
  onOpenMenu: () => {},
  onRename: () => Promise.resolve({ kind: 'renamed' }),
  onStopRename: () => {},
}

/** The drop affordance: the accent border and a subtle accent fill. */
export const DROP_TARGET_STYLE = {
  borderColor: 'var(--color-accent)',
  background: 'var(--color-accent-subtle)',
} as const

/** Right-click: the menu opens where the pointer is, instead of the native one. */
export function contextMenuHandler(folder: FolderEntry, ui: FolderItemUi) {
  return (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ui.onOpenMenu(folder, { x: e.clientX, y: e.clientY })
  }
}

/** The `…` button: the menu opens under it. */
export function menuButtonHandler(folder: FolderEntry, ui: FolderItemUi) {
  return (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    ui.onOpenMenu(folder, { x: box.left, y: box.bottom })
  }
}
