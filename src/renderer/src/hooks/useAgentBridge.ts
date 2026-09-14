/**
 * What the agent is allowed to do to the open session — the five handlers
 * `AgentLiveSync` calls, lifted out of `App.tsx` so the component stays a
 * composition root rather than a dispatch table.
 *
 * Nothing here is new behaviour: each function is the one App held, with the
 * store and the mounted editor passed in instead of closed over.
 */

import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { TranscriptionResult } from '../types/app'
import type { AgentCommand } from '../lib/api'
import type { ProjectIOHandle, WordOverrideEdit } from '../lib/project'
import { ensureWordIds } from '../lib/wordIds'
import { syncSegmentsIntoTrack } from '../lib/tracks'
import type { CaptionTrack } from '../lib/tracks'
import { applyTrackCommand } from '../lib/trackCommands'
import type { StudioSettings } from '../components/studio/StudioPanel'

export interface AgentBridgeInput {
  tracks: readonly CaptionTrack[]
  activeTrackId: string
  sourceTrack: CaptionTrack
  updateTrack: (trackId: string, fn: (track: CaptionTrack) => CaptionTrack) => void
  commitTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  bumpRevision: (trackId: string) => void
  /** The mounted editor, when there is one (agent transcript edits go through it). */
  projectIORef: MutableRefObject<ProjectIOHandle | null>
  /** Persist "these timings are approximate" with the project metadata. */
  markAlignmentDegraded: () => void
  /** The undoable settings setter for the *active* track. */
  applyActiveSettings: (next: StudioSettings) => void
  /** The plain setter for any other track. */
  setTrackSettings: (trackId: string, next: StudioSettings) => void
}

export interface AgentBridge {
  applyResult: (result: TranscriptionResult) => void
  applyWordOverrides: (edits: WordOverrideEdit[]) => void
  settingsForTrack: (trackId?: string) => StudioSettings | null
  applySettings: (next: StudioSettings, trackId?: string) => void
  applyTrackCommand: (cmd: AgentCommand) => string
}

export function useAgentBridge({
  tracks,
  activeTrackId,
  sourceTrack,
  updateTrack,
  commitTracks,
  bumpRevision,
  projectIORef,
  markAlignmentDegraded,
  applyActiveSettings,
  setTrackSettings,
}: AgentBridgeInput): AgentBridge {
  /**
   * An agent transcript edit always targets the **source** track, whichever tab
   * happens to be open: `update_words` and `remove_filler_words` edit the
   * transcript, and applying them to whatever editor is mounted would rewrite a
   * translation with English words. When the source is the active tab the edit
   * goes through the mounted editor (which pushes an undo entry the user can
   * revert); otherwise it is reconciled straight into the stored track.
   */
  const applyResult = useCallback(
    (r: TranscriptionResult) => {
      if (activeTrackId === sourceTrack.id) {
        // The editor reports the alignment flag back through onAlignmentDegraded.
        projectIORef.current?.applyAgentResult(r)
        return
      }
      updateTrack(sourceTrack.id, (track) => ({
        ...syncSegmentsIntoTrack(
          track,
          ensureWordIds(r.segments),
          track.settings.wordsPerGroup,
          false
        ),
        segmentsEdited: true,
      }))
      if (r.alignmentDegraded) markAlignmentDegraded()
    },
    [activeTrackId, sourceTrack.id, updateTrack, markAlignmentDegraded, projectIORef]
  )

  const applyWordOverrides = useCallback(
    (edits: WordOverrideEdit[]) => projectIORef.current?.applyWordOverrides(edits),
    [projectIORef]
  )

  /** The style command's target: the named track, or the active one. */
  const settingsForTrack = useCallback(
    (trackId?: string): StudioSettings | null => {
      const id = trackId || activeTrackId
      return tracks.find((t) => t.id === id)?.settings ?? null
    },
    [tracks, activeTrackId]
  )

  const applySettings = useCallback(
    (next: StudioSettings, trackId?: string) => {
      const id = trackId || activeTrackId
      // Only the active track's change is undoable — the undo stack belongs to
      // the tab the user is looking at.
      if (id === activeTrackId) applyActiveSettings(next)
      else setTrackSettings(id, next)
    },
    [activeTrackId, applyActiveSettings, setTrackSettings]
  )

  /**
   * `create_track` / `set_track_text` / `reflow_track`. Every rule lives in
   * `lib/trackCommands.ts`; failures throw and AgentLiveSync echoes the message
   * back to the agent instead of swallowing it.
   */
  const applyCommand = useCallback(
    (cmd: AgentCommand): string => {
      const next = applyTrackCommand(tracks, activeTrackId, cmd)
      commitTracks(next.tracks, next.activeTrackId)
      // The editor owns its own copy of the track it is mounted on, so a write
      // that lands underneath it only becomes visible on a remount.
      if (next.remountTrackId) bumpRevision(next.remountTrackId)
      return next.message
    },
    [tracks, activeTrackId, commitTracks, bumpRevision]
  )

  return {
    applyResult,
    applyWordOverrides,
    settingsForTrack,
    applySettings,
    applyTrackCommand: applyCommand,
  }
}
