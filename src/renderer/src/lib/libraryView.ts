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

/** True when a dropped path looks like media CapForge can transcribe. */
export function isMediaPath(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return (MEDIA_EXTENSIONS as readonly string[]).includes(ext)
}
