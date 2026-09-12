/**
 * The pure half of "open a project": everything `App`'s restore callback does
 * *before* it touches React state.
 *
 * Split out because a record can be opened from more than one place — a library
 * card in the hub and the agent's `open_video` must produce the **same** track
 * store (creator-hub vision §2.3) — and a plan that is a plain function can be
 * tested as such, without a renderer.
 *
 * `migrateProjectFile` stays the ONE trust boundary: it is called here, never
 * duplicated, and its typed errors are re-thrown for the caller to report.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { TranscriptionResult as BackendTranscript } from './api'
import { migrateProjectFile, tracksFromProjectFile } from './project'
import type { ProjectFile } from './project'
import type { CaptionTrack } from './tracks'

export interface ProjectRestorePlan {
  /** The validated, version-lifted file. */
  file: ProjectFile
  /** The track store to install, already merged over defaults + sanitized. */
  tracks: CaptionTrack[]
  activeTrackId: string
  /**
   * Body for `api.updateResult` — the snake_case transcript the backend needs
   * before any render/export work.
   */
  backendResult: BackendTranscript
}

/**
 * Validate and lift a raw `.capforge` payload, then derive everything the
 * caller needs to install it. Nothing is touched until this returns, so a file
 * from a newer build (or a damaged one) leaves the session exactly as it was.
 *
 * Rethrows `migrateProjectFile`'s `ProjectFileError` / `ProjectVersionError`.
 */
export function planProjectRestore(raw: unknown): ProjectRestorePlan {
  const file = migrateProjectFile(raw)
  const restored = tracksFromProjectFile(file)
  const tr = file.transcriptionResult

  return {
    file,
    tracks: restored.tracks,
    activeTrackId: restored.activeTrackId,
    backendResult: {
      segments: tr.segments as never,
      language: tr.language,
      duration: tr.duration,
      audio_path: tr.audioPath,
      alignment_degraded: Boolean(tr.alignmentDegraded),
    },
  }
}

/** What to show when the file could not be opened at all. */
export function restoreErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'This project file could not be opened.'
}

/**
 * What to show when the project opened but the backend did not take the
 * transcript. Never swallowed: without it the backend cannot render or export,
 * and every later failure looks unrelated.
 */
export function backendUpdateFailedMessage(err: unknown): string {
  return `Project loaded, but the backend could not be updated: ${
    err instanceof Error ? err.message : String(err)
  }. Rendering may fail.`
}
