/**
 * The remembered library view (`app-state` key `libraryView`, parsed by
 * `lib/libraryPrefs.ts`): layout, icon size and sort.
 *
 * Read once on mount through the same `state:get` / `state:set` bridge
 * `useImportChannels` uses for `lastPublishChannels`. Until the read lands the
 * defaults show (today's grid), and a change the user makes before it lands
 * wins over the stored value.
 *
 * A change applies at once and is written after `LIBRARY_PREFS_WRITE_DEBOUNCE_MS`
 * (dragging the icon-size slider would otherwise write the state file per
 * pixel); a pending write is flushed when the library unmounts, so opening a
 * video right after a change still keeps it. A failed read or write goes to
 * `notify` — the view itself keeps working either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryViewPrefs } from '../lib/libraryPrefs'
import {
  DEFAULT_LIBRARY_VIEW_PREFS,
  LIBRARY_VIEW_KEY,
  parseLibraryViewPrefs,
} from '../lib/libraryPrefs'

/** A change is written once the controls have been still this long. */
export const LIBRARY_PREFS_WRITE_DEBOUNCE_MS = 300

export interface LibraryViewPrefsInput {
  notify: (message: string) => void
}

export interface LibraryViewPrefsState {
  prefs: LibraryViewPrefs
  setPrefs: (next: LibraryViewPrefs) => void
}

export function prefsReadFailedMessage(reason: string): string {
  return `Could not read the library view settings: ${reason}`
}

export function prefsWriteFailedMessage(reason: string): string {
  return `Could not remember the library view: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** `window` is absent under vitest's node env. */
function appState(): Window['subforge'] | null {
  return typeof window === 'undefined' ? null : (window.subforge ?? null)
}

export function useLibraryViewPrefs({ notify }: LibraryViewPrefsInput): LibraryViewPrefsState {
  const [prefs, setPrefsState] = useState<LibraryViewPrefs>(DEFAULT_LIBRARY_VIEW_PREFS)
  const touchedRef = useRef(false)
  const pendingRef = useRef<LibraryViewPrefs | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  })

  useEffect(() => {
    const bridge = appState()
    if (!bridge) return
    let live = true
    bridge.getState<unknown>(LIBRARY_VIEW_KEY, null).then(
      (stored) => {
        if (live && !touchedRef.current) setPrefsState(parseLibraryViewPrefs(stored))
      },
      (err: unknown) => {
        if (live) notifyRef.current(prefsReadFailedMessage(reasonOf(err)))
      }
    )
    return () => {
      live = false
    }
  }, [])

  const flush = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    const bridge = appState()
    if (!pending || !bridge) return
    bridge.setState(LIBRARY_VIEW_KEY, pending).catch((err: unknown) => {
      notifyRef.current(prefsWriteFailedMessage(reasonOf(err)))
    })
  }, [])

  useEffect(() => flush, [flush])

  const setPrefs = useCallback(
    (next: LibraryViewPrefs) => {
      touchedRef.current = true
      setPrefsState(next)
      pendingRef.current = next
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, LIBRARY_PREFS_WRITE_DEBOUNCE_MS)
    },
    [flush]
  )

  return { prefs, setPrefs }
}
