/**
 * The v3 library wire types — and the boundary check that turns an untyped
 * `GET /api/library` body into them.
 *
 * The backend owns the records; the renderer only ever *reads* this shape, so
 * it is validated here once (a small hand-written guard — Zod is not a
 * dependency of the renderer) rather than trusted field by field in the UI. A
 * malformed payload **throws** with a message a user can act on; nothing is
 * silently dropped.
 *
 * Pure module: no React, no `window`, no I/O.
 */

/** The status ladder (`backend/library/schemas.py`, derived at read time). */
export type LibraryStatus = 'imported' | 'transcribed' | 'captioned' | 'drafted' | 'published'

export const LIBRARY_STATUSES: readonly LibraryStatus[] = [
  'imported',
  'transcribed',
  'captioned',
  'drafted',
  'published',
]

/**
 * One list row (`SUMMARY_FIELDS` + the derived `hasProject`). Deliberately
 * small: a card needs no dossier body.
 */
export interface LibraryVideo {
  id: string
  title: string
  sourcePath: string
  duration: number | null
  language: string | null
  status: LibraryStatus
  collection_id: string | null
  scratch: boolean
  createdAt: string
  updatedAt: string
  /** The source media file is gone from disk. */
  missing_media: boolean
  /** A session snapshot has been stored for this record (`project.capforge`). */
  hasProject: boolean
  /** A poster frame was grabbed at import (`asset/poster.jpg`); false shows the placeholder. */
  poster: boolean
}

/**
 * The record view (`POST /api/library`, `GET /api/library/{id}`) — the whole
 * dossier. The renderer only needs the summary half plus `rev`, which the
 * autosave fallback stamps onto its local copy.
 */
export interface LibraryRecord extends LibraryVideo {
  rev: number
}

/** The envelope was not `{videos: [...]}`. */
export const LIBRARY_LIST_SHAPE_MESSAGE =
  'The library list came back in an unexpected shape — the backend may be out of date.'

/** One row was unusable. Names the index so a bad record can be found. */
export function libraryRowMessage(index: number, reason: string): string {
  return `Library entry ${index} is unusable (${reason}).`
}

function asRecordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function isStatus(value: unknown): value is LibraryStatus {
  return typeof value === 'string' && (LIBRARY_STATUSES as readonly string[]).includes(value)
}

/**
 * Validate one list row. `id`, `sourcePath` and `status` are required — they
 * are what every action on a card is addressed by, and a row missing one could
 * only ever misfire. Everything else is optional with a defined default, so a
 * backend that has not yet grown a derived field (e.g. `hasProject`) degrades
 * to "no project" instead of blanking the whole screen.
 */
export function parseLibraryVideo(value: unknown, index: number): LibraryVideo {
  const row = asRecordObject(value)
  if (!row) throw new Error(libraryRowMessage(index, 'not an object'))

  const id = str(row.id).trim()
  if (!id) throw new Error(libraryRowMessage(index, 'no id'))
  if (typeof row.sourcePath !== 'string') {
    throw new Error(libraryRowMessage(index, 'no sourcePath'))
  }
  if (!isStatus(row.status)) {
    throw new Error(libraryRowMessage(index, `unknown status ${String(row.status)}`))
  }

  return {
    id,
    title: str(row.title),
    sourcePath: row.sourcePath,
    duration: nullableNumber(row.duration),
    language: nullableString(row.language),
    status: row.status,
    collection_id: nullableString(row.collection_id),
    scratch: row.scratch === true,
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    missing_media: row.missing_media === true,
    hasProject: row.hasProject === true,
    poster: row.poster === true,
  }
}

/** `GET /api/library` → the rows, validated. Throws on a malformed envelope. */
export function parseLibraryList(value: unknown): LibraryVideo[] {
  const body = asRecordObject(value)
  if (!body || !Array.isArray(body.videos)) throw new Error(LIBRARY_LIST_SHAPE_MESSAGE)
  return body.videos.map((row, i) => parseLibraryVideo(row, i))
}

/**
 * `POST /api/library` / `POST /api/library/import-project` → the record view.
 * `rev` defaults to the backend's first revision when absent.
 */
export const FIRST_REV = 1

export function parseLibraryRecord(value: unknown): LibraryRecord {
  const video = parseLibraryVideo(value, 0)
  const row = asRecordObject(value)
  const rev = nullableNumber(row?.rev)
  return { ...video, rev: rev ?? FIRST_REV }
}
