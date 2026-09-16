/**
 * How the library orders its videos (docs/plans/library-finder.md §3.5) — the
 * sort menu, the list view's column headers and the grid all go through
 * `sortVideos`.
 *
 * Rules worth knowing:
 *   - a **missing** value (an unprobed duration, an unparseable date) sorts
 *     last in *both* directions, so reversing a column never floods the top of
 *     the list with blanks;
 *   - `name` compares the title a card shows (`displayTitle`), locale-aware and
 *     numeric, so "Take 2" comes before "Take 10";
 *   - `status` follows the derived ladder (`LIBRARY_STATUSES`), not the alphabet;
 *   - ties keep the order they arrived in (`Array.prototype.sort` is stable).
 *
 * The Continue hero is not chosen here: `continueCandidate` keeps its own
 * newest-first rule whatever the list is sorted by.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibraryVideo } from './libraryTypes'
import { LIBRARY_STATUSES } from './libraryTypes'
import { displayTitle } from './libraryView'

export type LibrarySortKey = 'modified' | 'name' | 'duration' | 'status' | 'created'
export type SortDirection = 'asc' | 'desc'

export interface LibrarySort {
  key: LibrarySortKey
  direction: SortDirection
}

export const LIBRARY_SORT_KEYS: readonly LibrarySortKey[] = [
  'modified',
  'name',
  'duration',
  'status',
  'created',
]

export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc']

/** What the sort menu calls each key. */
export const SORT_KEY_LABELS: { readonly [K in LibrarySortKey]: string } = {
  modified: 'Date modified',
  name: 'Name',
  duration: 'Duration',
  status: 'Status',
  created: 'Date added',
}

/** Newest first — the order the grid had before sorting existed. */
export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: 'modified', direction: 'desc' }

/** Where a key starts when it is picked: dates and lengths biggest first, the rest from the start. */
const NATURAL_DIRECTION: { readonly [K in LibrarySortKey]: SortDirection } = {
  modified: 'desc',
  name: 'asc',
  duration: 'desc',
  status: 'asc',
  created: 'desc',
}

export function isLibrarySortKey(value: unknown): value is LibrarySortKey {
  return typeof value === 'string' && (LIBRARY_SORT_KEYS as readonly string[]).includes(value)
}

export function isSortDirection(value: unknown): value is SortDirection {
  return typeof value === 'string' && (SORT_DIRECTIONS as readonly string[]).includes(value)
}

export function defaultSortDirection(key: LibrarySortKey): SortDirection {
  return NATURAL_DIRECTION[key]
}

/** A column header click: the active column reverses, another starts in its natural direction. */
export function toggledSort(current: LibrarySort, key: LibrarySortKey): LibrarySort {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: defaultSortDirection(key) }
}

type SortValue = number | string | null

function timeOf(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

function sortValue(video: LibraryVideo, key: LibrarySortKey): SortValue {
  switch (key) {
    case 'modified':
      return timeOf(video.updatedAt || video.createdAt)
    case 'created':
      return timeOf(video.createdAt)
    case 'duration':
      return typeof video.duration === 'number' && Number.isFinite(video.duration)
        ? video.duration
        : null
    case 'status':
      return LIBRARY_STATUSES.indexOf(video.status)
    case 'name':
      return displayTitle(video)
  }
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'string' && typeof b === 'string') return NAME_COLLATOR.compare(a, b)
  return (a as number) - (b as number)
}

/** The videos in `sort` order. Returns a NEW array — the fetched list is never mutated. */
export function sortVideos(videos: readonly LibraryVideo[], sort: LibrarySort): LibraryVideo[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return videos
    .map((video) => ({ video, value: sortValue(video, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        // Missing sinks in both directions, so the sign is not applied.
        return (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0)
      }
      return sign * compareValues(a.value, b.value)
    })
    .map(({ video }) => video)
}
