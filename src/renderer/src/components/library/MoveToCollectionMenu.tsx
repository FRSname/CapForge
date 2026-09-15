/**
 * A library card's "Move to collection…" sub-list: None, every collection
 * (the current one checked) and "New collection…", which swaps the list for
 * the shared name form and moves the video into what it creates.
 *
 * Presentational apart from that one toggle; the move itself (read the rev,
 * PATCH with `If-Match`, retry once on a 409) is `lib/collectionMove.ts`.
 */

import { useState } from 'react'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import { moveMenuOptions } from '../../lib/collectionMove'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { MenuItem } from './LibraryMenuParts'
import { NewCollectionForm } from './NewCollectionForm'

/** React key for the None row, which has no id. */
const NONE_KEY = ':none'

export interface MoveToCollectionMenuProps {
  collections: readonly CollectionSummary[]
  /** The record's `collection_id`. */
  currentId: string | null
  /** A row was picked, or a new collection was created (its id). */
  onPick: (collectionId: string | null) => void
  onCreate: (name: string) => Promise<CreateCollectionResult>
  /** Back to the card's main actions. */
  onBack: () => void
  /** Start on the name form — for static-markup tests. */
  defaultCreating?: boolean
}

export function MoveToCollectionMenu({
  collections,
  currentId,
  onPick,
  onCreate,
  onBack,
  defaultCreating = false,
}: MoveToCollectionMenuProps) {
  const [creating, setCreating] = useState(defaultCreating)

  if (creating) {
    return (
      <div className="px-1.5 py-1">
        <NewCollectionForm
          onCreate={onCreate}
          onCreated={(collection) => onPick(collection.id)}
          onCancel={() => setCreating(false)}
        />
      </div>
    )
  }

  return (
    <div role="group" aria-label="Move to collection" className="flex flex-col">
      <button
        type="button"
        role="menuitem"
        aria-label="Back to record actions"
        className="flex items-center gap-1 rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
        style={{ color: 'var(--color-text-3)' }}
        onClick={onBack}
      >
        <span aria-hidden="true">‹</span>
        <span>Move to collection</span>
      </button>
      <div className="flex max-h-56 flex-col overflow-y-auto">
        {moveMenuOptions(collections, currentId).map((option) => (
          <button
            key={option.id ?? NONE_KEY}
            type="button"
            role="menuitemradio"
            aria-checked={option.checked}
            title={option.label}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
            style={{ color: 'var(--color-text)' }}
            onClick={() => onPick(option.id)}
          >
            <span
              aria-hidden="true"
              className="w-3 shrink-0"
              style={{ color: 'var(--color-brand)' }}
            >
              {option.checked ? '✓' : ''}
            </span>
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        ))}
      </div>
      <MenuItem label="New collection…" onClick={() => setCreating(true)} />
    </div>
  )
}
