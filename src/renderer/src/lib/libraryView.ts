/**
 * What a library card *shows* — every derivation the library screen needs,
 * kept pure so it can be tested without a DOM (the vitest environment is plain
 * node; components only render to static markup).
 *
 * Nothing here fetches, stores or decides policy: the status ladder comes from
 * the backend (`derive_status`), and this module only maps it onto the four
 * pips the rail draws.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { CollectionSummary } from './collectionTypes'
import { frameAssetPath } from './framesApi'
import type { LibraryStatus, LibraryVideo } from './libraryTypes'

/**
 * Media extensions CapForge accepts — the renderer's single list, shared by the
 * drop zone (`components/screens/DropZoneScreen.tsx`) and the library's
 * drop-anywhere handler. One of three copies (backend `media_scan.py`,
 * Electron `single-instance.js`), all pinned to
 * `backend/tests/fixtures/media_extensions.json` — change one, change all.
 */
export const MEDIA_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'flac',
  'aac',
  'ogg',
  'mp4',
  'mkv',
  'webm',
  'mov',
] as const

/** Shown for a record whose duration the backend has not probed yet. */
export const DURATION_PLACEHOLDER = '--:--'

/** Shown in place of a title for a record whose path is empty too. */
export const UNTITLED = 'Untitled'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
/** Two digits, zero-padded — `m:ss` and `h:mm:ss` both need it. */
const PAD = 2

/** The file name of a path, without its extension (`/a/b/Talk.mp4` → `Talk`). */
export function fileStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** The card's heading: the authored title, else the source file's stem. */
export function displayTitle(video: Pick<LibraryVideo, 'title' | 'sourcePath'>): string {
  const title = video.title.trim()
  if (title) return title
  return fileStem(video.sourcePath).trim() || UNTITLED
}

/** `m:ss` under an hour, `h:mm:ss` above it. Null/negative → the placeholder. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return DURATION_PLACEHOLDER
  }
  const total = Math.round(seconds)
  const secs = total % SECONDS_PER_MINUTE
  const mins = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const ss = String(secs).padStart(PAD, '0')
  if (hours === 0) return `${mins}:${ss}`
  return `${hours}:${String(mins).padStart(PAD, '0')}:${ss}`
}

/** ISO → a short local date ("Sep 1"); empty when the backend sent nothing usable. */
export function formatShortDate(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/**
 * The channels a video is published on, by name, in the record's order. A
 * channel Settings no longer has, or any channel before the list has loaded,
 * shows its id. Empty when it is published nowhere.
 */
export function publishedOnLabel(
  channelIds: readonly string[] | undefined,
  channels: ReadonlyArray<{ id: string; name: string }> | null
): string {
  if (!channelIds || channelIds.length === 0) return ''
  const names = new Map((channels ?? []).map((channel) => [channel.id, channel.name]))
  return channelIds.map((id) => names.get(id) ?? id).join(', ')
}

/** The four pips of the status rail, in ladder order. */
export interface StatusPips {
  transcribed: boolean
  captioned: boolean
  drafted: boolean
  published: boolean
}

/** How far up the ladder each status sits; `imported` lights nothing. */
const LADDER: readonly LibraryStatus[] = ['transcribed', 'captioned', 'drafted', 'published']

/**
 * Cumulative: a `drafted` record has been transcribed and captioned too, so its
 * first three pips are lit. An unknown status lights nothing rather than
 * guessing.
 */
export function statusPips(status: LibraryStatus): StatusPips {
  const reached = LADDER.indexOf(status)
  return {
    transcribed: reached >= LADDER.indexOf('transcribed'),
    captioned: reached >= LADDER.indexOf('captioned'),
    drafted: reached >= LADDER.indexOf('drafted'),
    published: reached >= LADDER.indexOf('published'),
  }
}

/** Comparable time of a record — `updatedAt`, falling back to `createdAt`. */
function updatedTime(video: LibraryVideo): number {
  const parsed = Date.parse(video.updatedAt || video.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Newest first. Returns a NEW array — the fetched list is never mutated. */
export function sortByUpdated(videos: readonly LibraryVideo[]): LibraryVideo[] {
  return [...videos].sort((a, b) => updatedTime(b) - updatedTime(a))
}

/**
 * The "Continue" hero: the most recently touched record that actually has a
 * session to resume. A library of freshly imported files has none.
 */
export function continueCandidate(videos: readonly LibraryVideo[]): LibraryVideo | null {
  return sortByUpdated(videos).find((v) => v.hasProject && !v.missing_media) ?? null
}

// ── Posters ─────────────────────────────────────────────────────────────────

/** The poster the backend grabs at import. */
export const POSTER_ASSET = 'poster.jpg'

/**
 * The asset path a card draws (`GET /api/library/{id}/asset/{path}`): the cover
 * chosen in Publish when there is one, else the import poster when it exists,
 * else null — no picture, and no request.
 */
export function cardImageAsset(video: Pick<LibraryVideo, 'poster' | 'cover'>): string | null {
  if (video.cover) return frameAssetPath(video.cover)
  return video.poster ? POSTER_ASSET : null
}

/** A poster box's ratio (width / height) while the frame's size is unknown. */
export const POSTER_ASPECT_FALLBACK = 16 / 9
/** The tallest box a poster gets — a 9:21 frame; anything taller is cropped. */
export const POSTER_ASPECT_MIN = 9 / 21
/** The widest box a poster gets — a 21:9 frame; anything wider is cropped. */
export const POSTER_ASPECT_MAX = 21 / 9

/**
 * The ratio of a loaded poster (`naturalWidth` / `naturalHeight`), clamped to
 * the sane range; null when the size is unusable (an image that has not
 * decoded reports 0×0). The poster JPEG is the video's frame scaled with its
 * ratio kept, so this is the video's ratio.
 */
export function posterAspect(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return Math.min(POSTER_ASPECT_MAX, Math.max(POSTER_ASPECT_MIN, width / height))
}

/**
 * The width of a fixed-height poster box (the Continue hero): the ratio's
 * width, rounded to a whole pixel and held to `maxWidthPx` so a wide video
 * does not push the text out of the row.
 */
export function posterBoxWidth(
  aspect: number | null,
  heightPx: number,
  maxWidthPx: number
): number {
  return Math.min(Math.round(heightPx * (aspect ?? POSTER_ASPECT_FALLBACK)), maxWidthPx)
}

/** True when a dropped path looks like media CapForge can transcribe. */
export function isMediaPath(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return (MEDIA_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * The library's collection filter, as the `<select>` value it is: a collection
 * id, or one of two sentinels. Both start with `:`, which `COLLECTION_ID_RE`
 * (`^[a-z0-9]…`) can never match, so a sentinel is never mistaken for an id.
 */
export type CollectionFilter = string

export const ALL_COLLECTIONS: CollectionFilter = ':all'
export const NO_COLLECTION: CollectionFilter = ':none'

/** Client-side over the loaded list. Returns a NEW array. */
export function filterByCollection(
  videos: readonly LibraryVideo[],
  filter: CollectionFilter
): LibraryVideo[] {
  if (filter === ALL_COLLECTIONS) return [...videos]
  if (filter === NO_COLLECTION) return videos.filter((v) => v.collection_id === null)
  return videos.filter((v) => v.collection_id === filter)
}

export interface CollectionFilterOption {
  value: CollectionFilter
  label: string
}

/**
 * All, each collection by name, then any id a record carries that names no
 * collection (an orphan, shown by its id), then No collection.
 */
export function collectionFilterOptions(
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  videos: readonly LibraryVideo[]
): CollectionFilterOption[] {
  const known = new Set(collections.map((c) => c.id))
  const orphanIds = [
    ...new Set(videos.map((v) => v.collection_id).filter((id): id is string => id !== null)),
  ].filter((id) => !known.has(id))
  return [
    { value: ALL_COLLECTIONS, label: 'All videos' },
    ...collections.map((c) => ({ value: c.id, label: c.name })),
    ...orphanIds.map((id) => ({ value: id, label: id })),
    { value: NO_COLLECTION, label: 'No collection' },
  ]
}
