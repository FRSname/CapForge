/**
 * The open folder menu, wired: `FolderContextMenu` with each item bound to the
 * folder actions. Every item that runs something closes the menu first;
 * Rename closes it by turning the folder's name into an input where the menu
 * was opened (the sidebar, or the main area).
 */

import type { FolderActions } from '../../hooks/useFolderActions'
import type { FolderMenuAnchor, FolderMenuState } from '../../hooks/useFolderMenu'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { folderMenuModel } from '../../lib/folderMenu'
import { FolderContextMenu } from './FolderMenu'

export interface LibraryFolderMenuProps {
  anchor: FolderMenuAnchor
  collections: readonly CollectionSummary[]
  menu: FolderMenuState
  actions: FolderActions
  onCreateInside: (parentId: string, name: string) => Promise<CreateCollectionResult>
}

export function LibraryFolderMenu({
  anchor,
  collections,
  menu,
  actions,
  onCreateInside,
}: LibraryFolderMenuProps) {
  const { folder } = anchor
  const parentId = collections.find((c) => c.id === folder.id)?.parent_id ?? null
  const run = (action: () => void) => () => {
    menu.closeMenu()
    action()
  }
  return (
    <FolderContextMenu
      anchor={anchor}
      model={folder.orphan ? null : folderMenuModel(folder.id, collections)}
      onCreateInside={(name) => onCreateInside(folder.id, name)}
      onRename={() => menu.startRename(folder.id, anchor.surface)}
      onMove={(target) => {
        menu.closeMenu()
        // The checked row is where it already is: nothing to send.
        if (target !== parentId) actions.moveFolder(folder.id, target)
      }}
      onOpenSettings={run(() => actions.openFolderSettings(folder.id))}
      onDelete={run(() => actions.deleteFolder(folder.id))}
      onAdopt={run(() => actions.adoptOrphan(folder.id))}
      onDone={menu.closeMenu}
    />
  )
}
