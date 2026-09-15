/**
 * Settings → General's watch folder: the one folder whose new recordings the
 * backend imports while CapForge runs (docs/plans/library-folder-import.md).
 *
 * The watcher lives in the backend; this hook only reads its status, points it
 * at a folder the user picks (or stops it), and re-reads the status when the
 * watcher announces an import, so the "imported since CapForge opened" count
 * stays current while the pane is open. Every failure is reported through
 * `notify` — a `PUT` refusal's message is written for the user by the backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { getLibraryWatch, setLibraryWatch } from '../lib/libraryApi'
import type { WatchStatus } from '../lib/libraryTypes'

export interface LibraryWatchInput {
  notify: (message: string) => void
}

export interface LibraryWatch {
  /** Null until the first status arrives. */
  status: WatchStatus | null
  /** A change is in flight. */
  busy: boolean
  /** Pick a folder and watch it. */
  choose: () => Promise<void>
  /** Stop watching. */
  stop: () => Promise<void>
}

export function watchLoadFailedMessage(reason: string): string {
  return `Could not read the watch folder: ${reason}`
}

export function watchSetFailedMessage(reason: string): string {
  return `Could not change the watch folder: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibraryWatch({ notify }: LibraryWatchInput): LibraryWatch {
  const [status, setStatus] = useState<WatchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await getLibraryWatch())
    } catch (err) {
      notifyRef.current(watchLoadFailedMessage(reasonOf(err)))
    }
  }, [])

  useEffect(() => {
    void load()
    return api.onLibraryChanged(() => void load())
  }, [load])

  const apply = useCallback(async (folder: string | null): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await setLibraryWatch(folder))
    } catch (err) {
      notifyRef.current(watchSetFailedMessage(reasonOf(err)))
    } finally {
      setBusy(false)
    }
  }, [])

  const choose = useCallback(async (): Promise<void> => {
    let folder: string | null
    try {
      folder = await window.subforge.pickLibraryFolder()
    } catch (err) {
      notifyRef.current(`Could not open the folder picker: ${reasonOf(err)}`)
      return
    }
    if (folder) await apply(folder)
  }, [apply])

  const stop = useCallback((): Promise<void> => apply(null), [apply])

  return { status, busy, choose, stop }
}
