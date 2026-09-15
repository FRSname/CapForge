/**
 * REST client for library collections (docs/plans/library-collections.md).
 *
 * A sibling of `api.ts` rather than more methods on it, because that file is
 * past its size ceiling — the `libraryApi.ts` pattern. Every call goes through
 * `api.sendWithLocalToken`, so the bridge and the local token are handled in
 * exactly one place. The two `409`s the UI acts on (`collection_exists`,
 * `collection_in_use`) throw `CollectionRefusedError`; anything else is the
 * usual `ApiError` with the backend's message.
 */

import { api } from './api'
import type {
  BriefOverrides,
  CollectionDetail,
  CollectionSummary,
  CollectionsList,
} from './collectionTypes'
import { parseCollection, parseCollectionDetail, parseCollectionsList } from './collectionTypes'
import type { CollectionRefusal } from './collections'
import { collectionRefusal, collectionRefusalMessage } from './collections'

/** `POST /api/library/collections`. Without `id` the backend slugifies `name`. */
export interface CollectionCreate {
  id?: string
  name: string
  slots?: Record<string, string>
  overrides?: Partial<BriefOverrides>
}

/**
 * `PATCH /api/library/collections/{cid}`. `slots` replaces the collection's
 * slot map; `overrides` merges per field, and a `null` field inherits again.
 */
export interface CollectionPatch {
  name?: string
  slots?: Record<string, string>
  overrides?: Partial<BriefOverrides>
}

export class CollectionRefusedError extends Error {
  readonly refusal: CollectionRefusal
  constructor(refusal: CollectionRefusal) {
    super(collectionRefusalMessage(refusal))
    this.name = 'CollectionRefusedError'
    this.refusal = refusal
  }
}

/**
 * The backend refused the body (`422`): a bad id, name or slot name. The
 * message is the formatted detail, which is user-facing, so a form can show it
 * under the field instead of in a toast.
 */
export class CollectionInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollectionInvalidError'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const HTTP_UNPROCESSABLE = 422

const COLLECTIONS_PATH = '/api/library/collections'

function collectionPath(cid: string): string {
  return `${COLLECTIONS_PATH}/${encodeURIComponent(cid)}`
}

/** A refused response's body; a body that is not JSON falls back to the status text. */
function refusedBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({ detail: res.statusText }))
}

/** The response when it is ok; otherwise the typed refusal or the formatted error. */
async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  const res = await api.sendWithLocalToken(method, path, body)
  if (res.ok) return res
  const refused = await refusedBody(res)
  const refusal = collectionRefusal(res.status, refused)
  if (refusal) throw new CollectionRefusedError(refusal)
  const error = api.apiError(res, refused)
  if (res.status === HTTP_UNPROCESSABLE) throw new CollectionInvalidError(error.message)
  throw error
}

async function json(method: Method, path: string, body?: unknown): Promise<unknown> {
  return (await send(method, path, body)).json()
}

export async function listCollections(): Promise<CollectionsList> {
  return parseCollectionsList(await json('GET', COLLECTIONS_PATH))
}

export async function getCollection(cid: string): Promise<CollectionDetail> {
  return parseCollectionDetail(await json('GET', collectionPath(cid)))
}

export async function createCollection(input: CollectionCreate): Promise<CollectionSummary> {
  return parseCollection(await json('POST', COLLECTIONS_PATH, input))
}

export async function patchCollection(
  cid: string,
  patch: CollectionPatch
): Promise<CollectionDetail> {
  return parseCollectionDetail(await json('PATCH', collectionPath(cid), patch))
}

/** `204` carries no body, so nothing is read from a success. */
export async function deleteCollection(cid: string): Promise<void> {
  await send('DELETE', collectionPath(cid))
}
