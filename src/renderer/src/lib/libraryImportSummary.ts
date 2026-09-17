/**
 * The one toast an Add to library… (or a drop) ends with. An import runs several
 * requests — a folder import per folder, one batch of media files, a project
 * import per `.capforge` — and the user gets **one** summary of all of them,
 * so the results are added up in an `ImportTally` as they land and read once.
 *
 * A request that failed outright (a folder the backend refused, the backend
 * down) is not swallowed: it is named, with its reason, inside that summary,
 * and it decides the tone when nothing else landed.
 *
 * Pure module: no React, no `window`, no I/O. Every `tally*` returns a new tally.
 */

import type { ImportPlan } from './libraryImport'
import { pathBaseName, plural } from './libraryImport'
import type { FolderImportFailure, FolderImportResult } from './libraryTypes'

/** Appended to a summary whose import stopped before the end. */
export const IMPORT_STOPPED_EARLY_NOTE =
  'The scan stopped early — import the remaining files or subfolders on their own.'

/** How many failed file names (and failed requests) a summary spells out before counting the rest. */
export const MAX_NAMED_FAILURES = 2

/** How many skipped file names a summary spells out before counting the rest. */
export const MAX_NAMED_SKIPPED = 3

/** Shown when a mixed import found nothing at all. */
export const NOTHING_FOUND = 'No media found'

const SUMMARY_SEPARATOR = ' · '

/** A request that failed as a whole: what it was for (a folder or file name) and why. */
export interface ImportError {
  name: string
  reason: string
}

export interface ImportTally {
  created: number
  existing: number
  relinked: number
  /** `.capforge` files adopted as records. */
  projects: number
  /** Files a folder or batch import could not read (the backend's `failed`). */
  failed: FolderImportFailure[]
  /** Requests that failed as a whole. */
  errors: ImportError[]
  /** Picked or dropped files that are neither media nor a project. */
  skipped: string[]
  truncated: boolean
  /** The folder's name when the import was that one folder alone; else null. */
  folderName: string | null
}

/** The toast type an import summary is shown with (`useToast`'s `ToastType`). */
export type ImportTone = 'success' | 'info' | 'error'

/** A fresh tally for a plan: its skipped names, its batch cut, and its one-folder label. */
export function importTally(plan: ImportPlan): ImportTally {
  const oneFolder =
    plan.folders.length === 1 &&
    plan.media.length + plan.projects.length + plan.skipped.length === 0
  return {
    created: 0,
    existing: 0,
    relinked: 0,
    projects: 0,
    failed: [],
    errors: [],
    skipped: [...plan.skipped],
    truncated: plan.mediaTruncated,
    folderName: oneFolder ? pathBaseName(plan.folders[0]) : null,
  }
}

/** Add one `import-folder` or `import-paths` answer. */
export function tallyFolderResult(tally: ImportTally, result: FolderImportResult): ImportTally {
  return {
    ...tally,
    created: tally.created + result.created.length,
    existing: tally.existing + result.existing.length,
    relinked: tally.relinked + result.relinked.length,
    failed: [...tally.failed, ...result.failed],
    truncated: tally.truncated || result.truncated,
  }
}

/** Add one project that was imported. */
export function tallyProject(tally: ImportTally): ImportTally {
  return { ...tally, projects: tally.projects + 1 }
}

/** Add one request that failed as a whole. */
export function tallyError(tally: ImportTally, name: string, reason: string): ImportTally {
  return { ...tally, errors: [...tally.errors, { name, reason }] }
}

/** The first `max` names, then "+N more". */
function namedList(names: readonly string[], max: number): string {
  const named = names.slice(0, max)
  const rest = names.length - named.length
  return (rest > 0 ? [...named, `+${rest} more`] : named).join(', ')
}

function summaryParts(tally: ImportTally): string[] {
  const parts: string[] = []
  if (tally.created > 0) parts.push(`Imported ${plural(tally.created, 'video')}`)
  if (tally.existing > 0) parts.push(`${tally.existing} already in the library`)
  if (tally.relinked > 0) parts.push(`${tally.relinked} relinked`)
  if (tally.projects > 0) parts.push(`${plural(tally.projects, 'project')} imported`)
  if (tally.failed.length > 0) {
    const names = tally.failed.map((failure) => pathBaseName(failure.path))
    parts.push(`${tally.failed.length} could not be read (${namedList(names, MAX_NAMED_FAILURES)})`)
  }
  if (tally.errors.length > 0) {
    const names = tally.errors.map((error) => `${error.name} (${error.reason})`)
    parts.push(`Could not import ${namedList(names, MAX_NAMED_FAILURES)}`)
  }
  if (tally.skipped.length > 0) {
    const verb = tally.skipped.length === 1 ? 'is' : 'are'
    parts.push(
      `Skipped ${plural(tally.skipped.length, 'file')} that ${verb} not video, audio or a CapForge project (${namedList(tally.skipped, MAX_NAMED_SKIPPED)})`
    )
  }
  return parts
}

/**
 * The toast text: every non-empty bucket, in the order created → existing →
 * relinked → projects → unreadable files → failed requests → skipped. An
 * import of one folder that created nothing names the folder instead of
 * claiming "Imported 0 videos".
 */
export function importSummary(tally: ImportTally): string {
  const parts = summaryParts(tally)
  let summary: string
  if (parts.length === 0) {
    summary = tally.folderName ? `${NOTHING_FOUND} in ${tally.folderName}` : NOTHING_FOUND
  } else if (tally.folderName && tally.created === 0) {
    summary = `${tally.folderName}: ${parts.join(SUMMARY_SEPARATOR)}`
  } else {
    summary = parts.join(SUMMARY_SEPARATOR)
  }
  return tally.truncated ? `${summary}. ${IMPORT_STOPPED_EARLY_NOTE}` : summary
}

/**
 * `success` whenever anything landed (created, already there, relinked, or a
 * project) — a partial failure is still named inside the text; `error` when
 * nothing landed but something failed or was skipped; `info` when the import
 * found nothing at all.
 */
export function importTone(tally: ImportTally): ImportTone {
  const landed = tally.created + tally.existing + tally.relinked + tally.projects
  if (landed > 0) return 'success'
  const problems = tally.failed.length + tally.errors.length + tally.skipped.length
  return problems > 0 ? 'error' : 'info'
}
