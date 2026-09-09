/**
 * The `PUT /api/ui-state` body — the one thing the MCP agent reads.
 *
 * Composed here rather than inline in `App.tsx` for two reasons. It is the
 * seam the backend and the MCP tools are written against (plan §E), so its
 * shape is worth pinning with a test; and it is built in **two halves** by two
 * effects with very different costs — the seven legacy keys churn on every
 * settings keystroke, while the per-track inventory (a `buildRenderBody` and a
 * classification per track) only changes when a track does. Each half writes
 * into a ref and the pusher sends the merge, so neither can blank the other.
 *
 * The seven legacy keys keep describing the **active** track, unchanged, so
 * every existing agent prompt still works; `activeTrackId`, `agent` and
 * `tracks` are additive.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { buildRenderBody, type RenderBody } from './render'
import { trackToMirrorEntry } from './tracks'
import type { CaptionTrack, TrackMirrorEntry } from './tracks'
import type { TrackClassification } from './trackStaleness'

/** How the last agent write command ended, for confirm-by-poll. */
export type AgentCommandStatus = 'ok' | 'error'

export interface AgentCommandEcho {
  /** The `command_id` the tool minted, echoed back so it can match its own call. */
  lastCommandId: string | null
  lastCommandStatus: AgentCommandStatus | null
  lastCommandError: string | null
}

/** Nothing has been commanded this session. */
export const IDLE_AGENT_ECHO: AgentCommandEcho = {
  lastCommandId: null,
  lastCommandStatus: null,
  lastCommandError: null,
}

/** The source track is never classified against itself — it is the reference. */
export const EMPTY_CLASSIFICATION: TrackClassification = {
  byGroup: new Map(),
  staleCount: 0,
  untranslatedCount: 0,
  reflowNeeded: false,
}

/**
 * The output filename suffix for a track: `.pl` gives `video.pl.mp4`. Empty on
 * the source, which is what keeps a single-track project's render body
 * byte-identical to what it always was.
 */
export function nameSuffixFor(track: CaptionTrack): string {
  return track.isSource ? '' : `.${track.lang}`
}

/**
 * `groupsEdited` as the render payload means it: a segments-only edit also has
 * to ship `custom_groups`, or the backend re-chunks the transcript and the
 * user's edit is invisible in the output. This is the flag `ResultsScreen` used
 * to publish; the store keeps the two halves apart because the reconcile pass
 * needs the boundary flag alone.
 */
export function renderEditedFlag(track: CaptionTrack): boolean {
  return track.groupsEdited || track.segmentsEdited
}

/** The seven legacy keys + the two additive scalars. */
export interface UiStateCore {
  screen: string
  settings: StudioSettings
  groups: Segment[]
  presets: string[]
  presetsDetail: { builtin: string[]; user: string[] }
  appliedPreset: string | null
  render: RenderBody
  activeTrackId: string
  agent: AgentCommandEcho
}

export interface UiStateBody extends UiStateCore {
  tracks: TrackMirrorEntry[]
}

export interface UiStateCoreInput {
  screen: string
  activeTrack: CaptionTrack
  /** `displayGroupsFor(activeTrack)` — passed in so App's memo is reused. */
  activeDisplayGroups: Segment[]
  builtinPresets: string[]
  userPresetNames: string[]
  agent: AgentCommandEcho
}

export function buildUiStateCore(input: UiStateCoreInput): UiStateCore {
  const { activeTrack, activeDisplayGroups } = input
  return {
    screen: input.screen,
    settings: activeTrack.settings,
    groups: activeDisplayGroups,
    // Kept for back-compat: existing agent prompts read `presets`.
    presets: input.builtinPresets,
    presetsDetail: { builtin: input.builtinPresets, user: input.userPresetNames },
    appliedPreset: activeTrack.appliedPreset,
    render: buildRenderBody(
      activeTrack.settings,
      activeDisplayGroups,
      renderEditedFlag(activeTrack),
      {},
      undefined,
      nameSuffixFor(activeTrack)
    ),
    activeTrackId: activeTrack.id,
    agent: input.agent,
  }
}

/**
 * The per-track inventory. `classifications` is positional against `tracks`
 * (null for the source), exactly as App memoizes it.
 */
export function buildTrackEntries(
  tracks: readonly CaptionTrack[],
  source: CaptionTrack,
  classifications: ReadonlyArray<TrackClassification | null>
): TrackMirrorEntry[] {
  return tracks.map((track, i) =>
    trackToMirrorEntry(track, source, classifications[i] ?? EMPTY_CLASSIFICATION)
  )
}

export function mergeUiStateBody(core: UiStateCore, tracks: TrackMirrorEntry[]): UiStateBody {
  return { ...core, tracks }
}

/**
 * Whole body in one call — the resync-after-reconnect path, where there is no
 * two-effect split to honour because everything is re-pushed at once.
 */
export function buildUiStateBody(
  input: UiStateCoreInput & {
    tracks: readonly CaptionTrack[]
    sourceTrack: CaptionTrack
    classifications: ReadonlyArray<TrackClassification | null>
  }
): UiStateBody {
  return mergeUiStateBody(
    buildUiStateCore(input),
    buildTrackEntries(input.tracks, input.sourceTrack, input.classifications)
  )
}
