/**
 * Create a collection by name, inline: the library toolbar's popover, the
 * empty state, and a card's "Move to collection… → New collection…" all mount
 * this one form. Electron has no `window.prompt`, and a native dialog would be
 * untestable in the node test environment anyway.
 *
 * Enter submits (it is a real `<form>`), Esc cancels. What a failure means is
 * decided in `lib/collectionCreate.ts`: an existing id or a `422` comes back as
 * `invalid` and shows under the input; anything else has already been toasted.
 */

import { useId, useState } from 'react'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import { canCreateCollection, newCollectionHint } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { COLLECTION_NAME_MAX_LENGTH } from '../../lib/collections'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'

export interface NewCollectionFormViewProps {
  name: string
  /** Shown under the input; null when there is nothing to say. */
  error: string | null
  /** A create is in flight. */
  busy: boolean
  onNameChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}

/** Presentational, so every state renders to static markup. */
export function NewCollectionFormView({
  name,
  error,
  busy,
  onNameChange,
  onSubmit,
  onCancel,
}: NewCollectionFormViewProps) {
  const errorId = useId()
  const hint = newCollectionHint(name)
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <input
        type="text"
        className="field-input placeholder-subtle"
        aria-label="Collection name"
        placeholder="e.g. UCK 26"
        maxLength={COLLECTION_NAME_MAX_LENGTH}
        value={name}
        // The form only exists because the user just asked for it.
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onNameChange(e.target.value)}
      />
      {error && (
        <p id={errorId} role="alert" className="text-2xs" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
      {hint && (
        <p
          className="truncate text-2xs"
          title={hint}
          style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
        >
          {hint}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" className="whitespace-nowrap text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          className="whitespace-nowrap text-xs"
          disabled={!canCreateCollection(name, false)}
          loading={busy}
        >
          Create
        </Button>
      </div>
    </form>
  )
}

export interface NewCollectionFormProps {
  /** Never rejects by contract (`runCreateCollection`). */
  onCreate: (name: string) => Promise<CreateCollectionResult>
  onCreated: (collection: CollectionSummary) => void
  onCancel: () => void
}

export function NewCollectionForm({ onCreate, onCreated, onCancel }: NewCollectionFormProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function submit() {
    if (!canCreateCollection(name, busy)) return
    setBusy(true)
    setError(null)
    onCreate(name).then(
      (result) => {
        setBusy(false)
        if (result.kind === 'created') onCreated(result.collection)
        if (result.kind === 'invalid') setError(result.message)
      },
      (err: unknown) => {
        // Outside the contract, but never swallowed: say it where the user is looking.
        setBusy(false)
        setError(err instanceof Error ? err.message : String(err))
      }
    )
  }

  return (
    <NewCollectionFormView
      name={name}
      error={error}
      busy={busy}
      onNameChange={(next) => {
        setName(next)
        setError(null)
      }}
      onSubmit={submit}
      onCancel={onCancel}
    />
  )
}

const POPOVER_ALIGN = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
} as const

export interface NewCollectionPopoverProps {
  onCreate: (name: string) => Promise<CreateCollectionResult>
  onCreated: (collection: CollectionSummary) => void
  /** Where the popover hangs from its button. */
  align?: keyof typeof POPOVER_ALIGN
  /** Start open — for static-markup tests. */
  defaultOpen?: boolean
}

/** "New collection…" and the small popover it opens. */
export function NewCollectionPopover({
  onCreate,
  onCreated,
  align = 'start',
  defaultOpen = false,
}: NewCollectionPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="whitespace-nowrap text-xs"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        New collection…
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="New collection"
          className={cn('absolute top-full z-20 mt-2 w-64 rounded-lg p-3', POPOVER_ALIGN[align])}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <NewCollectionForm
            onCreate={onCreate}
            onCreated={(collection) => {
              setOpen(false)
              onCreated(collection)
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
