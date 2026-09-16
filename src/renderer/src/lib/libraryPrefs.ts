/**
 * The library view the user left it in (docs/plans/library-finder.md §3.7):
 * grid or list, the grid's icon size, the sort, the location on show, whether
 * the sidebar is collapsed and which sidebar folders are expanded, remembered
 * in **one**
 * `app-state` key, `libraryView`, through the `state:get` / `state:set` IPC.
 *
 * The stored value is parsed at read time, field by field: a value written by
 * an older or newer build, or edited by hand, falls back per field to its
 * default rather than breaking the screen. Keys this build does not know (a
 * later build's state) are dropped from what it reads. A remembered folder
 * that no longer exists is not this module's concern: the screen resolves it
 * to the root (`resolveLocation`), because only the screen has the folders.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { LibraryLocation } from './libraryLocation'
import { ROOT_LOCATION, isLibraryLocation } from './libraryLocation'
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
  /** All videos, the Library root, or a folder. */
  location: LibraryLocation
  sidebarCollapsed: boolean
  /** Sidebar folders whose subfolders are shown. */
  expanded: string[]
}

export const DEFAULT_LIBRARY_VIEW_PREFS: LibraryViewPrefs = {
  layout: 'grid',
  tileSize: LIBRARY_TILE_DEFAULT_PX,
  sort: DEFAULT_LIBRARY_SORT,
  location: ROOT_LOCATION,
  sidebarCollapsed: false,
  expanded: [],
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

/** Only the fields a location has, so a hand-added key is not carried along. */
function parseLocation(value: unknown): LibraryLocation {
  if (!isLibraryLocation(value)) return DEFAULT_LIBRARY_VIEW_PREFS.location
  return value.kind === 'folder' ? { kind: 'folder', id: value.id } : { kind: value.kind }
}

/** Non-empty string ids, each once, in the stored order. */
function parseExpanded(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((id): id is string => typeof id === 'string' && id !== '')
  return [...new Set(ids)]
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
    location: parseLocation(stored.location),
    sidebarCollapsed: stored.sidebarCollapsed === true,
    expanded: parseExpanded(stored.expanded),
  }
}
