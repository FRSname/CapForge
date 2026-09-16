/**
 * A library card's "Move to folder…" sub-list: Top level, the folder tree
 * (indented, the current folder checked, each path in its tooltip) and
 * "New folder…", which swaps the list for the shared name form and moves the
 * video into what it creates (at the top level).
 *
 * Presentational apart from that one toggle; the move itself (read the rev,
 * PATCH with `If-Match`, retry once on a 409) is `lib/collectionMove.ts`.
 */

import { useState } from 'react'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import { moveMenuOptions } from '../../lib/collectionMove'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { FolderOptionList } from './FolderOptionList'
import { MenuItem } from './LibraryMenuParts'
import { NewCollectionForm } from './NewCollectionForm'

export interface MoveToCollectionMenuProps {
  collections: readonly CollectionSummary[]
  /** The record's `collection_id`. */
  currentId: string | null
  /** A row was picked, or a new folder was created (its id). */
  onPick: (collectionId: string | null) => void
  onCreate: (name: string) => Promise<CreateCollectionResult>
  /** Back to the card's main actions. */
  onBack: () => void
  /** Start on the name form — for static-markup tests. */
  defaultCreating?: boolean
}

export function MoveToCollectionMenu({
  collections,
  currentId,
  onPick,
  onCreate,
  onBack,
  defaultCreating = false,
}: MoveToCollectionMenuProps) {
  const [creating, setCreating] = useState(defaultCreating)

  if (creating) {
    return (
      <div className="px-1.5 py-1">
        <NewCollectionForm
          onCreate={onCreate}
          onCreated={(collection) => onPick(collection.id)}
          onCancel={() => setCreating(false)}
        />
      </div>
    )
  }

  return (
    <>
      <FolderOptionList
        heading="Move to folder"
        backLabel="Back to record actions"
        options={moveMenuOptions(collections, currentId)}
        onPick={onPick}
        onBack={onBack}
      />
      <MenuItem label="New folder…" onClick={() => setCreating(true)} />
    </>
  )
}
