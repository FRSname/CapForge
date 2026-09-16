/**
 * The library's folder actions (docs/plans/library-finder.md §4.1, §4.3):
 * rename, move (a menu pick or a drop), delete and adopting an orphan id.
 * Creating one is `runCreateCollection` (`collectionCreate.ts`).
 *
 * Every refusal the collections routes answer (`collectionsApi.ts`) already
 * carries its human copy (`collectionRefusalMessage`), so a failure here is
 * that copy with what was being done in front of it. Nothing is swallowed, and
 * every change re-reads the folders once — a refusal too, because it usually
 * means the list on screen was stale.
 *
 * I/O is injected, so all of it runs in the node test environment.
 */

import type { CollectionSummary } from './collectionTypes'
import type { CollectionCreate, CollectionPatch } from './collectionsApi'
import { CollectionInvalidError } from './collectionsApi'
import { BLANK_NAME_MESSAGE } from './collectionCreate'
import { collectionLabel } from './collections'

export interface FolderActionDeps {
  create: (input: CollectionCreate) => Promise<CollectionSummary>
  patch: (id: string, patch: CollectionPatch) => Promise<unknown>
  remove: (id: string) => Promise<void>
  /** Re-read the folders; reports its own failures. */
  refreshCollections: () => Promise<void>
  /** Error toast. */
  notify: (message: string) => void
  /** Success toast. */
  inform: (message: string) => void
}

export type RenameFolderResult =
  | { kind: 'renamed' }
  /** Shown under the name input, which stays open. */
  | { kind: 'invalid'; message: string }
  /** Already toasted. */
  | { kind: 'failed' }

type NamedFolder = Pick<CollectionSummary, 'id' | 'name'>

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Never rejects. */
export async function runRenameFolder(
  folder: NamedFolder,
  name: string,
  deps: FolderActionDeps
): Promise<RenameFolderResult> {
  const trimmed = name.trim()
  if (!trimmed) return { kind: 'invalid', message: BLANK_NAME_MESSAGE }
  if (trimmed === folder.name) return { kind: 'renamed' }
  try {
    await deps.patch(folder.id, { name: trimmed })
  } catch (err) {
    if (err instanceof CollectionInvalidError) return { kind: 'invalid', message: err.message }
    deps.notify(`Could not rename ${folder.name}: ${reasonOf(err)}`)
    return { kind: 'failed' }
  }
  await deps.refreshCollections()
  return { kind: 'renamed' }
}

/** Put a folder inside another (`parentId`), or at the top level (null). Never rejects. */
export async function runMoveFolder(
  folder: NamedFolder,
  parentId: string | null,
  collections: readonly NamedFolder[],
  deps: FolderActionDeps
): Promise<boolean> {
  let moved = true
  try {
    await deps.patch(folder.id, { parent_id: parentId })
  } catch (err) {
    const where =
      parentId === null ? 'to the top level' : `into ${collectionLabel(collections, parentId)}`
    deps.notify(`Could not move ${folder.name} ${where}: ${reasonOf(err)}`)
    moved = false
  }
  await deps.refreshCollections()
  return moved
}

/** Never rejects. */
export async function runDeleteFolder(
  folder: NamedFolder,
  deps: FolderActionDeps
): Promise<boolean> {
  let deleted = true
  try {
    await deps.remove(folder.id)
    deps.inform(`Deleted the folder ${folder.name}`)
  } catch (err) {
    deps.notify(`Could not delete ${folder.name}: ${reasonOf(err)}`)
    deleted = false
  }
  await deps.refreshCollections()
  return deleted
}

/** Create a folder with an orphan's exact id, which adopts its videos. Never rejects. */
export async function runAdoptOrphan(id: string, deps: FolderActionDeps): Promise<boolean> {
  let created = true
  try {
    await deps.create({ id, name: id })
    deps.inform(`Created the folder ${id}`)
  } catch (err) {
    deps.notify(`Could not create the folder ${id}: ${reasonOf(err)}`)
    created = false
  }
  await deps.refreshCollections()
  return created
}
