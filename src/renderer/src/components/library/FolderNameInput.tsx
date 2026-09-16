/**
 * A folder's name, edited in place (docs/plans/library-finder.md §4.5): Enter
 * or leaving the field saves, Esc cancels, and an empty name is refused under
 * the input and never sent. A refusal the backend answers inline (a `422`)
 * stays under the input too; anything else was toasted and the input closes.
 */

import { useId, useRef, useState } from 'react'
import { COLLECTION_NAME_MAX_LENGTH } from '../../lib/collections'
import { renameProblem } from '../../lib/folderMenu'
import type { FolderEntry } from '../../lib/libraryLocation'
import type { FolderItemUi } from './folderItemUi'

export interface FolderNameInputProps {
  folder: FolderEntry
  ui: FolderItemUi
  /** Starting error — for static-markup tests. */
  defaultError?: string | null
}

export function FolderNameInput({ folder, ui, defaultError = null }: FolderNameInputProps) {
  const [name, setName] = useState(folder.name)
  const [error, setError] = useState<string | null>(defaultError)
  // A save in flight, or the input already closed (saved or cancelled): the
  // blur that can follow Enter, Esc or the unmount must not save again.
  const busyRef = useRef(false)
  const closedRef = useRef(false)
  const errorId = useId()

  function close() {
    closedRef.current = true
    ui.onStopRename()
  }

  function save() {
    if (busyRef.current || closedRef.current) return
    const problem = renameProblem(name)
    if (problem) {
      setError(problem)
      return
    }
    busyRef.current = true
    void ui.onRename(folder.id, name).then((result) => {
      busyRef.current = false
      if (result.kind === 'invalid') setError(result.message)
      else close()
    })
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        type="text"
        className="field-input text-xs"
        aria-label={`Rename folder ${folder.name}`}
        maxLength={COLLECTION_NAME_MAX_LENGTH}
        value={name}
        // The input only exists because the user just chose Rename.
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') close()
        }}
        onBlur={save}
      />
      {error && (
        <span
          id={errorId}
          role="alert"
          className="text-2xs"
          style={{ color: 'var(--color-danger)' }}
        >
          {error}
        </span>
      )}
    </span>
  )
}
