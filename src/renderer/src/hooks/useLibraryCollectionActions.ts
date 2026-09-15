/**
 * The library screen's collection actions: create one by name (the toolbar,
 * the empty state, a card's "New collection…") and move one video into a
 * collection from its card.
 *
 * A separate hook rather than more of `useLibraryActions`, which is already a
 * screenful. This file only binds the transport and the refreshes; every
 * decision (the rev read, the single 409 retry, what is inline and what is
 * toasted) is in `lib/collectionCreate.ts` and `lib/collectionMove.ts`, where
 * the node test environment can reach it.
 */

import { useCallback, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import type { CreateCollectionResult } from '../lib/collectionCreate'
import { runCreateCollection } from '../lib/collectionCreate'
import { runMoveToCollection } from '../lib/collectionMove'
import type { CollectionSummary } from '../lib/collectionTypes'
import { createCollection } from '../lib/collectionsApi'
import type { LibraryVideo } from '../lib/libraryTypes'

export interface LibraryCollectionActionsInput {
  /** The loaded collections, for naming a move target in a message. */
  collections: readonly CollectionSummary[] | null
  /** Re-read the library list. */
  refresh: () => Promise<void>
  /** Re-read the collections list. */
  refreshCollections: () => Promise<void>
  /** Error toast. */
  notify: (message: string) => void
  /** Success toast. */
  inform: (message: string) => void
}

export interface LibraryCollectionActions {
  /** Never rejects: failures are returned as `invalid` or toasted. */
  createCollection: (name: string) => Promise<CreateCollectionResult>
  /** Never rejects: failures are toasted. `null` takes the video out of any collection. */
  moveToCollection: (video: LibraryVideo, collectionId: string | null) => Promise<void>
}

export function useLibraryCollectionActions(
  input: LibraryCollectionActionsInput
): LibraryCollectionActions {
  const inputRef = useRef(input)
  useEffect(() => {
    inputRef.current = input
  })

  const create = useCallback(
    (name: string): Promise<CreateCollectionResult> =>
      runCreateCollection(name, {
        create: createCollection,
        refreshCollections: () => inputRef.current.refreshCollections(),
        notify: (message) => inputRef.current.notify(message),
        inform: (message) => inputRef.current.inform(message),
      }),
    []
  )

  const moveToCollection = useCallback(
    async (video: LibraryVideo, collectionId: string | null): Promise<void> => {
      await runMoveToCollection(video, collectionId, inputRef.current.collections ?? [], {
        read: (id) => api.getLibraryRecord(id),
        write: (id, patch, rev) => api.patchLibraryRecord(id, patch, rev),
        refresh: () => inputRef.current.refresh(),
        refreshCollections: () => inputRef.current.refreshCollections(),
        notify: (message) => inputRef.current.notify(message),
      })
    },
    []
  )

  return { createCollection: create, moveToCollection }
}
