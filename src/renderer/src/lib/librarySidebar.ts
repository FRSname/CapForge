/**
 * The library sidebar's folder tree (docs/plans/library-finder.md §4.1): which
 * rows show, how deep, and whether each is expanded.
 *
 * A folder's subfolders show while it is in the remembered `expanded` list, and
 * also — without being remembered — while the folder on show is somewhere
 * below it, so navigating into a folder from a tile never leaves the sidebar
 * pointing at nothing. Orphan ids follow the tree, at the top level.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import { ancestorsOf, buildTree } from './collectionTree'
import type { TreeNode } from './collectionTree'
import type { FolderEntry, FolderItem, LibraryLocation } from './libraryLocation'
import { compareFolderNames, folderEntry, orphanEntry, orphanIds } from './libraryLocation'
import type { LibraryVideo } from './libraryTypes'

export interface SidebarRow {
  entry: FolderEntry
  /** 1 for a top-level folder (under "Library"). */
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/** Remembered expansion plus the ancestors of the folder on show. */
function openIds(
  collections: readonly FolderItem[],
  expanded: readonly string[],
  location: LibraryLocation
): Set<string> {
  const revealed = location.kind === 'folder' ? ancestorsOf(collections, location.id) : []
  return new Set([...expanded, ...revealed.map((f) => f.id)])
}

export function sidebarRows(
  collections: readonly FolderItem[] | null,
  videos: readonly Pick<LibraryVideo, 'collection_id'>[],
  expanded: readonly string[],
  location: LibraryLocation
): SidebarRow[] {
  if (collections === null) return []
  const open = openIds(collections, expanded, location)

  function rows(node: TreeNode<FolderItem>): SidebarRow[] {
    const hasChildren = node.children.length > 0
    const isOpen = hasChildren && open.has(node.item.id)
    const self = {
      entry: folderEntry(node.item, collections ?? []),
      depth: node.depth,
      hasChildren,
      expanded: isOpen,
    }
    return isOpen ? [self, ...node.children.flatMap(rows)] : [self]
  }

  const tree = buildTree(collections, compareFolderNames).flatMap(rows)
  const orphans = orphanIds(videos, collections).map((id) => ({
    entry: orphanEntry(id, videos),
    depth: 1,
    hasChildren: false,
    expanded: false,
  }))
  return [...tree, ...orphans]
}

/** Open a closed folder, close an open one. Returns a NEW array. */
export function toggledExpanded(expanded: readonly string[], id: string): string[] {
  return expanded.includes(id) ? expanded.filter((e) => e !== id) : [...expanded, id]
}

/** `expanded` with `id` open. Returns a NEW array. */
export function expandedWith(expanded: readonly string[], id: string): string[] {
  return expanded.includes(id) ? [...expanded] : [...expanded, id]
}

/** The "Library" row's count: videos in no folder. */
export function unfiledCount(videos: readonly Pick<LibraryVideo, 'collection_id'>[]): number {
  return videos.filter((v) => v.collection_id === null).length
}
