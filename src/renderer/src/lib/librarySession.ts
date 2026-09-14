/**
 * The pure half of "a session belongs to a library record" (v3 deliverable #3).
 *
 * Two owners of durable state, one of them primary: while a record is active
 * the session snapshot is PUT into it, and `autosave.json` is written **only**
 * when that PUT fails — stamped with the record id and the last revision the
 * app saw, so the local copy can be recognised as a fallback for a known
 * record rather than an anonymous crash file.
 *
 * The React half (`hooks/useLibrarySession.ts`) binds the I/O; everything that
 * is a *decision* lives here. `openVideoFromLibrary` / `applyEchoedCommandWith`
 * (the agent's `open_video`) stay in `lib/libraryOpen.ts` beside this module —
 * they were already pure and tested, and splitting the file would have moved
 * working code for nothing.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibraryVideo } from './libraryTypes'

/** Toasted once per session the first time the record write falls back. */
export const LIBRARY_FALLBACK_MESSAGE = 'Library unreachable — keeping a local copy.'

/** `ensureRecordFor` failed: the session still runs, autosave just falls back. */
export function recordCreateFailedMessage(reason: string): string {
  return `Could not add this video to the library (${reason}) — the session will keep a local copy.`
}

/** `openRecord` failed after the card was clicked. */
export function recordOpenFailedMessage(reason: string): string {
  return `Could not open this library video: ${reason}`
}

/** Where one autosave tick goes. */
export type SnapshotTarget = 'record' | 'local'

export interface SnapshotWriteInput {
  /** The record this session belongs to, or null when it has none. */
  activeVideoId: string | null
  /**
   * The last revision the record answered with. Carried here (rather than read
   * from a second place) because it is what the fallback stamp records; it does
   * not change the target — a record is written to whether or not it has ever
   * answered.
   */
  rev: number | null
}

/**
 * `'record'` whenever a record is active. A session without one (nothing
 * opened yet, or New) still autosaves locally exactly as it did before v3.
 */
export function planSnapshotWrite(input: SnapshotWriteInput): SnapshotTarget {
  return input.activeVideoId && input.activeVideoId.trim() ? 'record' : 'local'
}

/** The local fallback copy: the snapshot plus who it belongs to. */
export interface StampedSnapshot {
  [key: string]: unknown
  recordId: string
  rev: number | null
}

/**
 * Stamp a snapshot as "the fallback copy of record X at revision N". Returns a
 * NEW object; the snapshot handed in is never touched (it is the live project
 * file the autosave hook also dedupes against).
 */
export function withFallbackStamp(
  snapshot: unknown,
  recordId: string,
  rev: number | null
): StampedSnapshot {
  const base =
    typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {}
  return { ...base, recordId, rev }
}

/** What clicking a card does. */
export type OpenRecordPlan = 'restore' | 'choose-file'

/**
 * A record with a stored session restores it. One without has never been
 * transcribed (it was imported, or created on drop and abandoned), so the card
 * hands its source file to the drop screen instead of opening an empty editor.
 */
export function openRecordPlan(video: Pick<LibraryVideo, 'hasProject'>): OpenRecordPlan {
  return video.hasProject ? 'restore' : 'choose-file'
}
