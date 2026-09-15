/**
 * Moving one video into a collection from its library card: a per-video
 * `PATCH /api/library/{id}` with `{collection_id}` (decision 8: never a bulk
 * write).
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
import type { CollectionSummary } from './collectionTypes'
import { collectionLabel } from './collections'
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
      message: `${target} no longer exists, so ${title} was not moved. The collections list has been refreshed.`,
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

/** How a move target is named in a message. */
export function moveTargetLabel(
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  collectionId: string | null
): string {
  return collectionLabel(collections, collectionId) ?? 'no collection'
}

export interface MoveOption {
  id: string | null
  label: string
  checked: boolean
}

/** None, every collection, and an orphan id the record carries (so its check isn't lost). */
export function moveMenuOptions(
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  currentId: string | null
): MoveOption[] {
  const known = collections.map((c) => ({ id: c.id, label: c.name, checked: c.id === currentId }))
  const orphan =
    currentId !== null && !collections.some((c) => c.id === currentId)
      ? [{ id: currentId, label: `${currentId} (no such collection)`, checked: true }]
      : []
  return [{ id: null, label: 'None', checked: currentId === null }, ...known, ...orphan]
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
