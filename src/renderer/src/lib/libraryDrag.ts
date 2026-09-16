/**
 * Drag and drop inside the library (docs/plans/library-finder.md §4.3).
 *
 * Three kinds of drag reach the library screen:
 *   - **files** from the OS — the screen's capture-phase import drop;
 *   - **videos** — a card or list row, as `application/x-capforge-videos`
 *     (a JSON array of record ids);
 *   - **collection** — a folder, as `application/x-capforge-collection` (its id).
 *
 * `dragKind` decides which from `dataTransfer.types` alone, because the data
 * itself is unreadable until the drop. An internal type wins over `Files`, so
 * an internal drag can never reach the import. The payload is read at the
 * drop and validated here (the boundary); `canDrop` is the renderer's copy of
 * the move rules, used only to show or withhold a drop affordance — the record
 * route and the collections store still rule.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { TreeItem } from './collectionTree'
import { canMoveInto } from './collectionTree'
import type { LibraryVideo } from './libraryTypes'

export const VIDEOS_DRAG_TYPE = 'application/x-capforge-videos'
export const COLLECTION_DRAG_TYPE = 'application/x-capforge-collection'
/** What Chromium lists in `dataTransfer.types` while files from the OS are dragged. */
export const FILES_DRAG_TYPE = 'Files'

export type DragKind = 'files' | 'videos' | 'collection'

export type DragPayload =
  | { kind: 'videos'; ids: readonly string[] }
  | { kind: 'collection'; id: string }

export function dragKind(types: readonly string[]): DragKind | null {
  const videos = types.includes(VIDEOS_DRAG_TYPE)
  const collection = types.includes(COLLECTION_DRAG_TYPE)
  if (videos && collection) return null
  if (videos) return 'videos'
  if (collection) return 'collection'
  return types.includes(FILES_DRAG_TYPE) ? 'files' : null
}

export function encodeVideoIds(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/** A non-empty JSON array of non-empty string ids (each once); anything else is null. */
export function parseVideoIds(raw: string): string[] | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON: not a payload this build wrote. Refused, never guessed at.
    return null
  }
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((id) => typeof id === 'string' && id !== '')) return null
  return [...new Set(value as string[])]
}

export function parseCollectionId(raw: string): string | null {
  const id = raw.trim()
  return id === '' ? null : id
}

/** The drop's payload, read through `getData` for the type its kind names. */
export function readDragPayload(
  kind: DragKind | null,
  getData: (type: string) => string
): DragPayload | null {
  if (kind === 'videos') {
    const ids = parseVideoIds(getData(VIDEOS_DRAG_TYPE))
    return ids ? { kind: 'videos', ids } : null
  }
  if (kind === 'collection') {
    const id = parseCollectionId(getData(COLLECTION_DRAG_TYPE))
    return id ? { kind: 'collection', id } : null
  }
  return null
}

function videosCanDrop(
  ids: readonly string[],
  targetId: string | null,
  videos: readonly Pick<LibraryVideo, 'id' | 'collection_id'>[]
): boolean {
  const byId = new Map(videos.map((v) => [v.id, v]))
  return ids.some((id) => {
    const video = byId.get(id)
    return video !== undefined && video.collection_id !== targetId
  })
}

function collectionCanDrop(id: string, targetId: string | null, tree: readonly TreeItem[]) {
  const moving = tree.find((item) => item.id === id)
  if (!moving || moving.parent_id === targetId) return false
  return canMoveInto(tree, id, targetId)
}

/**
 * Whether a drop target (`targetId`: a folder, or null for the Library root /
 * top level) accepts this drag. `kind` is what the browser says is being
 * dragged, `payload` what the drag started with; they must agree. A target
 * that would change nothing refuses too, so it shows no affordance.
 */
export function canDrop(
  kind: DragKind | null,
  payload: DragPayload | null,
  targetId: string | null,
  tree: readonly TreeItem[],
  videos: readonly Pick<LibraryVideo, 'id' | 'collection_id'>[]
): boolean {
  if (kind === null || kind === 'files' || payload === null || payload.kind !== kind) return false
  if (targetId !== null && !tree.some((item) => item.id === targetId)) return false
  return payload.kind === 'videos'
    ? videosCanDrop(payload.ids, targetId, videos)
    : collectionCanDrop(payload.id, targetId, tree)
}
