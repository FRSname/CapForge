/**
 * Remove or Delete for a multi-selection (docs/plans/library-finder.md §4.4).
 *
 * Each video goes through the one-record path a card's menu uses
 * (`useLibraryActions`: `DELETE ?mode=remove`, or `?mode=detach` then Electron
 * trashes the folder), one after another; one failure never stops the rest.
 * The list and the folders (their counts) are refreshed **once** at the end,
 * and every failure is told in **one** summary. Nothing is swallowed.
 *
 * Folders are never removed or deleted in bulk: a folder's Delete refuses one
 * with videos or subfolders and lives in its own menu. With a folder in the
 * selection the two actions are disabled, with the reason.
 *
 * I/O is injected, so all of it runs in the node test environment.
 */

import type { LibraryVideo } from './libraryTypes'
import { plural } from './libraryImport'
import { displayTitle } from './libraryView'

export type BulkKind = 'remove' | 'delete'

type BulkVideo = Pick<LibraryVideo, 'id' | 'title' | 'sourcePath'>

export function removeFailedMessage(title: string, reason: string): string {
  return `Could not remove ${title} from the library: ${reason}`
}

export function deleteFailedMessage(title: string, reason: string): string {
  return `Could not delete ${title}: ${reason}`
}

/** Why Remove and Delete are disabled while a folder is selected. */
export const FOLDERS_BLOCK_BULK =
  "Folders can't be removed — deselect them or delete them from their menu."

export const NO_VIDEO_SELECTED = 'Select a video first.'

/** Why Remove / Delete is disabled for this selection, or null. */
export function bulkBlocker(parts: {
  folderIds: readonly string[]
  videoIds: readonly string[]
}): string | null {
  if (parts.folderIds.length > 0) return FOLDERS_BLOCK_BULK
  return parts.videoIds.length === 0 ? NO_VIDEO_SELECTED : null
}

/** The inline confirm's question, naming the count. */
export function bulkConfirmPrompt(kind: BulkKind, count: number): string {
  const videos = plural(count, 'video')
  return kind === 'remove'
    ? `Remove ${videos} from the library? Their files are kept.`
    : `Delete ${videos}? Their library folders go to the Trash.`
}

export const BULK_CONFIRM_LABEL: Readonly<Record<BulkKind, string>> = {
  remove: 'Remove',
  delete: 'Delete',
}

/** One toast for a batch: a lone video keeps its own message. */
export function bulkFailedMessage(
  kind: BulkKind,
  failures: readonly string[],
  total: number
): string {
  if (total <= 1 && failures.length === 1) return failures[0]
  const verb = kind === 'remove' ? 'remove' : 'delete'
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : ''
  return `Couldn't ${verb} ${failures.length} of ${total}: ${failures[0]}${more}`
}

export interface BulkRecordDeps {
  /** One record's remove; rejects on failure. */
  removeOne: (video: BulkVideo) => Promise<void>
  /** One record's detach + trash; rejects on failure. */
  deleteOne: (video: BulkVideo) => Promise<void>
  /** Re-read the library list; reports its own failures. */
  refresh: () => Promise<void>
  /** Re-read the folders; reports its own failures. */
  refreshCollections: () => Promise<void>
  notify: (message: string) => void
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Never rejects; returns how many records went. */
export async function runBulkRecords(
  kind: BulkKind,
  videos: readonly BulkVideo[],
  deps: BulkRecordDeps
): Promise<number> {
  if (videos.length === 0) return 0
  const failures: string[] = []
  const one = kind === 'remove' ? deps.removeOne : deps.deleteOne
  const failed = kind === 'remove' ? removeFailedMessage : deleteFailedMessage
  let done = 0
  for (const video of videos) {
    try {
      await one(video)
      done += 1
    } catch (err) {
      failures.push(failed(displayTitle(video), reasonOf(err)))
    }
  }
  await deps.refresh()
  await deps.refreshCollections()
  if (failures.length > 0) deps.notify(bulkFailedMessage(kind, failures, videos.length))
  return done
}
