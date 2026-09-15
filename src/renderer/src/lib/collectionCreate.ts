/**
 * Creating a collection by name from the library screen (the toolbar popover,
 * the empty state and a card's "Move to collection… → New collection…").
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

export const BLANK_NAME_MESSAGE = 'A collection needs a name.'

export function collectionCreatedMessage(name: string): string {
  return `Created the collection ${name}`
}

export function createCollectionFailedMessage(reason: string): string {
  return `Could not create the collection: ${reason}`
}

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
    return err.refusal.kind === 'collection_exists' ? collectionRefusalMessage(err.refusal) : null
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

/** Create by name. Never rejects: every failure is inline or toasted. */
export async function runCreateCollection(
  name: string,
  deps: CreateCollectionDeps
): Promise<CreateCollectionResult> {
  const trimmed = name.trim()
  if (!trimmed) return { kind: 'invalid', message: BLANK_NAME_MESSAGE }
  let collection: CollectionSummary
  try {
    collection = await deps.create({ name: trimmed })
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

export type NewCollectionPlacement = 'toolbar' | 'empty-state' | 'none'

/**
 * Beside the collection filter whenever it shows (the library has videos);
 * otherwise in the empty state, once the collections list has loaded and is
 * empty. An empty library that already has collections offers it in Settings.
 */
export function newCollectionPlacement(
  videoCount: number,
  collections: readonly unknown[] | null
): NewCollectionPlacement {
  if (videoCount > 0) return 'toolbar'
  return collections !== null && collections.length === 0 ? 'empty-state' : 'none'
}
