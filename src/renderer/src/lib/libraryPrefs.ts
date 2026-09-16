/**
 * The library view the user left it in (docs/plans/library-finder.md §3.7):
 * grid or list, the grid's icon size and the sort, remembered in **one**
 * `app-state` key, `libraryView`, through the `state:get` / `state:set` IPC.
 *
 * The stored value is parsed at read time, field by field: a value written by
 * an older or newer build, or edited by hand, falls back per field to its
 * default rather than breaking the screen. Keys this build does not know (a
 * later build's sidebar state) are dropped from what it reads.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibrarySort } from './librarySort'
import {
  DEFAULT_LIBRARY_SORT,
  defaultSortDirection,
  isLibrarySortKey,
  isSortDirection,
} from './librarySort'

/** `app-state` key holding the remembered library view. */
export const LIBRARY_VIEW_KEY = 'libraryView'

/** The icon-size slider's range, in CSS pixels of a grid column's minimum width. */
export const LIBRARY_TILE_MIN_PX = 140
export const LIBRARY_TILE_MAX_PX = 360
/** Today's card width, so an untouched library looks exactly as it did. */
export const LIBRARY_TILE_DEFAULT_PX = 230

export type LibraryLayout = 'grid' | 'list'

export const LIBRARY_LAYOUTS: readonly LibraryLayout[] = ['grid', 'list']

export interface LibraryViewPrefs {
  layout: LibraryLayout
  tileSize: number
  sort: LibrarySort
}

export const DEFAULT_LIBRARY_VIEW_PREFS: LibraryViewPrefs = {
  layout: 'grid',
  tileSize: LIBRARY_TILE_DEFAULT_PX,
  sort: DEFAULT_LIBRARY_SORT,
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isLayout(value: unknown): value is LibraryLayout {
  return typeof value === 'string' && (LIBRARY_LAYOUTS as readonly string[]).includes(value)
}

/** A whole pixel inside the slider's range; anything unusable is the default. */
export function clampTileSize(value: number): number {
  if (!Number.isFinite(value)) return LIBRARY_TILE_DEFAULT_PX
  return Math.min(LIBRARY_TILE_MAX_PX, Math.max(LIBRARY_TILE_MIN_PX, Math.round(value)))
}

/** An unknown key is the default key; an unknown direction is the key's natural one. */
function parseSort(value: unknown): LibrarySort {
  const sort = asObject(value)
  if (!sort) return DEFAULT_LIBRARY_SORT
  const key = isLibrarySortKey(sort.key) ? sort.key : DEFAULT_LIBRARY_SORT.key
  const direction = isSortDirection(sort.direction) ? sort.direction : defaultSortDirection(key)
  return { key, direction }
}

/** Whatever `state:get` returned → a usable view, each field defaulted on its own. */
export function parseLibraryViewPrefs(value: unknown): LibraryViewPrefs {
  const stored = asObject(value)
  if (!stored) return DEFAULT_LIBRARY_VIEW_PREFS
  return {
    layout: isLayout(stored.layout) ? stored.layout : DEFAULT_LIBRARY_VIEW_PREFS.layout,
    tileSize:
      typeof stored.tileSize === 'number'
        ? clampTileSize(stored.tileSize)
        : DEFAULT_LIBRARY_VIEW_PREFS.tileSize,
    sort: parseSort(stored.sort),
  }
}
