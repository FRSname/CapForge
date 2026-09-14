/**
 * The library card/toolbar actions that touch the backend: removing a record,
 * deleting one, and importing `.capforge` files.
 *
 * Lives outside App because App is at its size ceiling (§9.3) and because the
 * delete is a two-party operation worth keeping in one place: **the backend
 * never deletes user files**. `DELETE ?mode=detach` un-indexes the record and
 * answers with its folder; Electron is what moves that folder to the Trash,
 * through a guard that refuses anything outside the library root.
 */

import { useCallback, useRef } from 'react'
import { api } from '../lib/api'
import type { LibraryVideo } from '../lib/libraryTypes'

export interface LibraryActionsInput {
  /** Re-read the list after a record appears or disappears. */
  refresh: () => Promise<void>
  /** App's toast relay — every failure here is reported, none swallowed. */
  notify: (message: string) => void
}

export interface LibraryActions {
  /** Hide the record; every file it holds is kept. */
  removeRecord: (video: LibraryVideo) => Promise<void>
  /** Un-index the record and move its folder to the Trash. */
  deleteRecord: (video: LibraryVideo) => Promise<void>
  /** Pick `.capforge` files and adopt each one as a record. */
  importProjects: () => Promise<void>
}

export function removeFailedMessage(title: string, reason: string): string {
  return `Could not remove ${title} from the library: ${reason}`
}

export function deleteFailedMessage(title: string, reason: string): string {
  return `Could not delete ${title}: ${reason}`
}

export function importFailedMessage(path: string, reason: string): string {
  return `Could not import ${path}: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibraryActions({ refresh, notify }: LibraryActionsInput): LibraryActions {
  const inputRef = useRef({ refresh, notify })
  inputRef.current = { refresh, notify }

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

  return { removeRecord, deleteRecord, importProjects }
}
