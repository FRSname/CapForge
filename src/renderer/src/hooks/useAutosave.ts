/**
 * Debounced crash-recovery autosave.
 *
 * Writes the current session snapshot (whatever `getSnapshot` returns) via
 * `window.subforge.autosaveWrite` ~`delay` ms after the last change. Skips
 * writes when the snapshot is null (no active session) or unchanged since the
 * last write, so playback ticks and no-op renders don't churn the disk. Returns
 * the timestamp (ms) of the last successful write for a UI indicator.
 *
 * **Serialization is deferred into the timer**, not done per change: a change
 * only arms (re-arms) the timer, and the snapshot is taken + stringified once,
 * when it fires. Stringifying a 9000-word project costs ~8 ms, so doing it on
 * every slider tick made dragging visibly worse for a write that was about to
 * be superseded anyway. `getSnapshot` is a fresh closure each render, so the
 * timer reads it through a ref to avoid capturing a stale session.
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

  // Latest-closure ref: updated after every render, read only inside the timer.
  const snapshotRef = useRef(getSnapshot)
  useEffect(() => {
    snapshotRef.current = getSnapshot
  })

  useEffect(() => {
    const handle = setTimeout(() => {
      const snapshot = snapshotRef.current()
      if (snapshot == null) return
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSerialized.current) return

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
