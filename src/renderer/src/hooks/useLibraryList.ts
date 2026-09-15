/**
 * The library home screen's data: every record the backend knows about.
 *
 * Fetched on mount and again whenever the app returns to the library screen —
 * a session that just finished transcribing has changed its record's status,
 * and the list is the thing that shows it. A failed fetch is reported through
 * the caller's `notify` (never swallowed) and leaves the previous rows in
 * place, so a transient backend hiccup does not blank the screen.
 *
 * While active it also refetches on the control socket's `library_changed`
 * (the watch folder imported something, or a record's probed duration or poster
 * landed) — debounced, because an import of 100 files fires one frame per
 * record. While inactive nothing listens — the activation edge refetches anyway.
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

/** A `library_changed` burst refetches once this long after its last frame. */
export const LIBRARY_REFETCH_QUIET_MS = 400

/**
 * …and never later than this after its first, so a long import (one frame per
 * record as the poster pool works through it) still fills the cards in as it
 * goes instead of waiting for the whole batch to go quiet.
 */
export const LIBRARY_REFETCH_MAX_WAIT_MS = 2000

export interface QuietWindow {
  /** A frame arrived: (re)start the quiet window. */
  poke: () => void
  /** Drop a pending refetch (the listener is going away). */
  cancel: () => void
}

/**
 * Coalesce pokes into one `fire` per quiet window: `quietMs` after the last
 * poke, or `maxWaitMs` after the first unserved one, whichever comes first.
 */
export function createQuietWindow(
  fire: () => void,
  quietMs: number = LIBRARY_REFETCH_QUIET_MS,
  maxWaitMs: number = LIBRARY_REFETCH_MAX_WAIT_MS
): QuietWindow {
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (quietTimer !== null) clearTimeout(quietTimer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    quietTimer = null
    maxTimer = null
  }

  const flush = (): void => {
    cancel()
    fire()
  }

  return {
    poke() {
      if (quietTimer !== null) clearTimeout(quietTimer)
      quietTimer = setTimeout(flush, quietMs)
      if (maxTimer === null) maxTimer = setTimeout(flush, maxWaitMs)
    },
    cancel,
  }
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

  useEffect(() => {
    if (!active) return
    const quiet = createQuietWindow(() => void refresh())
    const unsubscribe = api.onLibraryChanged(() => quiet.poke())
    return () => {
      unsubscribe()
      quiet.cancel()
    }
  }, [active, refresh])

  return { videos, loading, refresh }
}
