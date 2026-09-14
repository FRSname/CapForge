/**
 * The collections list (`GET /api/library/collections`) for whoever needs the
 * names: the library filter and chips, the Publish card's select and Settings
 * → Collections.
 *
 * Fetched on mount; `refresh` re-reads it (after a create, or when the Publish
 * card's select gets focus, since Settings may have changed it meanwhile). A
 * failed read goes to `notify` and leaves the previous list in place.
 * `collections` is null until the first read lands, so a caller can tell "not
 * loaded" from "none".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CollectionOrphan, CollectionSummary, CollectionsList } from '../lib/collectionTypes'
import { listCollections } from '../lib/collectionsApi'

export interface CollectionsInput {
  /** Toast relay; every failure goes here. */
  notify: (message: string) => void
}

export interface CollectionsState {
  collections: CollectionSummary[] | null
  orphans: CollectionOrphan[]
  loading: boolean
  refresh: () => Promise<void>
}

export function collectionsFailedMessage(reason: string): string {
  return `Could not read the collections: ${reason}`
}

export function useCollections({ notify }: CollectionsInput): CollectionsState {
  const [list, setList] = useState<CollectionsList | null>(null)
  const [loading, setLoading] = useState(false)
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  })

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setList(await listCollections())
    } catch (err) {
      notifyRef.current(collectionsFailedMessage(err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    collections: list?.collections ?? null,
    orphans: list?.orphans ?? [],
    loading,
    refresh,
  }
}
