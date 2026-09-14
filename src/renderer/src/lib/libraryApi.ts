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

/** Import every media file under a folder (bounded by the backend). Nothing is transcribed. */
export async function importLibraryFolder(
  path: string,
  recursive = true
): Promise<FolderImportResult> {
  return parseFolderImportResult(
    await requestJson('POST', '/api/library/import-folder', { path, recursive })
  )
}

/**
 * Import an explicit list of files (a multi-file drop) — the same per-path
 * step as a folder import, answering the same shape. At most
 * `IMPORT_PATHS_MAX` paths per call; the caller batches.
 */
export async function importLibraryPaths(paths: readonly string[]): Promise<FolderImportResult> {
  return parseFolderImportResult(
    await requestJson('POST', '/api/library/import-paths', { paths: [...paths] })
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

export async function getLibraryWatch(): Promise<WatchStatus> {
  return parseWatchStatus(await requestJson('GET', '/api/library/watch'))
}

/** Watch a folder, or stop watching with `null`. A 422's message is user-facing. */
export async function setLibraryWatch(folder: string | null): Promise<WatchStatus> {
  return parseWatchStatus(await requestJson('PUT', '/api/library/watch', { folder }))
}
