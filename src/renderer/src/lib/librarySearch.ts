/**
 * Library search, the pure half (docs/plans/library-finder.md §3.6). The
 * request is the existing `GET /api/library?q=` (FTS5 prefix terms over the
 * title plus the file's stem words, description, tags and transcript, with the
 * backend's folded substring fallback). A video matches when the backend
 * returned its id **or** the query is a case- and diacritic-insensitive
 * substring of the name its card shows (`displayTitle`), checked locally and
 * instantly — so the visible name matches while the request is in flight, and
 * on a backend that does not index file names. That union is then
 * **intersected** with the videos in the search scope (the folder with its
 * subfolders, or every video — `libraryLocation.ts`), so the sort still applies
 * and a match can never add a video the scope leaves out.
 *
 * Typing is debounced, so requests overlap: `createLatestOnly` tells the hook
 * which response is still wanted, and a stale one is dropped (its failure too).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibraryVideo } from './libraryTypes'
import { displayTitle } from './libraryView'

/** Typing settles this long before a search request goes out. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 200

export function normalizeQuery(query: string): string {
  return query.trim()
}

/** True when the field holds something to search for. */
export function isSearching(query: string): boolean {
  return normalizeQuery(query) !== ''
}

const COMBINING_MARKS = /\p{M}/gu
/** Whitespace, `-`, `_` and `.` — a file stem's word breaks — read as one space. */
const SEPARATOR_RUN = /[\s_.-]+/g

/**
 * The form both sides of the local match are compared in: diacritics stripped
 * (NFD, combining marks dropped), lower case, separators as single spaces.
 * `Sázení_stromků` → `sazeni stromku`. Letters Unicode does not decompose
 * (`ł`, `ø`) are kept as they are.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(SEPARATOR_RUN, ' ')
    .trim()
}

/** The videos whose shown name contains the query, compared folded. Empty when nothing is left to match. */
export function localMatchIds(
  videos: readonly Pick<LibraryVideo, 'id' | 'title' | 'sourcePath'>[],
  query: string
): Set<string> {
  const needle = foldForSearch(query)
  if (!needle) return new Set()
  return new Set(
    videos.filter((video) => foldForSearch(displayTitle(video)).includes(needle)).map((v) => v.id)
  )
}

/**
 * What a search matched: the local name matches plus the backend's ids. While
 * no backend answer has landed (`null`) that is the local matches alone.
 * Returns a NEW set.
 */
export function unionMatchIds(
  local: ReadonlySet<string>,
  backend: ReadonlySet<string> | null
): Set<string> {
  return new Set([...local, ...(backend ?? [])])
}

/** The ids a search returned. */
export function matchIdsOf(videos: readonly Pick<LibraryVideo, 'id'>[]): ReadonlySet<string> {
  return new Set(videos.map((video) => video.id))
}

/** The videos on screen that matched, in the order the view shows them. Returns a NEW array. */
export function matchingVideos(
  videos: readonly LibraryVideo[],
  matchIds: ReadonlySet<string>
): LibraryVideo[] {
  return videos.filter((video) => matchIds.has(video.id))
}

/**
 * The videos a search shows: those whose name matches `query` locally, plus
 * the backend's `backendIds` (null while none has landed), in view order.
 */
export function searchResults(
  videos: readonly LibraryVideo[],
  query: string,
  backendIds: ReadonlySet<string> | null
): LibraryVideo[] {
  return matchingVideos(videos, unionMatchIds(localMatchIds(videos, query), backendIds))
}

export interface LatestOnly {
  /** A request is starting: its ticket. Every earlier ticket goes stale. */
  begin: () => number
  /** Nothing in flight is wanted any more (the field was cleared). */
  invalidate: () => void
  /** True when `ticket` is the most recent request's. */
  isLatest: (ticket: number) => boolean
}

/** One sequencer per search field: only the newest request's answer counts. */
export function createLatestOnly(): LatestOnly {
  let latest = 0
  return {
    begin: () => {
      latest += 1
      return latest
    },
    invalidate: () => {
      latest += 1
    },
    isLatest: (ticket) => ticket === latest,
  }
}

/** The line shown when nothing in the search scope matched. */
export function noMatchMessage(query: string, inFolder: boolean): string {
  const quoted = `“${normalizeQuery(query)}”`
  return inFolder ? `No videos in this folder match ${quoted}.` : `No videos match ${quoted}.`
}

export function searchFailedMessage(query: string, reason: string): string {
  return `Could not search the library for “${normalizeQuery(query)}”: ${reason}`
}
