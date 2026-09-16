/**
 * "Move to…" for a multi-selection (docs/plans/library-finder.md §4.4): every
 * selected video goes through the one-video move path (`moveEachVideo`, the
 * same `runMoveToCollection` a drop uses: read the rev, `PATCH collection_id`
 * with `If-Match`, one retry on a 409), and every selected folder is a
 * `PATCH /collections/{id}` `{parent_id}`.
 *
 * A folder that cannot go to the target (the target is itself or one of its
 * subfolders, the move would nest too deep, or it is an orphan id and not a
 * folder at all) is skipped and named. Everything that did not move is told in
 * **one** summary, after **one** refresh of the list and the folders.
 *
 * I/O is injected, so all of it runs in the node test environment.
 */

import type { AssignDeps, MoveOption } from './collectionMove'
import {
  moveEachVideo,
  moveMenuOptions,
  moveTargetLabel,
  moveVideosFailedMessage,
} from './collectionMove'
import { canMoveInto, descendantIds } from './collectionTree'
import type { CollectionSummary } from './collectionTypes'
import type { LibraryVideo } from './libraryTypes'

type MoveFolder = Pick<CollectionSummary, 'id' | 'name' | 'parent_id'>
type MoveVideo = Pick<LibraryVideo, 'id' | 'title' | 'sourcePath' | 'collection_id'>

export interface SelectionMoveDeps extends AssignDeps {
  patchFolder: (id: string, patch: { parent_id: string | null }) => Promise<unknown>
  /** Re-read the library list; reports its own failures. */
  refresh: () => Promise<void>
  /** Re-read the folders; reports its own failures. */
  refreshCollections: () => Promise<void>
  notify: (message: string) => void
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Why this folder cannot move to `targetId` (null: the top level), or null when it can. */
export function folderMoveProblem(
  collections: readonly MoveFolder[],
  folderId: string,
  targetId: string | null
): string | null {
  const folder = collections.find((c) => c.id === folderId)
  if (!folder) return `${folderId} is not a folder yet, so it was not moved.`
  if (canMoveInto(collections, folderId, targetId)) return null
  if (targetId === folderId || (targetId && descendantIds(collections, folderId).has(targetId))) {
    return `${folder.name} can't go inside itself or one of its own folders.`
  }
  const target = moveTargetLabel(collections, targetId)
  return `${folder.name} can't go into ${target}: folders would nest too deep.`
}

async function moveFolders(
  folderIds: readonly string[],
  targetId: string | null,
  collections: readonly MoveFolder[],
  deps: SelectionMoveDeps
): Promise<{ moved: number; failures: string[] }> {
  const failures: string[] = []
  let moved = 0
  for (const id of folderIds) {
    const folder = collections.find((c) => c.id === id)
    if (folder && folder.parent_id === targetId) continue
    const problem = folderMoveProblem(collections, id, targetId)
    if (problem) {
      failures.push(problem)
      continue
    }
    try {
      await deps.patchFolder(id, { parent_id: targetId })
      moved += 1
    } catch (err) {
      const target = moveTargetLabel(collections, targetId)
      failures.push(`Could not move ${folder?.name ?? id} to ${target}: ${reasonOf(err)}`)
    }
  }
  return { moved, failures }
}

/** Move the selection to `targetId` (null: the Library root / top level). Never rejects; returns how many moved. */
export async function runMoveSelection(
  videos: readonly MoveVideo[],
  folderIds: readonly string[],
  targetId: string | null,
  collections: readonly MoveFolder[],
  deps: SelectionMoveDeps
): Promise<number> {
  // A video already there has nothing to do: no read, no write.
  const moving = videos.filter((v) => v.collection_id !== targetId)
  const total = videos.length + folderIds.length
  if (total === 0) return 0
  const forVideos = await moveEachVideo(moving, targetId, collections, deps)
  const forFolders = await moveFolders(folderIds, targetId, collections, deps)
  await deps.refresh()
  await deps.refreshCollections()
  const failures = [...forVideos.failures, ...forFolders.failures]
  if (failures.length > 0) deps.notify(moveVideosFailedMessage(failures, total))
  return forVideos.moved + forFolders.moved
}

/**
 * The picker for a selection: Top level and the whole tree. A place is checked
 * only when **every** selected item already sits there.
 */
export function selectionMoveOptions(
  collections: readonly MoveFolder[],
  videos: ReadonlyArray<Pick<LibraryVideo, 'collection_id'>>,
  folderIds: readonly string[]
): MoveOption[] {
  const places = [
    ...videos.map((v) => v.collection_id),
    ...folderIds.map((id) => collections.find((c) => c.id === id)?.parent_id ?? null),
  ]
  const shared = places.length > 0 && places.every((p) => p === places[0]) ? places[0] : undefined
  if (shared !== undefined) return moveMenuOptions(collections, shared)
  return moveMenuOptions(collections, null).map((option) => ({ ...option, checked: false }))
}
