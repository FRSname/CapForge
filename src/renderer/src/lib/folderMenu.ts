/**
 * The library folder menu's decisions (docs/plans/library-finder.md §4.1):
 * which items are disabled and the reason shown beside them, and what
 * "Move to…" offers. The backend still rules on every action; these only keep
 * the menu from offering what it would refuse.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { CollectionSummary } from './collectionTypes'
import { MAX_COLLECTION_DEPTH, canCreateInside, moveTargets, pathLabel } from './collectionTree'
import { BLANK_NAME_MESSAGE } from './collectionCreate'
import type { MoveOption } from './collectionMove'
import { topLevelOption } from './collectionMove'
import { deleteBlocker } from './collections'
import { compareFolderNames } from './libraryLocation'

type MenuFolder = Pick<CollectionSummary, 'id' | 'name' | 'parent_id' | 'members'>

export const TOO_DEEP_FOR_NEW_FOLDER = `Folders nest at most ${MAX_COLLECTION_DEPTH} levels deep — this one cannot hold another.`

export interface FolderMenuModel {
  /** Why "New folder inside" is disabled, or null. */
  newInsideBlocker: string | null
  /** Why "Delete" is disabled, or null. */
  deleteBlocker: string | null
  /** Top level, then every folder it may move into, labelled by path. */
  moveOptions: MoveOption[]
}

export function folderMenuModel(
  folderId: string,
  collections: readonly MenuFolder[]
): FolderMenuModel {
  const self = collections.find((c) => c.id === folderId)
  const parentId = self?.parent_id ?? null
  const subfolders = collections.filter((c) => c.parent_id === folderId).length
  const targets = moveTargets(collections, folderId, compareFolderNames).map(({ item }) => {
    const path = pathLabel(collections, item.id)
    return { id: item.id, label: path, title: path, depth: 1, checked: item.id === parentId }
  })
  return {
    newInsideBlocker: canCreateInside(collections, folderId) ? null : TOO_DEEP_FOR_NEW_FOLDER,
    deleteBlocker: deleteBlocker(self?.members ?? 0, subfolders),
    moveOptions: [topLevelOption(parentId === null), ...targets],
  }
}

/** Why a rename cannot be sent, or null. Empty names are refused inline, never sent. */
export function renameProblem(name: string): string | null {
  return name.trim() === '' ? BLANK_NAME_MESSAGE : null
}
