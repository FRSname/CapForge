/**
 * Creating a collection — a "folder" in the UI — by name from the library
 * screen (the sidebar's "New folder…", a folder's "New folder inside", the
 * empty state and a card's "Move to folder… → New folder…").
 *
 * Every decision the name form makes lives here so it can be tested without a
 * DOM: which refusals stay **inline** under the input (`collection_exists`, a
 * `422`) and which go to a toast (everything else), and where the affordance
 * is offered at all. The backend decides the id; `newCollectionHint` only
 * previews it.
 */

import type { CollectionSummary } from './collectionTypes'
import type { CollectionCreate } from './collectionsApi'
import { CollectionInvalidError, CollectionRefusedError } from './collectionsApi'
import { collectionRefusalMessage, slugPreview } from './collections'

export type CreateCollectionResult =
  | { kind: 'created'; collection: CollectionSummary }
  /** Shown under the name input; the form stays open. */
  | { kind: 'invalid'; message: string }
  /** Already toasted; the form stays open so the user can retry. */
  | { kind: 'failed' }

export const BLANK_NAME_MESSAGE = 'A folder needs a name.'

export function collectionCreatedMessage(name: string): string {
  return `Created the folder ${name}`
}

export function createCollectionFailedMessage(reason: string): string {
  return `Could not create the folder: ${reason}`
}

/** Refusals about the name or the place, which the user fixes in the form itself. */
const INLINE_REFUSALS: ReadonlySet<string> = new Set([
  'collection_exists',
  'unknown_parent',
  'collection_too_deep',
])

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** "Id: uck-26 …" under the input, or null while the name slugs to nothing. */
export function newCollectionHint(name: string): string | null {
  const slug = slugPreview(name.trim())
  return slug ? `Id: ${slug} (a clash adds -2)` : null
}

export function canCreateCollection(name: string, busy: boolean): boolean {
  return !busy && name.trim() !== ''
}

/** The message to show under the input, or null when the failure is a toast. */
export function createInlineError(err: unknown): string | null {
  if (err instanceof CollectionRefusedError) {
    return INLINE_REFUSALS.has(err.refusal.kind) ? collectionRefusalMessage(err.refusal) : null
  }
  if (err instanceof CollectionInvalidError) return err.message
  return null
}

export interface CreateCollectionDeps {
  create: (input: CollectionCreate) => Promise<CollectionSummary>
  /** Re-read the collections list; reports its own failures. */
  refreshCollections: () => Promise<void>
  /** Error toast. */
  notify: (message: string) => void
  /** Success toast. */
  inform: (message: string) => void
}

/**
 * Create by name, inside `parentId` (null: the top level, sent without the
 * key). Never rejects: every failure is inline or toasted.
 */
export async function runCreateCollection(
  name: string,
  deps: CreateCollectionDeps,
  parentId: string | null = null
): Promise<CreateCollectionResult> {
  const trimmed = name.trim()
  if (!trimmed) return { kind: 'invalid', message: BLANK_NAME_MESSAGE }
  let collection: CollectionSummary
  try {
    collection = await deps.create(
      parentId === null ? { name: trimmed } : { name: trimmed, parent_id: parentId }
    )
  } catch (err) {
    const inline = createInlineError(err)
    if (inline) return { kind: 'invalid', message: inline }
    deps.notify(createCollectionFailedMessage(reasonOf(err)))
    return { kind: 'failed' }
  }
  deps.inform(collectionCreatedMessage(collection.name))
  await deps.refreshCollections()
  return { kind: 'created', collection }
}

export type NewCollectionPlacement = 'sidebar' | 'empty-state' | 'none'

/**
 * At the foot of the sidebar whenever the sidebar shows: the library has
 * videos, or folders to list. An empty library with no folders offers it in
 * the empty state once the list has loaded; before that, nowhere.
 */
export function newCollectionPlacement(
  videoCount: number,
  collections: readonly unknown[] | null
): NewCollectionPlacement {
  if (videoCount > 0) return 'sidebar'
  if (collections === null) return 'none'
  return collections.length === 0 ? 'empty-state' : 'sidebar'
}
