/**
 * The library card/toolbar actions that touch the backend: removing a record,
 * deleting one, importing (the Import… picker and drops), and relinking a
 * record whose media moved.
 *
 * Lives outside App because App is at its size ceiling (§9.3) and because the
 * delete is a two-party operation worth keeping in one place: **the backend
 * never deletes user files**. `DELETE ?mode=detach` un-indexes the record and
 * answers with its folder; Electron is what moves that folder to the Trash,
 * through a guard that refuses anything outside the library root.
 *
 * An import runs every request its plan (`importPlan`) calls for — a folder
 * import per folder, one batch of media files, a project import per
 * `.capforge` — and then shows **one** summary through `inform`, with the tone
 * it earned (`libraryImportSummary.ts`). A request that fails is named inside
 * that summary rather than toasted on its own; one failure never stops the rest.
 * Every other failure is toasted through `notify`; none is swallowed.
 */

import { useCallback, useRef } from 'react'
import { api } from '../lib/api'
import {
  RelinkRefusedError,
  importLibraryFolder,
  importLibraryPaths,
  relinkLibraryRecord,
} from '../lib/libraryApi'
import type { ImportPickMode, ImportPlan, LocateOutcome, PickedEntry } from '../lib/libraryImport'
import {
  importPlan,
  isEmptyPlan,
  pathBaseName,
  pickedEntriesOf,
  plural,
  relinkRefusalMessage,
} from '../lib/libraryImport'
import type { ImportTally, ImportTone } from '../lib/libraryImportSummary'
import {
  importSummary,
  importTally,
  importTone,
  tallyError,
  tallyFolderResult,
  tallyProject,
} from '../lib/libraryImportSummary'
import type { FolderImportResult, LibraryVideo } from '../lib/libraryTypes'
import { displayTitle } from '../lib/libraryView'

export interface LibraryActionsInput {
  /** Re-read the list after a record appears or disappears. */
  refresh: () => Promise<void>
  /** App's toast relay — every failure here is reported, none swallowed. */
  notify: (message: string) => void
  /** The import summary, shown with the tone it earned (success / info / error). */
  inform: (message: string, tone: ImportTone) => void
}

export interface LibraryActions {
  /** Hide the record; every file it holds is kept. */
  removeRecord: (video: LibraryVideo) => Promise<void>
  /** Un-index the record and move its folder to the Trash. */
  deleteRecord: (video: LibraryVideo) => Promise<void>
  /** Import…: open the picker in `mode`, then import everything picked. */
  pickAndImport: (mode: ImportPickMode) => Promise<void>
  /** Run an import plan (a drop), toast one summary, refresh once. */
  runImport: (plan: ImportPlan) => Promise<void>
  /** Pick a file for a record whose media is missing and relink it. Never rejects. */
  locate: (video: LibraryVideo) => Promise<LocateOutcome>
  /** The user confirmed a different-media relink. */
  forceLocate: (video: LibraryVideo, path: string) => Promise<void>
}

export function removeFailedMessage(title: string, reason: string): string {
  return `Could not remove ${title} from the library: ${reason}`
}

export function deleteFailedMessage(title: string, reason: string): string {
  return `Could not delete ${title}: ${reason}`
}

export function importPickerFailedMessage(reason: string): string {
  return `Could not open the import picker: ${reason}`
}

export function locateFailedMessage(title: string, reason: string): string {
  return `Could not locate the media for ${title}: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The three backend calls an import plan makes — injected so the sequencing is testable. */
export interface ImportRequests {
  importFolder: (path: string) => Promise<FolderImportResult>
  importPaths: (paths: readonly string[]) => Promise<FolderImportResult>
  importProject: (path: string) => Promise<unknown>
}

/**
 * Run every request a plan calls for, one at a time (folders, then the media
 * batch, then projects), and add up what happened. Never rejects: a failed
 * request is tallied as an error, naming what it was for, and the rest carry on.
 */
export async function executeImportPlan(
  plan: ImportPlan,
  requests: ImportRequests
): Promise<ImportTally> {
  let tally = importTally(plan)
  for (const folder of plan.folders) {
    try {
      const result = await requests.importFolder(folder)
      tally = tallyFolderResult(tally, result)
    } catch (err) {
      tally = tallyError(tally, pathBaseName(folder), reasonOf(err))
    }
  }
  if (plan.media.length > 0) {
    try {
      const result = await requests.importPaths(plan.media)
      tally = tallyFolderResult(tally, result)
    } catch (err) {
      tally = tallyError(tally, plural(plan.media.length, 'file'), reasonOf(err))
    }
  }
  for (const project of plan.projects) {
    try {
      await requests.importProject(project)
      tally = tallyProject(tally)
    } catch (err) {
      tally = tallyError(tally, pathBaseName(project), reasonOf(err))
    }
  }
  return tally
}

const IMPORT_REQUESTS: ImportRequests = {
  importFolder: (path) => importLibraryFolder(path),
  importPaths: (paths) => importLibraryPaths(paths),
  importProject: (path) => api.importLibraryProject(path),
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

  const runImport = useCallback(async (plan: ImportPlan): Promise<void> => {
    if (isEmptyPlan(plan)) return
    const tally = await executeImportPlan(plan, IMPORT_REQUESTS)
    inputRef.current.inform(importSummary(tally), importTone(tally))
    await inputRef.current.refresh()
  }, [])

  const pickAndImport = useCallback(
    async (mode: ImportPickMode): Promise<void> => {
      let picked: PickedEntry[]
      try {
        picked = pickedEntriesOf(await window.subforge.pickImport(mode))
      } catch (err) {
        inputRef.current.notify(importPickerFailedMessage(reasonOf(err)))
        return
      }
      if (picked.length === 0) return
      await runImport(importPlan(picked))
    },
    [runImport]
  )

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
    pickAndImport,
    runImport,
    locate,
    forceLocate,
  }
}
