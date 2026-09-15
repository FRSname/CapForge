/**
 * The library card/toolbar actions that touch the backend: removing a record,
 * deleting one, importing `.capforge` files, importing a folder (or several
 * dropped files) of media, and relinking a record whose media moved.
 *
 * Lives outside App because App is at its size ceiling (§9.3) and because the
 * delete is a two-party operation worth keeping in one place: **the backend
 * never deletes user files**. `DELETE ?mode=detach` un-indexes the record and
 * answers with its folder; Electron is what moves that folder to the Trash,
 * through a guard that refuses anything outside the library root.
 *
 * Every failure is toasted through `notify`; none is swallowed. An import's
 * *summary* goes through `inform` instead, with a tone (`folderImportTone`),
 * because "Imported 12 videos" is not an error. The pure decisions (what a
 * refused relink means, what a failed drop reports) are exported and tested.
 */

import { useCallback, useRef } from 'react'
import { api } from '../lib/api'
import {
  RelinkRefusedError,
  importLibraryFolder,
  importLibraryPaths,
  relinkLibraryRecord,
} from '../lib/libraryApi'
import type { ImportTone, LocateOutcome } from '../lib/libraryImport'
import {
  folderImportSummary,
  folderImportTone,
  importPathsBatch,
  pathBaseName,
  relinkRefusalMessage,
} from '../lib/libraryImport'
import type { FolderImportResult, LibraryVideo } from '../lib/libraryTypes'
import { displayTitle } from '../lib/libraryView'

export interface LibraryActionsInput {
  /** Re-read the list after a record appears or disappears. */
  refresh: () => Promise<void>
  /** App's toast relay — every failure here is reported, none swallowed. */
  notify: (message: string) => void
  /** An import summary, shown with the tone it earned (success / info / error). */
  inform: (message: string, tone: ImportTone) => void
}

export interface LibraryActions {
  /** Hide the record; every file it holds is kept. */
  removeRecord: (video: LibraryVideo) => Promise<void>
  /** Un-index the record and move its folder to the Trash. */
  deleteRecord: (video: LibraryVideo) => Promise<void>
  /** Pick `.capforge` files and adopt each one as a record. */
  importProjects: () => Promise<void>
  /** Import every media file under a folder; opens the picker when no path is given. */
  importFolder: (path?: string) => Promise<void>
  /** Import several dropped media files without opening any of them. */
  importFiles: (paths: readonly string[]) => Promise<void>
  /** Pick a file for a record whose media is missing and relink it. Never rejects. */
  locate: (video: LibraryVideo) => Promise<LocateOutcome>
  /** The user confirmed a different-media relink. */
  forceLocate: (video: LibraryVideo, path: string) => Promise<void>
}

/** The folder label a multi-file drop's summary uses in place of a folder name. */
export const DROPPED_FILES_LABEL = 'Dropped files'

export function removeFailedMessage(title: string, reason: string): string {
  return `Could not remove ${title} from the library: ${reason}`
}

export function deleteFailedMessage(title: string, reason: string): string {
  return `Could not delete ${title}: ${reason}`
}

export function importFailedMessage(path: string, reason: string): string {
  return `Could not import ${path}: ${reason}`
}

export function folderImportFailedMessage(folder: string, reason: string): string {
  return `Could not import the folder ${folder}: ${reason}`
}

export function filesImportFailedMessage(count: number, reason: string): string {
  return `Could not import ${count} dropped file${count === 1 ? '' : 's'}: ${reason}`
}

export function locateFailedMessage(title: string, reason: string): string {
  return `Could not locate the media for ${title}: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface LocateResult {
  outcome: LocateOutcome
  /** The toast to show, or null when the card handles it (the inline confirm). */
  message: string | null
}

/**
 * What a failed relink means. A different-media refusal asks the card to
 * confirm — unless this *was* the confirmed (forced) attempt, where a repeat
 * could only loop. Everything else is a toast naming the video.
 */
export function locateOutcomeOf(
  err: unknown,
  path: string,
  title: string,
  { forced = false }: { forced?: boolean } = {}
): LocateResult {
  if (err instanceof RelinkRefusedError) {
    if (err.refusal.kind === 'different_media' && !forced) {
      return { outcome: { kind: 'confirm', path }, message: null }
    }
    return {
      outcome: { kind: 'failed' },
      message: locateFailedMessage(title, relinkRefusalMessage(err.refusal)),
    }
  }
  return { outcome: { kind: 'failed' }, message: locateFailedMessage(title, reasonOf(err)) }
}

export function useLibraryActions({
  refresh,
  notify,
  inform,
}: LibraryActionsInput): LibraryActions {
  const inputRef = useRef({ refresh, notify, inform })
  inputRef.current = { refresh, notify, inform }

  const removeRecord = useCallback(async (video: LibraryVideo): Promise<void> => {
    try {
      await api.deleteLibraryRecord(video.id, 'remove')
      await inputRef.current.refresh()
    } catch (err) {
      inputRef.current.notify(removeFailedMessage(video.title || video.id, reasonOf(err)))
    }
  }, [])

  const deleteRecord = useCallback(async (video: LibraryVideo): Promise<void> => {
    try {
      const { folder } = await api.deleteLibraryRecord(video.id, 'detach')
      // The record is already gone from the index; the folder is ours to trash.
      if (folder) await window.subforge.trashLibraryFolder(folder)
      await inputRef.current.refresh()
    } catch (err) {
      inputRef.current.notify(deleteFailedMessage(video.title || video.id, reasonOf(err)))
    }
  }, [])

  const importProjects = useCallback(async (): Promise<void> => {
    let paths: string[]
    try {
      paths = await window.subforge.openProjectFiles()
    } catch (err) {
      inputRef.current.notify(`Could not open the project picker: ${reasonOf(err)}`)
      return
    }
    if (paths.length === 0) return

    // One bad file must not cancel the rest of the selection, so each failure is
    // reported on its own and the import carries on.
    for (const path of paths) {
      try {
        await api.importLibraryProject(path)
      } catch (err) {
        inputRef.current.notify(importFailedMessage(path, reasonOf(err)))
      }
    }
    await inputRef.current.refresh()
  }, [])

  const importFolder = useCallback(async (path?: string): Promise<void> => {
    let folder = path ?? null
    if (!folder) {
      try {
        folder = await window.subforge.pickLibraryFolder()
      } catch (err) {
        inputRef.current.notify(`Could not open the folder picker: ${reasonOf(err)}`)
        return
      }
      if (!folder) return
    }
    const name = pathBaseName(folder)
    let result: FolderImportResult
    try {
      result = await importLibraryFolder(folder)
    } catch (err) {
      inputRef.current.notify(folderImportFailedMessage(name, reasonOf(err)))
      return
    }
    inputRef.current.inform(folderImportSummary(result, name), folderImportTone(result))
    await inputRef.current.refresh()
  }, [])

  const importFiles = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (paths.length === 0) return
    // One request, capped at the route's limit; anything past it is named in
    // the summary as "stopped early" rather than silently dropped.
    const batch = importPathsBatch(paths)
    let result: FolderImportResult
    try {
      const answer = await importLibraryPaths(batch.paths)
      result = batch.truncated ? { ...answer, truncated: true } : answer
    } catch (err) {
      inputRef.current.notify(filesImportFailedMessage(batch.paths.length, reasonOf(err)))
      return
    }
    inputRef.current.inform(
      folderImportSummary(result, DROPPED_FILES_LABEL),
      folderImportTone(result)
    )
    await inputRef.current.refresh()
  }, [])

  const relink = useCallback(
    async (video: LibraryVideo, path: string, force: boolean): Promise<LocateOutcome> => {
      try {
        await relinkLibraryRecord(video.id, path, force)
      } catch (err) {
        const { outcome, message } = locateOutcomeOf(err, path, displayTitle(video), {
          forced: force,
        })
        if (message) inputRef.current.notify(message)
        return outcome
      }
      await inputRef.current.refresh()
      return { kind: 'done' }
    },
    []
  )

  const locate = useCallback(
    async (video: LibraryVideo): Promise<LocateOutcome> => {
      let path: string | null
      try {
        path = await window.subforge.pickAudioFile()
      } catch (err) {
        inputRef.current.notify(locateFailedMessage(displayTitle(video), reasonOf(err)))
        return { kind: 'failed' }
      }
      if (!path) return { kind: 'cancelled' }
      return relink(video, path, false)
    },
    [relink]
  )

  const forceLocate = useCallback(
    async (video: LibraryVideo, path: string): Promise<void> => {
      await relink(video, path, true)
    },
    [relink]
  )

  return {
    removeRecord,
    deleteRecord,
    importProjects,
    importFolder,
    importFiles,
    locate,
    forceLocate,
  }
}
