/**
 * Renaming a video in place (docs/plans/library-finder.md §4.5): its root
 * `title`, the library name the backend bridges into the primary channel's
 * post.
 *
 * The list carries no `rev`, so the save reads the record for it and PATCHes
 * `{title}` with `If-Match`. A `409` means the record moved on between the read
 * and the write (the agent, an autosave): it re-reads and retries **once**, and
 * a second `409` is toasted rather than looped on. A `422` (a hard rule, e.g.
 * too long) stays under the input. An empty name is refused inline and an
 * unchanged one closes the input; neither sends a request.
 *
 * I/O is injected, so all of it runs in the node test environment.
 */

import { StaleRecordError, ValidationRefusedError } from './api'
import type { LibraryVideo } from './libraryTypes'
import { displayTitle } from './libraryView'

export const BLANK_TITLE_MESSAGE = 'A video needs a name.'

export type RenameRecordResult =
  | { kind: 'renamed' }
  /** Shown under the name input, which stays open. */
  | { kind: 'invalid'; message: string }
  /** Already toasted. */
  | { kind: 'failed' }

export interface RenameRecordDeps {
  read: (videoId: string) => Promise<{ rev: number; title: string }>
  write: (videoId: string, patch: { title: string }, rev: number) => Promise<unknown>
  /** Re-read the library list; reports its own failures. */
  refresh: () => Promise<void>
  notify: (message: string) => void
}

type RenamedVideo = Pick<LibraryVideo, 'id' | 'title' | 'sourcePath'>

/** Why a title cannot be sent, or null. */
export function titleProblem(name: string): string | null {
  return name.trim() === '' ? BLANK_TITLE_MESSAGE : null
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function writeTitle(videoId: string, title: string, deps: RenameRecordDeps): Promise<void> {
  const record = await deps.read(videoId)
  if (record.title === title) return
  await deps.write(videoId, { title }, record.rev)
}

async function writeWithRetry(videoId: string, title: string, deps: RenameRecordDeps) {
  try {
    await writeTitle(videoId, title, deps)
    return
  } catch (err) {
    if (!(err instanceof StaleRecordError)) throw err
  }
  await writeTitle(videoId, title, deps)
}

function refusalOf(err: ValidationRefusedError): string {
  const messages = err.violations.map((v) => v.message).filter((m) => m !== '')
  return messages.length > 0 ? messages.join(' ') : err.message
}

/** Never rejects. */
export async function runRenameRecord(
  video: RenamedVideo,
  name: string,
  deps: RenameRecordDeps
): Promise<RenameRecordResult> {
  const title = name.trim()
  const problem = titleProblem(title)
  if (problem) return { kind: 'invalid', message: problem }
  const shown = displayTitle(video)
  if (title === shown) return { kind: 'renamed' }
  try {
    await writeWithRetry(video.id, title, deps)
  } catch (err) {
    if (err instanceof ValidationRefusedError) return { kind: 'invalid', message: refusalOf(err) }
    const reason =
      err instanceof StaleRecordError
        ? 'the record kept changing while it was being saved — try again.'
        : reasonOf(err)
    deps.notify(`Could not rename ${shown}: ${reason}`)
    return { kind: 'failed' }
  }
  await deps.refresh()
  return { kind: 'renamed' }
}
