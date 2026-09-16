/**
 * The library's folder actions, bound to the collections routes: rename, move
 * (a menu pick or a drop), delete, adopt an orphan id, and "Folder settings…".
 * Every decision is in `lib/folderActions.ts`; this hook only supplies the
 * transport and the refresh.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { CollectionSummary } from '../lib/collectionTypes'
import { createCollection, deleteCollection, patchCollection } from '../lib/collectionsApi'
import type { FolderActionDeps, RenameFolderResult } from '../lib/folderActions'
import {
  runAdoptOrphan,
  runDeleteFolder,
  runMoveFolder,
  runRenameFolder,
} from '../lib/folderActions'
import { requestSettingsCategory } from '../lib/settingsNavigation'

/** Said when Settings is not mounted to open on the folder. */
export const FOLDER_SETTINGS_FALLBACK = 'Open Settings (⌘,) → Folders to edit this folder.'

export interface FolderActionsInput {
  collections: readonly CollectionSummary[] | null
  refreshCollections: () => Promise<void>
  /** Error toast. */
  notify: (message: string) => void
  /** Success toast. */
  inform: (message: string) => void
  /** Info toast: where to go when Settings cannot be opened from here. */
  explain: (message: string) => void
}

export interface FolderActions {
  /** Never rejects. */
  renameFolder: (folderId: string, name: string) => Promise<RenameFolderResult>
  /** `parentId` null: the top level. */
  moveFolder: (folderId: string, parentId: string | null) => void
  deleteFolder: (folderId: string) => void
  /** Create a folder with this orphan id, adopting its videos. */
  adoptOrphan: (id: string) => void
  /** Settings → Folders with this folder selected. */
  openFolderSettings: (folderId: string) => void
}

export function useFolderActions(input: FolderActionsInput): FolderActions {
  const inputRef = useRef(input)
  useEffect(() => {
    inputRef.current = input
  })

  const deps = useCallback(
    (): FolderActionDeps => ({
      create: createCollection,
      patch: patchCollection,
      remove: deleteCollection,
      refreshCollections: () => inputRef.current.refreshCollections(),
      notify: (message) => inputRef.current.notify(message),
      inform: (message) => inputRef.current.inform(message),
    }),
    []
  )

  /** The folder as the list knows it; a stale id is named by itself. */
  const named = useCallback((id: string) => {
    const found = inputRef.current.collections?.find((c) => c.id === id)
    return found ?? { id, name: id }
  }, [])

  const renameFolder = useCallback(
    (folderId: string, name: string) => runRenameFolder(named(folderId), name, deps()),
    [deps, named]
  )
  const moveFolder = useCallback(
    (folderId: string, parentId: string | null) =>
      void runMoveFolder(named(folderId), parentId, inputRef.current.collections ?? [], deps()),
    [deps, named]
  )
  const deleteFolder = useCallback(
    (folderId: string) => void runDeleteFolder(named(folderId), deps()),
    [deps, named]
  )
  const adoptOrphan = useCallback((id: string) => void runAdoptOrphan(id, deps()), [deps])
  const openFolderSettings = useCallback((folderId: string) => {
    if (!requestSettingsCategory('collections', { collectionId: folderId })) {
      inputRef.current.explain(FOLDER_SETTINGS_FALLBACK)
    }
  }, [])

  return { renameFolder, moveFolder, deleteFolder, adoptOrphan, openFolderSettings }
}
