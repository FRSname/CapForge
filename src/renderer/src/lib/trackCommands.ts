/**
 * The three agent commands that write a caption *track* — `create_track`,
 * `set_track_text`, `reflow_track` — as one pure transition over the store.
 *
 * Every rule they enforce already lives in `lib/tracks.ts` / `lib/trackTiming.ts`;
 * this module is only the command decoding, the validation, and the human
 * message. It exists apart from `AgentLiveSync` for the same reason
 * `agentCommands.ts` does: an agent-driven mutation of the user's project is
 * worth testing without React.
 *
 * **Failures throw** with a message meant for a human (it is toasted *and*
 * echoed to the agent as `agent.lastCommandError`). Nothing is applied on a
 * throw: `set_track_text` validates every group id up front, so a batch with
 * one bad id changes nothing rather than half-landing.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { AgentCommand } from './api'
import { createTrackFromSource, newTrackId, reflowTrack } from './tracks'
import type { CaptionTrack } from './tracks'
import { buildSourceIndex, recordedWids } from './trackStaleness'
import { bakeTranslation } from './trackTiming'
import { isKnownLanguage, languageLabel } from './languages'

/** The ops this module owns. */
export const TRACK_COMMAND_OPS = ['create_track', 'set_track_text', 'reflow_track'] as const
export type TrackCommandOp = (typeof TRACK_COMMAND_OPS)[number]

export function isTrackCommand(op: string): op is TrackCommandOp {
  return (TRACK_COMMAND_OPS as readonly string[]).includes(op)
}

export interface TrackCommandResult {
  tracks: CaptionTrack[]
  activeTrackId: string
  /** Toast copy, in the voice of `lib/agentCommands.ts`'s messages. */
  message: string
  /** A track whose stored state changed underneath a mounted editor, so App
   *  must remount it (the editor owns its own copy while it is up). */
  remountTrackId?: string
}

function str(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function requireTrack(tracks: readonly CaptionTrack[], id: string): CaptionTrack {
  const track = tracks.find((t) => t.id === id)
  if (!track) throw new Error(`No caption track with id "${id}".`)
  return track
}

function requireSource(tracks: readonly CaptionTrack[]): CaptionTrack {
  const source = tracks.find((t) => t.isSource)
  if (!source) throw new Error('No transcript is open.')
  if (source.groups.length === 0) throw new Error('The transcript has no caption groups yet.')
  return source
}

/** `create_track {track_id?, lang, label?, copy_style_from?}` — appends + activates. */
function createTrack(
  tracks: readonly CaptionTrack[],
  cmd: AgentCommand
): TrackCommandResult {
  const source = requireSource(tracks)
  const lang = str(cmd.payload, 'lang').toLowerCase()
  if (!lang) throw new Error('create_track needs a `lang` (an ISO 639-1 code such as "pl").')
  if (!isKnownLanguage(lang)) {
    throw new Error(`"${lang}" is not a language code CapForge knows (use ISO 639-1, e.g. "pl").`)
  }

  const requested = str(cmd.payload, 'track_id')
  if (requested && tracks.some((t) => t.id === requested)) {
    throw new Error(`A caption track with id "${requested}" already exists.`)
  }
  const id = requested || newTrackId()

  // `copy_style_from` defaults to the source (D1: "style the English, then add
  // Polish" inherits what you can see). Passing explicit settings deliberately
  // clears `appliedPreset`, so the source case passes none at all.
  const copyFrom = str(cmd.payload, 'copy_style_from')
  const styleSource =
    copyFrom && copyFrom !== source.id ? requireTrack(tracks, copyFrom) : null

  const label = str(cmd.payload, 'label')
  const track = createTrackFromSource(source, {
    id,
    lang,
    ...(label ? { label } : {}),
    ...(styleSource ? { settings: styleSource.settings } : {}),
  })

  return {
    tracks: [...tracks, track],
    activeTrackId: track.id,
    message: `Agent added a ${languageLabel(lang)} caption track.`,
  }
}

/** `set_track_text {track_id, entries: [{group_id, text}]}` — bake, all or nothing. */
function setTrackText(
  tracks: readonly CaptionTrack[],
  activeTrackId: string,
  cmd: AgentCommand
): TrackCommandResult {
  const source = requireSource(tracks)
  const track = requireTrack(tracks, str(cmd.payload, 'track_id'))
  if (track.isSource) {
    throw new Error(
      'set_track_text writes a translation — the source transcript is edited with update_words.'
    )
  }

  const raw = cmd.payload?.entries
  const entries = (Array.isArray(raw) ? raw : []).map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>
    return {
      groupId: typeof entry.group_id === 'string' ? entry.group_id : '',
      text: typeof entry.text === 'string' ? entry.text : '',
    }
  })
  if (entries.length === 0) throw new Error('set_track_text needs at least one entry.')

  const byId = new Map(track.groups.map((g) => [g.id, g]))
  const unknown = entries.filter((e) => !byId.has(e.groupId)).map((e) => e.groupId || '(missing)')
  if (unknown.length > 0) {
    throw new Error(
      `No group on "${track.label}" with id ${unknown.map((id) => `"${id}"`).join(', ')}.`
    )
  }

  const index = buildSourceIndex(source)
  const allRecorded = recordedWids(track)
  const textById = new Map(entries.map((e) => [e.groupId, e.text]))

  const groups = track.groups.map((group, i) => {
    const text = textById.get(group.id)
    if (text === undefined) return group
    return bakeTranslation(group, text, index, { allRecorded, isFirstGroup: i === 0 })
  })

  // The text view edits the same units by id — keep it in step, or a save (or a
  // tab switch) would resurrect the pre-bake text.
  const bakedById = new Map(groups.map((g) => [g.id, g]))
  const segments = track.segments.map((s) => bakedById.get(s.id) ?? s)

  const next: CaptionTrack = { ...track, groups, segments }
  return {
    tracks: tracks.map((t) => (t.id === track.id ? next : t)),
    activeTrackId,
    message: `Agent wrote ${entries.length} caption${entries.length === 1 ? '' : 's'} on ${track.label}.`,
    remountTrackId: track.id,
  }
}

/** `reflow_track {track_id}` — rebuild the skeleton from the current source. */
function reflow(
  tracks: readonly CaptionTrack[],
  activeTrackId: string,
  cmd: AgentCommand
): TrackCommandResult {
  const source = requireSource(tracks)
  const track = requireTrack(tracks, str(cmd.payload, 'track_id'))
  if (track.isSource) throw new Error('The source transcript cannot be re-flowed from itself.')

  const next = reflowTrack(track, source)
  return {
    tracks: tracks.map((t) => (t.id === track.id ? next : t)),
    activeTrackId,
    message: `Agent re-flowed ${track.label} from the source.`,
    remountTrackId: track.id,
  }
}

/**
 * Apply one track command, returning the whole next store. Throws on anything
 * it cannot do — the caller echoes the message to the agent.
 */
export function applyTrackCommand(
  tracks: readonly CaptionTrack[],
  activeTrackId: string,
  cmd: AgentCommand
): TrackCommandResult {
  switch (cmd.op) {
    case 'create_track':
      return createTrack(tracks, cmd)
    case 'set_track_text':
      return setTrackText(tracks, activeTrackId, cmd)
    case 'reflow_track':
      return reflow(tracks, activeTrackId, cmd)
    default:
      throw new Error(`Unknown track command "${cmd.op}".`)
  }
}

/** The command id an agent minted, for the mirror's confirm-by-poll echo. */
export function commandIdOf(cmd: AgentCommand): string | null {
  const id = str(cmd.payload, 'command_id')
  return id || null
}
