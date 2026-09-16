/**
 * The library's location and sidebar state, as writes to the remembered view
 * (`libraryView`): go somewhere, open or close a sidebar folder, show or hide
 * the sidebar, and create a folder where the user is looking.
 *
 * A folder created asynchronously is revealed (its parent expanded) when the
 * create lands, against the **latest** view rather than the one the create
 * started from, so a change made meanwhile is not undone.
 */

import { useEffect, useRef } from 'react'
import type { CreateCollectionResult } from '../lib/collectionCreate'
import type { CollectionSummary } from '../lib/collectionTypes'
import type { LibraryLocation } from '../lib/libraryLocation'
import { parentForNewFolder } from '../lib/libraryLocation'
import type { LibraryViewPrefs } from '../lib/libraryPrefs'
import { expandedWith, toggledExpanded } from '../lib/librarySidebar'

export interface LibraryLocationInput {
  /** The location on show, already resolved (`resolveLocation`). */
  location: LibraryLocation
  collections?: readonly CollectionSummary[] | null
  view: LibraryViewPrefs
  onViewChange: (next: LibraryViewPrefs) => void
  onCreateCollection: (name: string, parentId?: string | null) => Promise<CreateCollectionResult>
}

export interface LibraryLocationActions {
  navigate: (location: LibraryLocation) => void
  toggleExpanded: (folderId: string) => void
  toggleSidebar: () => void
  /** "+ New folder": inside the folder on show, else at the top level. */
  createFolder: (name: string) => Promise<CreateCollectionResult>
  /** A folder's "New folder inside…". */
  createInside: (parentId: string, name: string) => Promise<CreateCollectionResult>
  /** After "+ New folder": open its parent so the new folder shows in the sidebar. */
  revealCreated: (folder: CollectionSummary) => void
  /** "+ New folder"'s tooltip: where it creates. */
  newFolderTitle: string
}

export function newFolderTitle(parentName: string | null): string {
  return parentName ? `New folder inside ${parentName}` : 'New top-level folder'
}

export function useLibraryLocation(input: LibraryLocationInput): LibraryLocationActions {
  const latest = useRef(input)
  useEffect(() => {
    latest.current = input
  })
  const collections = input.collections ?? null
  const parentId = parentForNewFolder(input.location, collections)
  const parentName = collections?.find((c) => c.id === parentId)?.name ?? null

  function update(change: (view: LibraryViewPrefs) => LibraryViewPrefs) {
    const { view, onViewChange } = latest.current
    onViewChange(change(view))
  }

  function expand(folderId: string) {
    update((view) => ({ ...view, expanded: expandedWith(view.expanded, folderId) }))
  }

  return {
    navigate: (location) => update((view) => ({ ...view, location })),
    toggleExpanded: (folderId) =>
      update((view) => ({ ...view, expanded: toggledExpanded(view.expanded, folderId) })),
    toggleSidebar: () => update((view) => ({ ...view, sidebarCollapsed: !view.sidebarCollapsed })),
    createFolder: (name) => input.onCreateCollection(name, parentId),
    createInside: (inside, name) =>
      input.onCreateCollection(name, inside).then((result) => {
        if (result.kind === 'created') expand(inside)
        return result
      }),
    revealCreated: (folder) => {
      if (folder.parent_id) expand(folder.parent_id)
    },
    newFolderTitle: newFolderTitle(parentName),
  }
}
