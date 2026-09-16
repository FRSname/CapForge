/**
 * Moving videos into a collection — a "folder" in the UI — from a card's menu
 * or by dragging: a per-video `PATCH /api/library/{id}` with `{collection_id}`
 * (decision 8: never a bulk write). `runMoveVideos` runs a batch through the
 * one-video path with one refresh and one summary at the end.
 *
 * The library list carries no `rev`, so `assignCollection` reads the record
 * for it and PATCHes with `If-Match`. A `409` means the record moved on
 * between the read and the write (the agent, an autosave); it re-reads and
 * retries **once**. A second `409` propagates, because a record that keeps
 * changing under us is not something to loop on.
 *
 * I/O is injected, so all of it runs in the node test environment.
 */

import { StaleRecordError, ValidationRefusedError } from './api'
import { buildTree, flattenTree, pathLabel } from './collectionTree'
import type { CollectionSummary } from './collectionTypes'
import { collectionLabel } from './collections'
import { LIBRARY_ROOT_LABEL, compareFolderNames } from './libraryLocation'
import type { LibraryVideo } from './libraryTypes'
import { displayTitle } from './libraryView'

/** The backend's rule for a `collection_id` that names no collection. */
export const UNKNOWN_COLLECTION_RULE = 'unknown_collection'

/** What the move needs from a record read. */
export interface RevisionedMembership {
  rev: number
  collection_id: string | null
}

export interface AssignDeps {
  read: (videoId: string) => Promise<RevisionedMembership>
  write: (videoId: string, patch: { collection_id: string | null }, rev: number) => Promise<unknown>
}

export type AssignOutcome = 'moved' | 'unchanged'

/** Read, then write only when the membership differs. */
async function writeIfChanged(
  videoId: string,
  collectionId: string | null,
  deps: AssignDeps
): Promise<AssignOutcome> {
  const record = await deps.read(videoId)
  if (record.collection_id === collectionId) return 'unchanged'
  await deps.write(videoId, { collection_id: collectionId }, record.rev)
  return 'moved'
}

export async function assignCollection(
  videoId: string,
  collectionId: string | null,
  deps: AssignDeps
): Promise<AssignOutcome> {
  try {
    return await writeIfChanged(videoId, collectionId, deps)
  } catch (err) {
    if (!(err instanceof StaleRecordError)) throw err
  }
  return writeIfChanged(videoId, collectionId, deps)
}

export interface MoveFailure {
  kind: 'unknown_collection' | 'failed'
  message: string
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function moveFailureOf(err: unknown, title: string, target: string): MoveFailure {
  if (
    err instanceof ValidationRefusedError &&
    err.violations.some((v) => v.rule === UNKNOWN_COLLECTION_RULE)
  ) {
    return {
      kind: 'unknown_collection',
      message: `${target} no longer exists, so ${title} was not moved. The folders have been refreshed.`,
    }
  }
  if (err instanceof StaleRecordError) {
    return {
      kind: 'failed',
      message: `Could not move ${title}: the record kept changing while it was being saved — try again.`,
    }
  }
  return { kind: 'failed', message: `Could not move ${title} to ${target}: ${reasonOf(err)}` }
}

/** How a move target is named in a message: a folder's name, or the Library root. */
export function moveTargetLabel(
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  collectionId: string | null
): string {
  return collectionLabel(collections, collectionId) ?? LIBRARY_ROOT_LABEL
}

/** One row of a folder picker. */
export interface MoveOption {
  /** A folder id, or null for the top level. */
  id: string | null
  label: string
  /** The folder's full path, for the tooltip. */
  title: string
  /** 0 for Top level, 1 for a top-level folder… */
  depth: number
  checked: boolean
}

export const TOP_LEVEL_LABEL = 'Top level'
const TOP_LEVEL_TITLE = 'Library — in no folder'

export function topLevelOption(checked: boolean): MoveOption {
  return { id: null, label: TOP_LEVEL_LABEL, title: TOP_LEVEL_TITLE, depth: 0, checked }
}

type TreeFolder = Pick<CollectionSummary, 'id' | 'name' | 'parent_id'>

/**
 * A video's "Move to folder": Top level, the whole tree by name (indented, the
 * path in the tooltip), and an orphan id the record carries, so its check
 * isn't lost.
 */
export function moveMenuOptions(
  collections: readonly TreeFolder[],
  currentId: string | null
): MoveOption[] {
  const rows = flattenTree(buildTree(collections, compareFolderNames))
  const known = rows.map(({ item, depth }) => ({
    id: item.id,
    label: item.name,
    title: pathLabel(collections, item.id),
    depth,
    checked: item.id === currentId,
  }))
  const orphan =
    currentId !== null && !collections.some((c) => c.id === currentId)
      ? [
          {
            id: currentId,
            label: `${currentId} (no such folder)`,
            title: currentId,
            depth: 1,
            checked: true,
          },
        ]
      : []
  return [topLevelOption(currentId === null), ...known, ...orphan]
}

export interface MoveDeps extends AssignDeps {
  /** Re-read the library list; reports its own failures. */
  refresh: () => Promise<void>
  /** Re-read the collections list; reports its own failures. */
  refreshCollections: () => Promise<void>
  notify: (message: string) => void
}

/** Move and report. Never rejects; true when the library list was refreshed. */
export async function runMoveToCollection(
  video: Pick<LibraryVideo, 'id' | 'title' | 'sourcePath'>,
  collectionId: string | null,
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  deps: MoveDeps
): Promise<boolean> {
  try {
    await assignCollection(video.id, collectionId, deps)
  } catch (err) {
    const target = moveTargetLabel(collections, collectionId)
    const failure = moveFailureOf(err, displayTitle(video), target)
    if (failure.kind === 'unknown_collection') await deps.refreshCollections()
    deps.notify(failure.message)
    return false
  }
  await deps.refresh()
  return true
}

/** One toast for a batch: a lone video keeps its own message. */
export function moveVideosFailedMessage(failures: readonly string[], total: number): string {
  if (total <= 1 && failures.length === 1) return failures[0]
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : ''
  return `Couldn't move ${failures.length} of ${total}: ${failures[0]}${more}`
}

/**
 * Move a batch (a drop, a card's menu) one video at a time through
 * `runMoveToCollection`, then refresh the list and the folders (their counts
 * changed) **once**, and toast every failure as one summary. One failure never
 * stops the rest. Never rejects; returns how many moved.
 */
export async function runMoveVideos(
  videos: ReadonlyArray<Pick<LibraryVideo, 'id' | 'title' | 'sourcePath'>>,
  collectionId: string | null,
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  deps: MoveDeps
): Promise<number> {
  if (videos.length === 0) return 0
  const failures: string[] = []
  const quiet: MoveDeps = {
    ...deps,
    refresh: () => Promise.resolve(),
    refreshCollections: () => Promise.resolve(),
    notify: (message) => failures.push(message),
  }
  let moved = 0
  for (const video of videos) {
    if (await runMoveToCollection(video, collectionId, collections, quiet)) moved += 1
  }
  await deps.refresh()
  await deps.refreshCollections()
  if (failures.length > 0) deps.notify(moveVideosFailedMessage(failures, videos.length))
  return moved
}
