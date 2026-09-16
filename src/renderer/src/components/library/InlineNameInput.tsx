/**
 * A name edited in place (docs/plans/library-finder.md §4.5) — a folder's or a
 * video's: Enter or leaving the field saves, Esc cancels, and a name the
 * caller's `problem` refuses (an empty one) is shown under the input and never
 * sent. A refusal the save answers inline (a `422`) stays under the input too;
 * anything else was already toasted, and the input closes.
 *
 * Esc must never turn into a save: closing unmounts the input, which blurs it,
 * so a closed (or saving) input ignores the blur that follows.
 */

import { useId, useRef, useState } from 'react'

export type InlineNameSaveResult =
  | { kind: 'renamed' }
  | { kind: 'invalid'; message: string }
  | { kind: 'failed' }

export interface InlineNameInputProps {
  initialName: string
  /** The input's accessible name: "Rename folder UCK26". */
  label: string
  maxLength?: number
  /** Why a name cannot be sent, or null. */
  problem: (name: string) => string | null
  /** Never rejects. */
  onSave: (name: string) => Promise<InlineNameSaveResult>
  /** Saved or cancelled: the caller swaps the input back for the name. */
  onClose: () => void
  /** Starting error — for static-markup tests. */
  defaultError?: string | null
}

export function InlineNameInput(props: InlineNameInputProps) {
  const [name, setName] = useState(props.initialName)
  const [error, setError] = useState<string | null>(props.defaultError ?? null)
  // A save in flight, or the input already closed (saved or cancelled): the
  // blur that can follow Enter, Esc or the unmount must not save again.
  const busyRef = useRef(false)
  const closedRef = useRef(false)
  const errorId = useId()

  function close() {
    closedRef.current = true
    props.onClose()
  }

  function save() {
    if (busyRef.current || closedRef.current) return
    const problem = props.problem(name)
    if (problem) {
      setError(problem)
      return
    }
    busyRef.current = true
    void props.onSave(name).then((result) => {
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
        aria-label={props.label}
        maxLength={props.maxLength}
        value={name}
        // The input only exists because the user just chose Rename.
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
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
