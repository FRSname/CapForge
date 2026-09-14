/**
 * The launch banner for an autosave snapshot left on disk by a session that
 * didn't end via an explicit Save or New (a crash or an accidental close).
 *
 * Extracted from `App.tsx` verbatim when the library screen landed — App is at
 * its size ceiling (§9.3) and this markup is self-contained. It renders nothing
 * without a snapshot, so the caller can hand it the hook's value directly.
 *
 * Since v3 the snapshot is the *fallback* copy: the live session is stored in
 * its library record, and `autosave.json` is only written when that write
 * fails. Restoring goes through the same `restoreFromProjectFile` path an Open
 * takes, so a stamped fallback copy installs exactly like a project file.
 */

import type { RecoverySnapshot } from '../../hooks/useCrashRecovery'
import { Button } from '../ui/Button'

export interface RecoveryBannerProps {
  /** The snapshot found at launch, or null when there was none. */
  snapshot: RecoverySnapshot | null
  onRestore: () => void
  onDiscard: () => void
}

export function RecoveryBanner({ snapshot, onRestore, onDiscard }: RecoveryBannerProps) {
  if (!snapshot) return null
  return (
    <div
      className="app-no-drag flex items-center gap-3 px-4 py-2 text-xs border-b border-[var(--color-border)]"
      style={{ background: 'var(--color-surface-2)' }}
    >
      <span style={{ color: 'var(--color-text-2)' }}>
        Unsaved session recovered
        {snapshot.savedAt ? ` from ${new Date(snapshot.savedAt).toLocaleString()}` : ''}.
      </span>
      <Button variant="titlebar" onClick={onRestore}>
        Restore
      </Button>
      <Button variant="titlebar" style={{ color: 'var(--color-text-3)' }} onClick={onDiscard}>
        Discard
      </Button>
    </div>
  )
}
