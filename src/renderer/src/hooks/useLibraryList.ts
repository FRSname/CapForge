/**
 * The library home screen's data: every record the backend knows about.
 *
 * Fetched on mount and again whenever the app returns to the library screen —
 * a session that just finished transcribing has changed its record's status,
 * and the list is the thing that shows it. A failed fetch is reported through
 * the caller's `notify` (never swallowed) and leaves the previous rows in
 * place, so a transient backend hiccup does not blank the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { LibraryVideo } from '../lib/libraryTypes'

export interface LibraryListInput {
  /** True while the library screen is the one on show. */
  active: boolean
  /** App's toast relay — the fetch failure goes here. */
  notify: (message: string) => void
}

export interface LibraryList {
  videos: LibraryVideo[]
  loading: boolean
  refresh: () => Promise<void>
}

/** Prefix so a failed list is recognisable among the app's other toasts. */
export function libraryListFailedMessage(reason: string): string {
  return `Could not read the library: ${reason}`
}

export function useLibraryList({ active, notify }: LibraryListInput): LibraryList {
  const [videos, setVideos] = useState<LibraryVideo[]>([])
  const [loading, setLoading] = useState(false)

  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setVideos(await api.listLibrary())
    } catch (err) {
      notifyRef.current(
        libraryListFailedMessage(err instanceof Error ? err.message : String(err))
      )
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-runs only on the false→true edge of `active`, which is exactly "the user
  // came back to the library".
  useEffect(() => {
    if (!active) return
    void refresh()
  }, [active, refresh])

  return { videos, loading, refresh }
}
