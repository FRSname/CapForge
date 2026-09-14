/**
 * `open_video` — the pure half of "the agent opened a library record".
 *
 * The renderer is still the owner of what is open: the backend only knows
 * which record the agent *named*, and answers with the v2 project JSON it
 * stored. Installing it goes through `planProjectRestore` (`lib/projectRestore.ts`),
 * exactly as opening the file from disk does, so `open_video` and a project
 * open can never install two different track stores.
 *
 * Everything here is a refusal rule or a message; the React half
 * (`hooks/useLibrarySession.ts`) only holds the `activeVideoId` state and wires
 * the I/O in. Failures **throw** with a human-readable message, which
 * `AgentLiveSync` toasts *and* echoes to the agent rather than swallowing.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { AgentCommand } from './api'
import { OPEN_VIDEO_OP, isTrackCommand } from './trackCommands'

/**
 * A transcription owns the whole session (it replaces the store when it
 * finishes), so opening a record on top of one would be silently undone.
 */
export const OPEN_VIDEO_BUSY_MESSAGE =
  'CapForge is transcribing — open_video is refused until the job finishes.'

/** The command carries the record to open in `record_id`. */
export const OPEN_VIDEO_NO_ID_MESSAGE = 'open_video needs a library `record_id`.'

/** The screen on which a transcription job is running. */
const PROGRESS_SCREEN = 'progress'

/** The stored snapshot exists but `planProjectRestore` rejected it. */
export function rejectedProjectMessage(videoId: string): string {
  return `The stored project for ${videoId} could not be restored — it was rejected by the project-file check.`
}

/** Toast copy, in the voice of `lib/agentCommands.ts`'s messages. */
export function openedVideoMessage(videoId: string): string {
  return `Agent opened a library video (${videoId}).`
}

export interface OpenVideoInput {
  /** `record_id` from the command payload. */
  videoId: string
  /** The screen the app is on — `progress` is the one refusal. */
  screen: string
  /** `api.getLibraryProject` — throws the backend's 404/409 message as-is. */
  getProject: (id: string) => Promise<unknown>
  /**
   * `App`'s `restoreFromProjectFile`: resolves true when the store was
   * replaced, false when the plan was rejected (it reports its own reason to
   * the user, but the agent would otherwise see a bare success).
   */
  restore: (raw: unknown) => Promise<boolean>
}

/**
 * Fetch a record's stored project and install it, returning the toast copy.
 * Throws on every refusal — nothing is touched before `restore` runs, so a
 * missing record leaves the session exactly as it was.
 */
export async function openVideoFromLibrary(input: OpenVideoInput): Promise<string> {
  const { screen, getProject, restore } = input
  if (screen === PROGRESS_SCREEN) throw new Error(OPEN_VIDEO_BUSY_MESSAGE)

  const videoId = input.videoId.trim()
  if (!videoId) throw new Error(OPEN_VIDEO_NO_ID_MESSAGE)

  const raw = await getProject(videoId)
  const installed = await restore(raw)
  if (!installed) throw new Error(rejectedProjectMessage(videoId))
  return openedVideoMessage(videoId)
}

export interface EchoedCommandInput {
  cmd: AgentCommand
  /** The synchronous track-write transition (`lib/trackCommands.ts`). */
  applyTrackCommand: (cmd: AgentCommand) => string
  /** `openVideoFromLibrary` with its I/O bound. */
  openVideo: (videoId: string) => Promise<string>
}

/**
 * Dispatch one polled command — a track write or `open_video` — to its
 * applier. The set is `ECHOED_COMMAND_OPS`, so anything else reaching here is
 * a dispatch bug rather than a user-visible refusal; it throws, and the throw
 * is echoed like any other failure instead of being swallowed.
 */
export async function applyEchoedCommandWith({
  cmd,
  applyTrackCommand,
  openVideo,
}: EchoedCommandInput): Promise<string> {
  if (isTrackCommand(cmd.op)) return applyTrackCommand(cmd)
  if (cmd.op === OPEN_VIDEO_OP) return openVideo(String(cmd.payload?.record_id ?? ''))
  throw new Error(`Unknown echoed command "${cmd.op}".`)
}
