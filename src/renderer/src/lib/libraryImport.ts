/**
 * Folder import, "Locate…" relink and the watch folder — the decisions and the
 * copy, kept pure so the node-environment tests can pin every branch
 * (docs/plans/library-folder-import.md).
 *
 * Nothing here scans, fetches or decides what a record *is*: the backend owns
 * dedupe (fingerprints) and the relink rules. This module only says what a
 * drop means, how an import reads in a toast, and which refusal a relink hit.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { FolderImportFailure, FolderImportResult, WatchStatus } from './libraryTypes'
import { isMediaPath } from './libraryView'

/**
 * `POST /api/library/import-paths` accepts 1..500 paths and answers `422`
 * beyond that. This is the route's request limit, which the renderer has to
 * respect before sending — not the scan caps, which stay backend-only.
 */
export const IMPORT_PATHS_MAX = 500

/** Appended to a summary whose import stopped before the end. */
export const IMPORT_STOPPED_EARLY_NOTE =
  'The scan stopped early — import the remaining files or subfolders on their own.'

/** How many failed file names a summary spells out before counting the rest. */
export const MAX_NAMED_FAILURES = 2

const SUMMARY_SEPARATOR = ' · '

/** The last segment of a path, ignoring a trailing separator. */
export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  return trimmed.split(/[\\/]/).pop() ?? trimmed
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function failedPart(failed: readonly FolderImportFailure[]): string {
  const named = failed.slice(0, MAX_NAMED_FAILURES).map((f) => pathBaseName(f.path))
  const rest = failed.length - named.length
  const names = rest > 0 ? [...named, `+${rest} more`] : named
  return `${failed.length} could not be read (${names.join(', ')})`
}

/**
 * The toast after a folder (or multi-file) import: every non-empty bucket, in
 * the order created → existing → relinked → failed. A pass that created
 * nothing names the folder instead of claiming "Imported 0 videos".
 */
export function folderImportSummary(result: FolderImportResult, folderName: string): string {
  const parts: string[] = []
  if (result.created.length > 0) parts.push(`Imported ${plural(result.created.length, 'video')}`)
  if (result.existing.length > 0) parts.push(`${result.existing.length} already in the library`)
  if (result.relinked.length > 0) parts.push(`${result.relinked.length} relinked`)
  if (result.failed.length > 0) parts.push(failedPart(result.failed))

  let summary: string
  if (parts.length === 0) summary = `No media found in ${folderName}`
  else if (result.created.length === 0) summary = `${folderName}: ${parts.join(SUMMARY_SEPARATOR)}`
  else summary = parts.join(SUMMARY_SEPARATOR)

  return result.truncated ? `${summary}. ${IMPORT_STOPPED_EARLY_NOTE}` : summary
}

/** The toast type an import summary is shown with (`useToast`'s `ToastType`). */
export type ImportTone = 'success' | 'info' | 'error'

/**
 * `info` when the import found nothing at all, `error` when every file it
 * found failed, `success` whenever anything landed (created, already there, or
 * relinked) — a partial failure is still named inside the summary text.
 */
export function folderImportTone(result: FolderImportResult): ImportTone {
  const landed = result.created.length + result.existing.length + result.relinked.length
  if (landed > 0) return 'success'
  return result.failed.length > 0 ? 'error' : 'info'
}

/** The paths one `import-paths` request may carry, and whether any were left out. */
export function importPathsBatch(paths: readonly string[]): {
  paths: string[]
  truncated: boolean
} {
  return { paths: paths.slice(0, IMPORT_PATHS_MAX), truncated: paths.length > IMPORT_PATHS_MAX }
}

// ── Relink refusals ─────────────────────────────────────────────────────────

export type RelinkRefusal =
  | { kind: 'different_media' }
  | { kind: 'media_in_use'; videoId: string | null }
  | { kind: 'media_not_found' }

const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Where the refusal's fields live: FastAPI's `HTTPException(detail={…})` nests
 * them under `detail`; a `JSONResponse` puts them at the top level. Both read.
 */
function refusalFields(body: unknown): Record<string, unknown> | null {
  const top = objectOrNull(body)
  const nested = objectOrNull(top?.detail)
  if (typeof nested?.reason === 'string') return nested
  return typeof top?.reason === 'string' ? top : null
}

/**
 * What "Locate…" came to. Only `confirm` asks anything of the card (the inline
 * "link anyway?"); every failure has already been toasted by the time it lands.
 */
export type LocateOutcome =
  | { kind: 'done' }
  | { kind: 'cancelled' }
  | { kind: 'failed' }
  | { kind: 'confirm'; path: string }

/** Map a non-2xx relink answer onto the refusal it is, or null for any other failure. */
export function relinkRefusal(status: number, body: unknown): RelinkRefusal | null {
  const fields = refusalFields(body)
  if (!fields) return null
  if (status === HTTP_CONFLICT && fields.reason === 'different_media') {
    return { kind: 'different_media' }
  }
  if (status === HTTP_CONFLICT && fields.reason === 'media_in_use') {
    const id = fields.video_id
    return { kind: 'media_in_use', videoId: typeof id === 'string' && id !== '' ? id : null }
  }
  if (status === HTTP_UNPROCESSABLE && fields.reason === 'media_not_found') {
    return { kind: 'media_not_found' }
  }
  return null
}

/** The user-facing sentence for each refusal (the card confirms `different_media` inline). */
export function relinkRefusalMessage(refusal: RelinkRefusal): string {
  switch (refusal.kind) {
    case 'different_media':
      return 'That file is different media from the one this video was made from.'
    case 'media_in_use':
      return 'That file already belongs to another video in the library.'
    case 'media_not_found':
      return 'That file could not be found.'
  }
}

// ── Drops ───────────────────────────────────────────────────────────────────

/** One dropped entry, already resolved to a path through the preload bridge. */
export interface DroppedItem {
  name: string
  /** Null when the bridge could not resolve a path (not a file on disk). */
  path: string | null
  isDirectory: boolean
}

export type DropPlan =
  | { kind: 'none' }
  | { kind: 'folder'; path: string }
  | { kind: 'open'; path: string; skipped: string[] }
  | { kind: 'files'; paths: string[]; skipped: string[] }
  | { kind: 'rejected'; message: string }

/** Reported when something that is not media is dropped on the library. */
export function droppedNotMediaMessage(name: string): string {
  return `${name} is not a video or audio file CapForge can open.`
}

export const DROP_ONE_FOLDER_MESSAGE =
  'Drop one folder at a time — or drop video files on their own.'

/** Names of dropped files that were left out because they are not media. */
export function droppedSkippedMessage(skipped: readonly string[]): string {
  return `Skipped ${plural(skipped.length, 'file')} that ${skipped.length === 1 ? 'is' : 'are'} not video or audio: ${skipped.join(', ')}`
}

/**
 * What a drop on the library means. One media file keeps "open in the
 * editor"; several import without opening; a single folder imports the folder.
 * A folder mixed with anything else is refused rather than half-done.
 */
export function droppedImport(items: readonly DroppedItem[]): DropPlan {
  const usable = items.filter((item): item is DroppedItem & { path: string } => !!item.path)
  if (usable.length === 0) return { kind: 'none' }

  if (usable.some((item) => item.isDirectory)) {
    return usable.length === 1
      ? { kind: 'folder', path: usable[0].path }
      : { kind: 'rejected', message: DROP_ONE_FOLDER_MESSAGE }
  }

  const media = usable.filter((item) => isMediaPath(item.path))
  const skipped = usable.filter((item) => !isMediaPath(item.path)).map((item) => item.name)
  if (media.length === 0) {
    const what = usable.length === 1 ? usable[0].name : `None of the ${usable.length} dropped files`
    const message =
      usable.length === 1
        ? droppedNotMediaMessage(what)
        : `${what} is a video or audio file CapForge can open.`
    return { kind: 'rejected', message }
  }
  if (media.length === 1) return { kind: 'open', path: media[0].path, skipped }
  return { kind: 'files', paths: media.map((item) => item.path), skipped }
}

/** The members of a `DataTransferItem` the drop reads — structural, so tests pass fakes. */
export interface DropItemLike<F> {
  kind: string
  getAsFile: () => F | null
  webkitGetAsEntry?: () => { isDirectory: boolean } | null
}

export interface DropTransferLike<F> {
  items?: ArrayLike<DropItemLike<F>> | null
  files?: ArrayLike<F> | null
}

/**
 * Turn a drop's `DataTransfer` into `DroppedItem`s. Must run synchronously in
 * the drop handler (the transfer is emptied afterwards). `webkitGetAsEntry`
 * is the only thing that tells a folder from a file; `pathOf` is the preload's
 * `getPathForFile`, which resolves folders as well as files.
 */
export function droppedItemsOf<F extends { name: string }>(
  transfer: DropTransferLike<F>,
  pathOf: (file: F) => string | null | undefined
): DroppedItem[] {
  const toItem = (file: F, isDirectory: boolean): DroppedItem => ({
    name: file.name,
    path: pathOf(file) || null,
    isDirectory,
  })
  if (transfer.items && transfer.items.length > 0) {
    return Array.from(transfer.items).flatMap((item) => {
      if (item.kind !== 'file') return []
      const file = item.getAsFile()
      if (!file) return []
      return [toItem(file, item.webkitGetAsEntry?.()?.isDirectory === true)]
    })
  }
  return Array.from(transfer.files ?? []).map((file) => toItem(file, false))
}

// ── Watch folder ────────────────────────────────────────────────────────────

export const NOT_WATCHING = 'Not watching'
export const WATCH_STATUS_LOADING = 'Checking…'
export const WATCH_FOLDER_UNAVAILABLE = 'Folder not available'
export const WATCH_FOLDER_HELP =
  'New recordings saved here become library videos while CapForge is open. Nothing is transcribed automatically.'

export interface WatchFolderView {
  label: string
  watching: boolean
  /** A secondary line: the folder is unavailable, or what the watcher imported. */
  note: string | null
}

/** What the Settings row shows for a watch status (null while it loads). */
export function watchFolderView(status: WatchStatus | null): WatchFolderView {
  if (!status) return { label: WATCH_STATUS_LOADING, watching: false, note: null }
  if (!status.folder) return { label: NOT_WATCHING, watching: false, note: null }
  let note: string | null = null
  if (!status.available) note = WATCH_FOLDER_UNAVAILABLE
  else if (status.importedCount > 0) {
    note = `${plural(status.importedCount, 'video')} imported since CapForge opened`
  }
  return { label: status.folder, watching: true, note }
}
