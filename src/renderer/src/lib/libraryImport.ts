/**
 * Import (the picker and drops), "Locate…" relink and the watch folder — the
 * decisions and the copy, kept pure so the node-environment tests can pin
 * every branch (docs/plans/library-folder-import.md).
 *
 * Nothing here scans, fetches or decides what a record *is*: the backend owns
 * dedupe (fingerprints) and the relink rules. This module only sorts what was
 * picked or dropped (`importPlan`), which refusal a relink hit, and what the
 * watch folder row says. The combined import toast is `libraryImportSummary.ts`.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { WatchStatus } from './libraryTypes'
import { isMediaPath } from './libraryView'

/**
 * `POST /api/library/import-paths` accepts 1..500 paths and answers `422`
 * beyond that. This is the route's request limit, which the renderer has to
 * respect before sending — not the scan caps, which stay backend-only.
 */
export const IMPORT_PATHS_MAX = 500

/** The CapForge project extension, dotless like `MEDIA_EXTENSIONS`. */
export const PROJECT_EXTENSION = 'capforge'

/** The last segment of a path, ignoring a trailing separator. */
export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  return trimmed.split(/[\\/]/).pop() ?? trimmed
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The paths one `import-paths` request may carry, and whether any were left out. */
export function importPathsBatch(paths: readonly string[]): {
  paths: string[]
  truncated: boolean
} {
  return { paths: paths.slice(0, IMPORT_PATHS_MAX), truncated: paths.length > IMPORT_PATHS_MAX }
}

/** True for a `.capforge` project file, case-insensitively. The dot is required. */
export function isProjectPath(path: string): boolean {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
}

// ── The import plan (picks and drops) ───────────────────────────────────────

/**
 * What the Import… picker opens: files and folders in one dialog (`any`,
 * macOS only), or `files` / `folder` from the menu Windows and Linux get.
 * Mirrors `ImportPickMode` in `src/preload/index.ts`.
 */
export type ImportPickMode = 'any' | 'files' | 'folder'

/** One path the Import… picker returned, stat'ed by Electron main. */
export interface PickedEntry {
  path: string
  kind: 'file' | 'directory'
}

/** Reported when the picker's IPC answer is not the documented shape. */
export const PICKER_ANSWER_INVALID = 'The import picker answered with something unexpected.'

function isPickedEntry(value: unknown): value is PickedEntry {
  if (typeof value !== 'object' || value === null) return false
  const { path, kind } = value as Record<string, unknown>
  return typeof path === 'string' && path !== '' && (kind === 'file' || kind === 'directory')
}

/**
 * The boundary guard for `window.subforge.pickImport`'s answer. A malformed
 * answer throws (and is toasted) rather than quietly importing part of it.
 */
export function pickedEntriesOf(value: unknown): PickedEntry[] {
  if (!Array.isArray(value) || !value.every(isPickedEntry)) throw new Error(PICKER_ANSWER_INVALID)
  return value.map((entry) => ({ path: entry.path, kind: entry.kind }))
}

/**
 * What an import will do: every folder is its own `import-folder` request,
 * the media files are one `import-paths` batch (cut at the route limit,
 * `mediaTruncated`), every project is its own `import-project`, and anything
 * else is only named, by file name, in the summary.
 */
export interface ImportPlan {
  folders: string[]
  media: string[]
  mediaTruncated: boolean
  projects: string[]
  skipped: string[]
}

export function importPlan(picked: readonly PickedEntry[]): ImportPlan {
  const files = picked.filter((entry) => entry.kind === 'file').map((entry) => entry.path)
  const batch = importPathsBatch(files.filter((path) => isMediaPath(path)))
  return {
    folders: picked.filter((entry) => entry.kind === 'directory').map((entry) => entry.path),
    media: batch.paths,
    mediaTruncated: batch.truncated,
    projects: files.filter((path) => !isMediaPath(path) && isProjectPath(path)),
    skipped: files
      .filter((path) => !isMediaPath(path) && !isProjectPath(path))
      .map((path) => pathBaseName(path)),
  }
}

/** True when a plan has nothing to import and nothing to report. */
export function isEmptyPlan(plan: ImportPlan): boolean {
  return plan.folders.length + plan.media.length + plan.projects.length + plan.skipped.length === 0
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
  | { kind: 'open'; path: string; skipped: string[] }
  | { kind: 'import'; plan: ImportPlan }
  | { kind: 'rejected'; message: string }

/** Reported when something that is not media is dropped on the library. */
export function droppedNotMediaMessage(name: string): string {
  return `${name} is not a video or audio file CapForge can open.`
}

/** Names of dropped files that were left out because they are not media. */
export function droppedSkippedMessage(skipped: readonly string[]): string {
  return `Skipped ${plural(skipped.length, 'file')} that ${skipped.length === 1 ? 'is' : 'are'} not video or audio: ${skipped.join(', ')}`
}

/**
 * What a drop on the library means — sorted by `importPlan`, like a pick. One
 * media file (and no folder or project) keeps "open in the editor", naming
 * any non-media beside it. Otherwise folders, several files and projects are
 * all imported together; a drop with nothing importable is refused.
 */
export function droppedImport(items: readonly DroppedItem[]): DropPlan {
  const usable = items.filter((item): item is DroppedItem & { path: string } => !!item.path)
  if (usable.length === 0) return { kind: 'none' }

  const plan = importPlan(
    usable.map((item) => ({ path: item.path, kind: item.isDirectory ? 'directory' : 'file' }))
  )
  const onlyFiles = plan.folders.length === 0 && plan.projects.length === 0
  if (onlyFiles && plan.media.length === 1) {
    return { kind: 'open', path: plan.media[0], skipped: plan.skipped }
  }
  if (onlyFiles && plan.media.length === 0) {
    const message =
      usable.length === 1
        ? droppedNotMediaMessage(usable[0].name)
        : `None of the ${usable.length} dropped files is a video or audio file CapForge can open.`
    return { kind: 'rejected', message }
  }
  return { kind: 'import', plan }
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
