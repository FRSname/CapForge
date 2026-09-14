/**
 * The `Captions | Publish` axis over the open record.
 *
 * Not a fifth `Screen` (vision §4): both workspaces read the same transcript,
 * track store and player, and App keeps both asides mounted. This hook owns
 * the toggle, the gate (there is nothing to publish without a library record)
 * and the two ends of the player wire the Publish panel needs — a one-shot
 * seek out to the player, and the playhead coming back in.
 *
 * The playhead is a **ref**, not state: it moves ~30× a second during
 * playback, and only the "Insert at playhead" button ever reads it.
 */

import { useCallback, useRef, useState } from 'react'
import type { Workspace } from '../types/app'

/**
 * How close the reported playhead has to get to a pending seek before the
 * request is considered consumed. Anything under a frame at 24 fps; the point
 * is only to let the *same* timestamp be seeked to twice in a row.
 */
const SEEK_SETTLE_S = 0.25

export interface PublishWorkspaceInput {
  /** The record this session belongs to — null disables the Publish tab. */
  activeVideoId: string | null
}

export interface PublishWorkspaceController {
  workspace: Workspace
  setWorkspace: (workspace: Workspace) => void
  /** False when the session has no record: there is no dossier to edit. */
  publishEnabled: boolean
  /** Consumed by ResultsScreen → AudioPlayer's `seekTo`. */
  pendingSeek: number | null
  /** Move the player to `seconds` (a chapter row was clicked). */
  seek: (seconds: number) => void
  /** Wired to ResultsScreen's `onTimeUpdate`. */
  handleTimeUpdate: (time: number) => void
  /** Where the player is right now — read by "Insert at playhead". */
  getPlayhead: () => number
}

export function usePublishWorkspace({
  activeVideoId,
}: PublishWorkspaceInput): PublishWorkspaceController {
  const [requested, setRequested] = useState<Workspace>('captions')
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)
  const playheadRef = useRef(0)

  const publishEnabled = Boolean(activeVideoId)
  // Derived, not corrected by an effect: losing the record (New, a fresh drop)
  // puts the user back on the captions aside in the same render.
  const workspace: Workspace = publishEnabled ? requested : 'captions'

  const seek = useCallback((seconds: number) => {
    setPendingSeek(Math.max(0, seconds))
  }, [])

  const handleTimeUpdate = useCallback((time: number) => {
    playheadRef.current = time
    // Clear the request once the player has actually arrived, so clicking the
    // same chapter twice seeks twice (the player only reacts to a *changed*
    // `seekTo` value).
    setPendingSeek((pending) =>
      pending !== null && Math.abs(time - pending) <= SEEK_SETTLE_S ? null : pending
    )
  }, [])

  const getPlayhead = useCallback(() => playheadRef.current, [])

  return {
    workspace,
    setWorkspace: setRequested,
    publishEnabled,
    pendingSeek,
    seek,
    handleTimeUpdate,
    getPlayhead,
  }
}
