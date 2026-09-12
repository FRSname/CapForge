/**
 * Crash recovery — the autosave snapshot left on disk by a session that didn't
 * end via an explicit Save or New (i.e. a crash or an accidental close).
 *
 * Read once on launch, best-effort: recovery is a safety net, so a failed read
 * must never block the app from starting. The caller renders the banner from
 * `snapshot` and restores through the same `restoreFromProjectFile` path an
 * Open takes — there is no second restore implementation.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ProjectFile } from '../lib/project'

/** An autosave snapshot, with the write timestamp the main process stamps on. */
export type RecoverySnapshot = ProjectFile & { savedAt?: number }

export function useCrashRecovery(restore: (raw: unknown) => Promise<void>): {
  snapshot: RecoverySnapshot | null
  recover: () => Promise<void>
  discard: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null)

  // On launch, read any leftover autosave snapshot and offer to restore it.
  useEffect(() => {
    let cancelled = false
    window.subforge
      .autosaveRead()
      .then((snap) => {
        if (!cancelled && snap) setSnapshot(snap as RecoverySnapshot)
      })
      .catch(() => {
        /* ignore — recovery is best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const recover = useCallback(async () => {
    if (!snapshot) return
    await restore(snapshot)
    setSnapshot(null)
  }, [snapshot, restore])

  const discard = useCallback(async () => {
    await window.subforge.autosaveClear()
    setSnapshot(null)
  }, [])

  return { snapshot, recover, discard }
}
