/**
 * The video rename's transport: `runRenameRecord` (`lib/recordRename.ts`)
 * bound to the record routes, the list refresh and the toast relay. The
 * decisions — the rev read, the single 409 retry, what stays under the input
 * and what is toasted — are all in the lib, where the node tests reach them.
 */

import { useCallback, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import type { LibraryVideo } from '../lib/libraryTypes'
import type { RenameRecordResult } from '../lib/recordRename'
import { runRenameRecord } from '../lib/recordRename'

export interface RecordRenameInput {
  /** Re-read the library list after a rename. */
  refresh: () => Promise<void>
  /** Error toast. */
  notify: (message: string) => void
}

export type RenameVideo = (video: LibraryVideo, name: string) => Promise<RenameRecordResult>

export function useRecordRename(input: RecordRenameInput): RenameVideo {
  const inputRef = useRef(input)
  useEffect(() => {
    inputRef.current = input
  })

  return useCallback(
    (video: LibraryVideo, name: string) =>
      runRenameRecord(video, name, {
        read: (id) => api.getLibraryRecord(id),
        write: (id, patch, rev) => api.patchLibraryRecord(id, patch, rev),
        refresh: () => inputRef.current.refresh(),
        notify: (message) => inputRef.current.notify(message),
      }),
    []
  )
}
