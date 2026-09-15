/**
 * REST client for a record's thumbnail frames (docs/plans/publish-editors.md,
 * Part A): `POST /api/library/{id}/frames` grabs, `POST …/frames/upload`
 * stores an image the user chose (and makes it the cover), `DELETE
 * …/frames/{name}` removes. These three routes are the **only** writers of
 * `thumbnail.candidates`; each bumps the record's `rev` and fires
 * `record_updated`, which is how the Publish panel picks the change up.
 *
 * A sibling of `api.ts` (past its size ceiling) — the `libraryApi.ts`
 * pattern: every call goes through `api.sendWithLocalToken`, so the bridge
 * and the local token are handled in exactly one place. The frame images are
 * read through `getLibraryAsset` (`lib/libraryApi.ts`).
 */

import { api } from './api'
import { FRAME_NAME_RE } from './libraryTypes'
import { num, obj, rows, str } from './wireReaders'

/** A frame the backend wrote: its file name under `thumbnails/`. */
export interface GrabbedFrame {
  time_s: number
  name: string
}

/** A time the backend could not grab, with its sentence. */
export interface FailedFrame {
  time_s: number
  reason: string
}

export interface FramesResult {
  frames: GrabbedFrame[]
  failed: FailedFrame[]
  /** The record's revision after the append. */
  rev: number
}

export const FRAMES_SHAPE_MESSAGE =
  'The frame grab came back in an unexpected shape — the backend may be out of date.'

const THUMBNAILS_DIR = 'thumbnails'

/** The asset-route path of a frame (`GET /api/library/{id}/asset/{path}`). */
export function frameAssetPath(name: string): string {
  return `${THUMBNAILS_DIR}/${name}`
}

function framesPath(id: string): string {
  return `/api/library/${encodeURIComponent(id)}/frames`
}

function hasFiniteTime(row: Record<string, unknown>): boolean {
  return typeof row.time_s === 'number' && Number.isFinite(row.time_s)
}

/** The grab's answer. Unusable rows are dropped; a body with no `rev` throws. */
export function parseFramesResult(value: unknown): FramesResult {
  const body = obj(value)
  if (!body || typeof body.rev !== 'number' || !Number.isFinite(body.rev)) {
    throw new Error(FRAMES_SHAPE_MESSAGE)
  }
  const frames = rows(body.frames, (row) => row)
    .filter((row) => hasFiniteTime(row) && typeof row.name === 'string' && row.name !== '')
    .map((row) => ({ time_s: num(row.time_s), name: str(row.name) }))
  const failed = rows(body.failed, (row) => row)
    .filter(hasFiniteTime)
    .map((row) => ({ time_s: num(row.time_s), reason: str(row.reason) }))
  return { frames, failed, rev: body.rev }
}

/** A refused response's body; a body that is not JSON falls back to the status text. */
function refusedBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({ detail: res.statusText }))
}

async function requestJson(method: 'POST' | 'DELETE', path: string, body?: unknown) {
  const res = await api.sendWithLocalToken(method, path, body)
  if (res.ok) return res.json() as Promise<unknown>
  throw api.apiError(res, await refusedBody(res))
}

/** Grab a frame at each time (1–8 per call). A 422's sentence is the error message. */
export async function grabFrames(id: string, times: readonly number[]): Promise<FramesResult> {
  return parseFramesResult(await requestJson('POST', framesPath(id), { times: [...times] }))
}

/** An uploaded image, stored as a frame and made the cover. */
export interface UploadedFrame {
  name: string
  /** The record's revision after the append. */
  rev: number
}

/** The upload's answer. Throws unless it names a frame and carries a rev. */
export function parseUploadedFrame(value: unknown): UploadedFrame {
  const body = obj(value)
  const name = obj(body?.frame)?.name
  if (!body || typeof body.rev !== 'number' || !Number.isFinite(body.rev)) {
    throw new Error(FRAMES_SHAPE_MESSAGE)
  }
  if (typeof name !== 'string' || !FRAME_NAME_RE.test(name)) throw new Error(FRAMES_SHAPE_MESSAGE)
  return { name, rev: body.rev }
}

/** Upload an image (JPEG, PNG or WEBP) as a frame and the cover. A 422's sentence is the error message. */
export async function uploadFrame(id: string, image: Blob): Promise<UploadedFrame> {
  return parseUploadedFrame(await requestJson('POST', `${framesPath(id)}/upload`, image))
}

/** Delete one frame (clearing the cover if it was the cover). Answers the new rev. */
export async function deleteFrame(id: string, name: string): Promise<number> {
  const body = obj(await requestJson('DELETE', `${framesPath(id)}/${encodeURIComponent(name)}`))
  if (!body || typeof body.rev !== 'number') throw new Error(FRAMES_SHAPE_MESSAGE)
  return body.rev
}
