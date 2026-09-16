/**
 * REST client for the library's folder import, relink and watch folder
 * (docs/plans/library-folder-import.md).
 *
 * A sibling of `api.ts` rather than more methods on it, because that file is
 * past its size ceiling. Every call goes through `api.sendWithLocalToken`, so
 * the bridge (`ensureBridge`) and the local token are still handled in exactly
 * one place — nothing here builds a URL base or a header.
 */

import { api } from './api'
import { channelsBody } from './importChannels'
import type { FolderImportResult, LibraryRecord, WatchStatus } from './libraryTypes'
import { parseFolderImportResult, parseLibraryRecord, parseWatchStatus } from './libraryTypes'
import type { RelinkRefusal } from './libraryImport'
import { relinkRefusal, relinkRefusalMessage } from './libraryImport'

/** A relink the backend refused for a reason the card acts on (confirm, or toast). */
export class RelinkRefusedError extends Error {
  readonly refusal: RelinkRefusal
  constructor(refusal: RelinkRefusal) {
    super(relinkRefusalMessage(refusal))
    this.name = 'RelinkRefusedError'
    this.refusal = refusal
  }
}

/** A refused response's body; a body that is not JSON falls back to the status text. */
function refusedBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({ detail: res.statusText }))
}

async function requestJson(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const res = await api.sendWithLocalToken(method, path, body)
  if (res.ok) return res.json() as Promise<unknown>
  throw api.apiError(res, await refusedBody(res))
}

/**
 * Import every media file under a folder (bounded by the backend). Nothing is
 * transcribed. `channels` gives every imported record a post per channel; an
 * empty choice sends no key, leaving the request identical to today's.
 */
export async function importLibraryFolder(
  path: string,
  recursive = true,
  channels?: readonly string[]
): Promise<FolderImportResult> {
  return parseFolderImportResult(
    await requestJson('POST', '/api/library/import-folder', {
      path,
      recursive,
      ...channelsBody(channels),
    })
  )
}

/**
 * Import an explicit list of files (a multi-file drop) — the same per-path
 * step as a folder import, answering the same shape. At most
 * `IMPORT_PATHS_MAX` paths per call; the caller batches.
 */
export async function importLibraryPaths(
  paths: readonly string[],
  channels?: readonly string[]
): Promise<FolderImportResult> {
  return parseFolderImportResult(
    await requestJson('POST', '/api/library/import-paths', {
      paths: [...paths],
      ...channelsBody(channels),
    })
  )
}

/**
 * Point a record at a new media file. Throws `RelinkRefusedError` for the
 * three refusals (different media without `force`, a file another record owns,
 * a missing file); any other failure is the usual `ApiError`.
 */
export async function relinkLibraryRecord(
  id: string,
  path: string,
  force = false
): Promise<LibraryRecord> {
  const res = await api.sendWithLocalToken(
    'POST',
    `/api/library/${encodeURIComponent(id)}/relink`,
    { path, force }
  )
  if (res.ok) return parseLibraryRecord(await res.json())
  const body = await refusedBody(res)
  const refusal = relinkRefusal(res.status, body)
  if (refusal) throw new RelinkRefusedError(refusal)
  throw api.apiError(res, body)
}

const HTTP_NOT_FOUND = 404

/**
 * A record asset from the backend's fixed allowlist (`poster.jpg`,
 * `thumbnails/<name>.jpg`, …), or `null` when it does not exist (404).
 * A Blob, not a URL: the renderer CSP allows `blob:` images but not
 * `127.0.0.1`, so the caller wraps it in an object URL.
 */
export async function getLibraryAsset(id: string, assetPath: string): Promise<Blob | null> {
  const encoded = assetPath.split('/').map(encodeURIComponent).join('/')
  const res = await api.sendWithLocalToken(
    'GET',
    `/api/library/${encodeURIComponent(id)}/asset/${encoded}`
  )
  if (res.status === HTTP_NOT_FOUND) return null
  if (res.ok) return res.blob()
  throw api.apiError(res, await refusedBody(res))
}

export async function getLibraryWatch(): Promise<WatchStatus> {
  return parseWatchStatus(await requestJson('GET', '/api/library/watch'))
}

/** Watch a folder, or stop watching with `null`. A 422's message is user-facing. */
export async function setLibraryWatch(folder: string | null): Promise<WatchStatus> {
  return parseWatchStatus(await requestJson('PUT', '/api/library/watch', { folder }))
}
