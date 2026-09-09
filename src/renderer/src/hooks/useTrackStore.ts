/**
 * The caption-track store — App's single source of truth for what the editor,
 * the studio sidebar, the render path and the agent mirror all read.
 *
 * Before tracks, `App` held `settings` + `groups` + `groupsEdited` +
 * `appliedPreset` as four parallel states and `ResultsScreen` owned the rest.
 * A track is exactly that bundle with a name on it, so this hook holds a list
 * of them plus which one is active, and everything else is *derived*: there is
 * no second copy of a track's settings or groups to fall out of sync.
 *
 * `result` stays in App. It is project metadata (language, duration, audio path,
 * the alignment flag) — the source track's `segments` are the transcript.
 *
 * The store is authoritative only for tracks that are **not** mounted: the
 * active track's editor owns its own copy while it is up and publishes it back
 * on every change (`onTrackStateChange`). Writing to the active track from
 * outside therefore needs a remount to be visible, which is what `revisions`
 * is for.
 */

import { useCallback, useMemo, useState } from 'react'
import type { Segment, TranscriptionResult } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { buildStudioGroups } from '../lib/groups'
import { ensureWordIds } from '../lib/wordIds'
import {
  SOURCE_TRACK_ID,
  SOURCE_TRACK_LABEL,
  displayGroupsFor,
  type CaptionTrack,
  type TrackEditorState,
} from '../lib/tracks'
import { classifyTrack, type TrackClassification } from '../lib/trackStaleness'
import type { ProjectMeta } from '../lib/project'

/** The one track that always exists, before any transcript has been loaded. */
export function emptySourceTrack(settings: StudioSettings = { ...STUDIO_DEFAULTS }): CaptionTrack {
  return {
    id: SOURCE_TRACK_ID,
    label: SOURCE_TRACK_LABEL,
    lang: 'en',
    isSource: true,
    segments: [],
    groups: [],
    groupsEdited: false,
    segmentsEdited: false,
    settings,
    appliedPreset: null,
  }
}

/**
 * The source track for a freshly finished transcription. Word ids are minted on
 * the way in and the groups chunked exactly as the editor would have — the
 * editor is handed these as `initialGroups`, so the two can never disagree.
 *
 * `previous` carries the style forward: a transcription does not reset the look
 * the user has been building (only New / `load_video` do).
 */
export function sourceTrackFromResult(
  result: TranscriptionResult,
  previous: CaptionTrack
): CaptionTrack {
  const segments = ensureWordIds(result.segments)
  return {
    ...previous,
    id: SOURCE_TRACK_ID,
    isSource: true,
    lang: result.language || previous.lang,
    segments,
    groups: buildStudioGroups(segments, previous.settings.wordsPerGroup),
    groupsEdited: false,
    segmentsEdited: false,
  }
}

/** Project-level metadata for `projectFileFromTracks` — the source track owns the rest. */
export function projectMetaFor(result: TranscriptionResult): ProjectMeta {
  return { result }
}

export interface TrackStore {
  tracks: CaptionTrack[]
  activeTrackId: string
  activeTrack: CaptionTrack
  sourceTrack: CaptionTrack
  /** Positional against `tracks`; null for the source (it is the reference). */
  classifications: Array<TrackClassification | null>
  /** `displayGroupsFor(activeTrack)` — the render/preview view of the tab. */
  displayGroups: Segment[]
  /** Per-track remount counter; part of `ResultsScreen`'s key. */
  revisions: Record<string, number>
  setActiveTrackId: (id: string) => void
  /** Replace the whole store (New, load_video, transcription, project open).
   *  Clears the remount counters — nothing that came before is still mounted. */
  replaceTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  /** Write a new track list + active tab without disturbing remount counters
   *  (an agent command edits the store the user is already working in). */
  commitTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  /** Rewrite one track by id; a no-op when it is gone. */
  updateTrack: (id: string, update: (track: CaptionTrack) => CaptionTrack) => void
  /** Rewrite every track (the video probe writes media geometry to all of them). */
  updateAllTracks: (update: (track: CaptionTrack) => CaptionTrack) => void
  /** Fold the editor's published state into the track it belongs to. */
  commitEditorState: (trackId: string, state: TrackEditorState) => void
  /** Force a remount of `id`'s editor — its stored state changed underneath it. */
  bumpRevision: (id: string) => void
}

export function useTrackStore(): TrackStore {
  const [tracks, setTracks] = useState<CaptionTrack[]>(() => [emptySourceTrack()])
  const [activeTrackId, setActiveTrackId] = useState<string>(SOURCE_TRACK_ID)
  const [revisions, setRevisions] = useState<Record<string, number>>({})

  // The source track always exists; the fallbacks are belt-and-braces so a
  // malformed store can never crash the whole app on a missing find().
  const sourceTrack = useMemo(() => tracks.find((t) => t.isSource) ?? tracks[0], [tracks])
  const activeTrack = useMemo(
    () => tracks.find((t) => t.id === activeTrackId) ?? sourceTrack,
    [tracks, activeTrackId, sourceTrack]
  )

  const classifications = useMemo(
    () => tracks.map((t) => (t.isSource ? null : classifyTrack(t, sourceTrack))),
    [tracks, sourceTrack]
  )

  const displayGroups = useMemo(() => displayGroupsFor(activeTrack), [activeTrack])

  const replaceTracks = useCallback((next: CaptionTrack[], nextActiveId: string) => {
    setTracks(next)
    setActiveTrackId(next.some((t) => t.id === nextActiveId) ? nextActiveId : SOURCE_TRACK_ID)
    setRevisions({})
  }, [])

  const commitTracks = useCallback((next: CaptionTrack[], nextActiveId: string) => {
    setTracks(next)
    setActiveTrackId(next.some((t) => t.id === nextActiveId) ? nextActiveId : SOURCE_TRACK_ID)
  }, [])

  const updateTrack = useCallback(
    (id: string, update: (track: CaptionTrack) => CaptionTrack) => {
      setTracks((prev) => {
        let changed = false
        const next = prev.map((t) => {
          if (t.id !== id) return t
          const updated = update(t)
          if (updated !== t) changed = true
          return updated
        })
        return changed ? next : prev
      })
    },
    []
  )

  const updateAllTracks = useCallback((update: (track: CaptionTrack) => CaptionTrack) => {
    setTracks((prev) => {
      let changed = false
      const next = prev.map((t) => {
        const updated = update(t)
        if (updated !== t) changed = true
        return updated
      })
      return changed ? next : prev
    })
  }, [])

  const commitEditorState = useCallback(
    (trackId: string, state: TrackEditorState) => {
      updateTrack(trackId, (track) =>
        track.segments === state.segments &&
        track.groups === state.groups &&
        track.groupsEdited === state.groupsEdited &&
        track.segmentsEdited === state.segmentsEdited
          ? track
          : { ...track, ...state }
      )
    },
    [updateTrack]
  )

  const bumpRevision = useCallback((id: string) => {
    setRevisions((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }, [])

  return {
    tracks,
    activeTrackId,
    activeTrack,
    sourceTrack,
    classifications,
    displayGroups,
    revisions,
    setActiveTrackId,
    replaceTracks,
    commitTracks,
    updateTrack,
    updateAllTracks,
    commitEditorState,
    bumpRevision,
  }
}
