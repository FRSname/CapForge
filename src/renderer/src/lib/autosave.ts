/**
 * The decision `hooks/useAutosave.ts` makes on every tick *and* on an explicit
 * flush: is there a session snapshot, and has it changed since the last write.
 *
 * Pure module: no React, no I/O.
 */

/** The serialized snapshot to write, or null when there is nothing new. */
export function serializeIfChanged(snapshot: unknown, lastSerialized: string | null): string | null {
  if (snapshot == null) return null
  const serialized = JSON.stringify(snapshot)
  return serialized === lastSerialized ? null : serialized
}
