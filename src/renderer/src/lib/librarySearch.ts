/**
 * Library search, the pure half (docs/plans/library-finder.md §3.6). The
 * request is the existing `GET /api/library?q=` (FTS5 over title, description,
 * tags and transcript, with the backend's `LIKE` fallback); the renderer only
 * **intersects** the returned ids with the videos it is already showing, so the
 * collection filter and the sort still apply and a match can never add a video
 * the view hides.
 *
 * Typing is debounced, so requests overlap: `createLatestOnly` tells the hook
 * which response is still wanted, and a stale one is dropped (its failure too).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibraryVideo } from './libraryTypes'

/** Typing settles this long before a search request goes out. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 200

export function normalizeQuery(query: string): string {
  return query.trim()
}

/** True when the field holds something to search for. */
export function isSearching(query: string): boolean {
  return normalizeQuery(query) !== ''
}

/** The ids a search returned. */
export function matchIdsOf(videos: readonly Pick<LibraryVideo, 'id'>[]): ReadonlySet<string> {
  return new Set(videos.map((video) => video.id))
}

/**
 * The videos on screen that matched, in the order the view shows them. `null`
 * (no result has landed yet) hides nothing. Returns a NEW array.
 */
export function matchingVideos(
  videos: readonly LibraryVideo[],
  matchIds: ReadonlySet<string> | null
): LibraryVideo[] {
  if (matchIds === null) return [...videos]
  return videos.filter((video) => matchIds.has(video.id))
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

/** The line shown when nothing on screen matched. */
export function noMatchMessage(query: string, inCollection: boolean): string {
  const quoted = `“${normalizeQuery(query)}”`
  return inCollection
    ? `No videos in this collection match ${quoted}.`
    : `No videos match ${quoted}.`
}

export function searchFailedMessage(query: string, reason: string): string {
  return `Could not search the library for “${normalizeQuery(query)}”: ${reason}`
}
