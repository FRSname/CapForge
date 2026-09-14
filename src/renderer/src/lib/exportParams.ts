/**
 * The `POST /api/export` request body — built in one place because two panels
 * send it: the StudioPanel's Export card and the Publish footer's per-track
 * SRT/VTT buttons.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'

/**
 * The active caption track when it is a *translated* one — sent alongside an
 * export so the exporter writes that track's lines instead of the source
 * transcript, and names the file after its language. Null on the source track,
 * where the request body is exactly what it always was.
 */
export interface ExportTrack {
  id: string
  lang: string
  /** The track's display groups (gaps closed) — one cue each. */
  segments: Segment[]
}

/**
 * Backend rejects empty output_dir; only include the field when set.
 *
 * `track` rides along only for a translated caption track. Today's backend has
 * no field for it and Pydantic's default `extra='ignore'` drops it, so a source
 * export sends byte-identical params to what it always did.
 */
export function buildExportParams(
  formats: string[],
  outputDir: string,
  track: ExportTrack | null
): Record<string, unknown> {
  const base = outputDir ? { formats, output_dir: outputDir } : { formats }
  return track ? { ...base, track } : base
}
