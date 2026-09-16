/**
 * The library search field's state (docs/plans/library-finder.md §3.6).
 *
 * Owned by `LibraryHome`, so it resets whenever the user leaves the library.
 * Typing is debounced (`LIBRARY_SEARCH_DEBOUNCE_MS`), then `GET
 * /api/library?q=` runs; the screen unions the returned ids with its own
 * instant name match and intersects that with what it shows (`searchResults`).
 * Until the first answer for a query lands, the last answer stays in use (or
 * only the name matches show), so the grid does not flash an empty "no match"
 * between keystrokes.
 *
 * Only the newest request counts (`createLatestOnly`): an older one resolving
 * late is dropped, and so is its failure. A failure of the newest request goes
 * to `notify` and leaves the previous matches in place.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  LIBRARY_SEARCH_DEBOUNCE_MS,
  createLatestOnly,
  isSearching,
  matchIdsOf,
  normalizeQuery,
  searchFailedMessage,
} from '../lib/librarySearch'

export interface LibrarySearchInput {
  /** App's toast relay — a failed search goes here. */
  notify: (message: string) => void
}

export interface LibrarySearchView {
  query: string
  /** The ids the backend matched; null while no answer has landed (name matches only). */
  matchIds: ReadonlySet<string> | null
}

export interface LibrarySearch extends LibrarySearchView {
  setQuery: (query: string) => void
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibrarySearch({ notify }: LibrarySearchInput): LibrarySearch {
  const [query, setQueryState] = useState('')
  const [matchIds, setMatchIds] = useState<ReadonlySet<string> | null>(null)
  const latestRef = useRef(createLatestOnly())
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  })

  const setQuery = useCallback((next: string) => {
    setQueryState(next)
    if (isSearching(next)) return
    // Cleared: forget the matches and drop whatever is still in flight.
    latestRef.current.invalidate()
    setMatchIds(null)
  }, [])

  useEffect(() => {
    const q = normalizeQuery(query)
    if (!q) return
    const timer = setTimeout(() => {
      const latest = latestRef.current
      const ticket = latest.begin()
      api.listLibrary({ q }).then(
        (rows) => {
          if (latest.isLatest(ticket)) setMatchIds(matchIdsOf(rows))
        },
        (err: unknown) => {
          if (latest.isLatest(ticket)) notifyRef.current(searchFailedMessage(q, reasonOf(err)))
        }
      )
    }, LIBRARY_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Leaving the library: an answer that lands afterwards is not wanted.
  useEffect(() => {
    const latest = latestRef.current
    return () => latest.invalidate()
  }, [])

  return { query, matchIds: isSearching(query) ? matchIds : null, setQuery }
}
