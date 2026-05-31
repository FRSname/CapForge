/**
 * Debounced crash-recovery autosave.
 *
 * Serializes the current session snapshot (whatever `getSnapshot` returns) and
 * writes it via `window.subforge.autosaveWrite` ~`delay` ms after the last
 * change. Skips writes when the snapshot is null (no active session) or
 * unchanged since the last write, so playback ticks and no-op renders don't
 * churn the disk. Returns the timestamp (ms) of the last successful write for a
 * UI indicator.
 *
 * Pattern mirrors useDebounce (rules/typescript/patterns.md): the timer is set
 * in an effect keyed on `deps` and cleared on cleanup.
 */

import { useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'

export function useAutosave(
  getSnapshot: () => unknown | null,
  deps: DependencyList,
  delay = 2000,
): number | null {
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const lastSerialized = useRef<string | null>(null)

  useEffect(() => {
    const snapshot = getSnapshot()
    if (snapshot == null) return
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSerialized.current) return

    const handle = setTimeout(() => {
      lastSerialized.current = serialized
      window.subforge.autosaveWrite(JSON.parse(serialized))
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => { /* best-effort — recovery is a safety net, not critical path */ })
    }, delay)
    return () => clearTimeout(handle)
    // getSnapshot is intentionally excluded: it's a fresh closure each render;
    // deps is the explicit change signal the caller controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay])

  return lastSavedAt
}
