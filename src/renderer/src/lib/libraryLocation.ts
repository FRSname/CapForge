/**
 * Where the library is looking (docs/plans/library-finder.md §1, §4.2). The
 * screen shows exactly one **location**:
 *   - `all` — "All videos": every video, flat, whatever folder it is in;
 *   - `root` — "Library": the top-level folders, the unfiled videos
 *     (`collection_id === null`), and every orphan id (a `collection_id` no
 *     folder defines) as a pseudo-folder;
 *   - a folder id — its direct subfolders and its direct videos. An orphan id
 *     is a location too, holding the videos that carry it.
 *
 * A folder *is* a collection; the tree helpers are `collectionTree.ts`. The
 * location is remembered in the `libraryView` prefs, and a remembered folder
 * that no longer exists resolves to the root (`resolveLocation`).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { CollectionSummary } from './collectionTypes'
import { subfolderCount, videoCount } from './collections'
import { ancestorsOf, descendantIds, pathLabel } from './collectionTree'
import type { LibraryLayout, LibraryViewPrefs } from './libraryPrefs'
import type { LibraryVideo } from './libraryTypes'
import { searchResults } from './librarySearch'
import { sortVideos } from './librarySort'
import { continueCandidate } from './libraryView'

export type LibraryLocation = { kind: 'all' } | { kind: 'root' } | { kind: 'folder'; id: string }

export const ALL_VIDEOS_LOCATION: LibraryLocation = { kind: 'all' }
export const ROOT_LOCATION: LibraryLocation = { kind: 'root' }

export const ALL_VIDEOS_LABEL = 'All videos'
/** The root *location*: the path bar's first crumb, and "Top level" in a move. */
export const LIBRARY_ROOT_LABEL = 'Library'
/**
 * The sidebar row for the root, which counts the videos in no folder. It is
 * deliberately not `LIBRARY_ROOT_LABEL`: the crumb names a place, this row
 * names what its number means.
 */
export const UNFILED_ROW_LABEL = 'Unfiled'

/** What a location needs to know about the folders. */
export type FolderItem = Pick<CollectionSummary, 'id' | 'name' | 'parent_id' | 'total_members'>

export function folderLocation(id: string): LibraryLocation {
  return { kind: 'folder', id }
}

/** A stable string per location — a React key, and what "the location changed" compares. */
export function locationKey(location: LibraryLocation): string {
  return location.kind === 'folder' ? `folder:${location.id}` : location.kind
}

export function sameLocation(a: LibraryLocation, b: LibraryLocation): boolean {
  return locationKey(a) === locationKey(b)
}

/** The boundary guard for a stored location. */
export function isLibraryLocation(value: unknown): value is LibraryLocation {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (row.kind === 'all' || row.kind === 'root') return true
  return row.kind === 'folder' && typeof row.id === 'string' && row.id.trim() !== ''
}

/** Locale order with numbers compared as numbers: "Day 2" before "Day 10". */
export function compareFolderNames(
  a: { name: string; id: string },
  b: { name: string; id: string }
) {
  return (
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Ids records carry that no folder defines, sorted, each once. Before the
 * folders have loaded nothing is called an orphan.
 */
export function orphanIds(
  videos: readonly Pick<LibraryVideo, 'collection_id'>[],
  collections: readonly Pick<FolderItem, 'id'>[] | null
): string[] {
  if (collections === null) return []
  const known = new Set(collections.map((c) => c.id))
  const carried = videos.map((v) => v.collection_id).filter((id): id is string => id !== null)
  return [...new Set(carried)].filter((id) => !known.has(id)).sort()
}

/** A folder tile, row or sidebar entry. */
export interface FolderEntry {
  id: string
  name: string
  /** An id records carry that no folder defines: shown, but only adoptable. */
  orphan: boolean
  /** Videos in this folder and every folder below it. */
  videoCount: number
  /** Direct subfolders. */
  folderCount: number
  /** `Events › UCK26` — the orphan's id. */
  path: string
}

export function folderEntry(folder: FolderItem, collections: readonly FolderItem[]): FolderEntry {
  return {
    id: folder.id,
    name: folder.name,
    orphan: false,
    videoCount: folder.total_members,
    folderCount: collections.filter((c) => c.parent_id === folder.id).length,
    path: pathLabel(collections, folder.id),
  }
}

/** "4 videos · 2 folders" — what a folder tile or row says under its name. */
export function folderSummary(entry: Pick<FolderEntry, 'videoCount' | 'folderCount'>): string {
  const folders = subfolderCount(entry.folderCount).replace('subfolder', 'folder')
  return `${videoCount(entry.videoCount)} · ${folders}`
}

/** Said in an empty folder, where the videos would be. */
export const EMPTY_FOLDER_MESSAGE =
  'This folder is empty — drop videos here, or drag them from another folder.'

export function orphanEntry(
  id: string,
  videos: readonly Pick<LibraryVideo, 'collection_id'>[]
): FolderEntry {
  const videoCount = videos.filter((v) => v.collection_id === id).length
  return { id, name: id, orphan: true, videoCount, folderCount: 0, path: id }
}

export interface LocationContents {
  /** Folders first, by name. */
  folders: FolderEntry[]
  /** Unsorted: the caller applies the video sort. */
  videos: LibraryVideo[]
}

/** A folder at the top level, including one whose parent the list does not know. */
function isTopLevel(folder: FolderItem, collections: readonly FolderItem[]): boolean {
  return folder.parent_id === null || !collections.some((c) => c.id === folder.parent_id)
}

function sortedEntries(folders: readonly FolderItem[], collections: readonly FolderItem[]) {
  return [...folders].sort(compareFolderNames).map((f) => folderEntry(f, collections))
}

/** What a location shows. Returns NEW arrays. */
export function locationContents(
  location: LibraryLocation,
  collections: readonly FolderItem[] | null,
  videos: readonly LibraryVideo[]
): LocationContents {
  const known = collections ?? []
  if (location.kind === 'all') return { folders: [], videos: [...videos] }
  if (location.kind === 'root') {
    const top = sortedEntries(
      known.filter((f) => isTopLevel(f, known)),
      known
    )
    const orphans = orphanIds(videos, collections).map((id) => orphanEntry(id, videos))
    return { folders: [...top, ...orphans], videos: videos.filter((v) => v.collection_id === null) }
  }
  const children = known.filter((f) => f.parent_id === location.id)
  return {
    folders: sortedEntries(children, known),
    videos: videos.filter((v) => v.collection_id === location.id),
  }
}

export interface Crumb {
  label: string
  location: LibraryLocation
  /** Where a drop on this crumb moves things: a folder id, or null for the Library root. */
  targetId: string | null
}

/** `Library › Events › UCK26`; All videos is its own single crumb. */
export function breadcrumb(
  location: LibraryLocation,
  collections: readonly FolderItem[] | null
): Crumb[] {
  if (location.kind === 'all') {
    return [{ label: ALL_VIDEOS_LABEL, location: ALL_VIDEOS_LOCATION, targetId: null }]
  }
  const root: Crumb = { label: LIBRARY_ROOT_LABEL, location: ROOT_LOCATION, targetId: null }
  if (location.kind === 'root') return [root]
  const known = collections ?? []
  const self = known.find((f) => f.id === location.id)
  const chain = self ? [...ancestorsOf(known, self.id), self] : []
  const crumbs = chain.map((f) => ({
    label: f.name,
    location: folderLocation(f.id),
    targetId: f.id,
  }))
  return self ? [root, ...crumbs] : [root, { label: location.id, location, targetId: location.id }]
}

/**
 * The location to show: a remembered folder that is neither a folder nor an
 * orphan any more falls back to the root. Nothing is decided before the
 * folders have loaded.
 */
export function resolveLocation(
  location: LibraryLocation,
  collections: readonly FolderItem[] | null,
  videos: readonly Pick<LibraryVideo, 'collection_id'>[]
): LibraryLocation {
  if (location.kind !== 'folder' || collections === null) return location
  if (collections.some((f) => f.id === location.id)) return location
  return videos.some((v) => v.collection_id === location.id) ? location : ROOT_LOCATION
}

/** While searching inside a folder: that folder with its subfolders, or every video. */
export type SearchScope = 'folder' | 'everywhere'

export const DEFAULT_SEARCH_SCOPE: SearchScope = 'folder'

export function hasScopeToggle(location: LibraryLocation): boolean {
  return location.kind === 'folder'
}

/** The folder ids a search may return videos from; null is every video. */
export function searchScopeIds(
  location: LibraryLocation,
  scope: SearchScope,
  collections: readonly FolderItem[] | null
): ReadonlySet<string> | null {
  if (location.kind !== 'folder' || scope === 'everywhere') return null
  return new Set([location.id, ...descendantIds(collections ?? [], location.id)])
}

/** The videos inside the scope. Returns a NEW array. */
export function videosInScope(
  videos: readonly LibraryVideo[],
  scopeIds: ReadonlySet<string> | null
): LibraryVideo[] {
  if (scopeIds === null) return [...videos]
  return videos.filter((v) => v.collection_id !== null && scopeIds.has(v.collection_id))
}

export function showsContinueHero(
  location: LibraryLocation,
  layout: LibraryLayout,
  searching: boolean
): boolean {
  return location.kind !== 'folder' && layout === 'grid' && !searching
}

/** The list's Folder column and the card's folder chip. */
export function showsFolderColumn(location: LibraryLocation, searching: boolean): boolean {
  return location.kind === 'all' || searching
}

/**
 * Where "New folder" creates: inside the folder on show, else at the top level.
 * An orphan is not a real folder, so a new folder beside it goes to the top
 * level. The depth limit is the backend's to refuse (`collection_too_deep`).
 */
export function parentForNewFolder(
  location: LibraryLocation,
  collections: readonly FolderItem[] | null
): string | null {
  if (location.kind !== 'folder') return null
  return (collections ?? []).some((f) => f.id === location.id) ? location.id : null
}

export interface ShownInput {
  searching: boolean
  /** The search field's text; matched locally against each video's shown name. */
  query: string
  /** The backend's matches; null while no answer has landed (the local matches only). */
  matchIds: ReadonlySet<string> | null
  scope: SearchScope
}

export interface Shown extends LocationContents {
  /** What "N of M videos" counts against: the scope while searching, else what is shown. */
  total: number
}

/**
 * What the main area shows. Browsing: the location's folders and videos.
 * Searching: flat, no folders — the matches inside the search scope, where a
 * match is a backend hit or a shown name containing the query (`searchResults`).
 */
export function shownAt(
  location: LibraryLocation,
  collections: readonly FolderItem[] | null,
  videos: readonly LibraryVideo[],
  input: ShownInput
): Shown {
  if (!input.searching) {
    const contents = locationContents(location, collections, videos)
    return { ...contents, total: contents.videos.length }
  }
  const inScope = videosInScope(videos, searchScopeIds(location, input.scope, collections))
  return {
    folders: [],
    videos: searchResults(inScope, input.query, input.matchIds),
    total: inScope.length,
  }
}

export interface VisibleContents {
  /** The Continue hero, promoted out of the videos; null when none is shown. */
  hero: LibraryVideo | null
  folders: FolderEntry[]
  /** Sorted, without the hero: exactly what the grid or the list draws. */
  videos: LibraryVideo[]
}

/**
 * What the main area draws, in order: the hero (All videos and the root, in
 * grid, not while searching), the folders, then the sorted videos. The
 * selection's visible order is `folders` then `videos`. Returns NEW arrays.
 */
export function visibleContents(
  shown: Shown,
  location: LibraryLocation,
  view: Pick<LibraryViewPrefs, 'layout' | 'sort'>,
  searching: boolean,
  allVideos: readonly LibraryVideo[]
): VisibleContents {
  const hero = showsContinueHero(location, view.layout, searching)
    ? continueCandidate(allVideos)
    : null
  const videos = sortVideos(shown.videos, view.sort).filter((v) => v.id !== hero?.id)
  return { hero, folders: [...shown.folders], videos }
}
