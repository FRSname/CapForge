/**
 * The selection bar (docs/plans/library-finder.md §4.4): with two or more items
 * selected — or while a keyboard Remove is being confirmed — it takes the
 * toolbar's place: `N selected · Move to… · Remove · Delete · ✕`.
 *
 * Move to… opens a folder picker under itself ("Top level" and the tree).
 * Remove and Delete apply to videos only; with a folder in the selection they
 * are disabled and the reason is shown under the bar. Each asks **once**,
 * inline in the bar, naming the count, before anything is sent.
 *
 * Presentational apart from the picker's dismissal, so every state renders to
 * static markup; the state is `useSelectionCommands`.
 */

import { useId, useRef } from 'react'
import type { RefObject } from 'react'
import { useDismiss } from '../../hooks/useDismiss'
import type { MoveOption } from '../../lib/collectionMove'
import type { BulkKind } from '../../lib/libraryBulk'
import { BULK_CONFIRM_LABEL, bulkConfirmPrompt } from '../../lib/libraryBulk'
import { Button } from '../ui/Button'
import { FolderOptionList } from './FolderOptionList'

export interface SelectionBarProps {
  count: number
  /** The selected videos, which Remove and Delete count. */
  videoCount: number
  /** Why Remove and Delete are disabled; null when they are not. */
  blocker: string | null
  confirming: BulkKind | null
  moving: boolean
  moveOptions: readonly MoveOption[]
  onToggleMove: () => void
  onCloseMove: () => void
  onPickMove: (folderId: string | null) => void
  onAsk: (kind: BulkKind) => void
  onConfirm: () => void
  onCancelConfirm: () => void
  onClear: () => void
}

export function SelectionBar(props: SelectionBarProps) {
  const reasonId = useId()
  const describedBy = props.blocker ? reasonId : undefined
  return (
    <div className="app-no-drag flex min-w-0 flex-col items-end gap-1">
      <div
        role="toolbar"
        aria-label="Selection"
        className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs"
      >
        <span className="whitespace-nowrap tabular-nums" style={{ color: 'var(--color-text-2)' }}>
          {props.count} selected
        </span>
        {props.confirming ? (
          <BarConfirm {...props} kind={props.confirming} />
        ) : (
          <>
            <MovePicker {...props} />
            <Button
              variant="ghost"
              className="whitespace-nowrap text-xs"
              disabled={props.blocker !== null}
              aria-describedby={describedBy}
              onClick={() => props.onAsk('remove')}
            >
              Remove
            </Button>
            <Button
              variant="ghost"
              className="whitespace-nowrap text-xs"
              style={{ color: props.blocker ? undefined : 'var(--color-danger)' }}
              disabled={props.blocker !== null}
              aria-describedby={describedBy}
              onClick={() => props.onAsk('delete')}
            >
              Delete…
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          className="px-2 text-xs"
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          onClick={props.onClear}
        >
          ✕
        </Button>
      </div>
      {props.blocker && !props.confirming && (
        <p id={reasonId} className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {props.blocker}
        </p>
      )}
    </div>
  )
}

function BarConfirm(props: SelectionBarProps & { kind: BulkKind }) {
  return (
    <span role="group" aria-label="Confirm" className="flex flex-wrap items-center gap-2">
      <span style={{ color: 'var(--color-text)' }}>
        {bulkConfirmPrompt(props.kind, props.videoCount)}
      </span>
      <Button
        variant={props.kind === 'delete' ? 'danger' : 'primary'}
        className="whitespace-nowrap text-xs"
        onClick={props.onConfirm}
      >
        {BULK_CONFIRM_LABEL[props.kind]}
      </Button>
      <Button variant="ghost" className="text-xs" onClick={props.onCancelConfirm}>
        Cancel
      </Button>
    </span>
  )
}

function MovePicker(props: SelectionBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        className="whitespace-nowrap text-xs"
        aria-haspopup="menu"
        aria-expanded={props.moving}
        onClick={props.onToggleMove}
      >
        Move to…
      </Button>
      {props.moving && <MovePickerMenu {...props} anchor={ref} />}
    </div>
  )
}

function MovePickerMenu(props: SelectionBarProps & { anchor: RefObject<HTMLDivElement | null> }) {
  useDismiss(props.anchor, props.onCloseMove)
  return (
    <div
      role="menu"
      aria-label={`Move ${props.count} items`}
      className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1 flex w-56 flex-col rounded-lg p-1 text-left text-xs"
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      <FolderOptionList
        heading={`Move ${props.count} items to`}
        backLabel="Close the folder list"
        options={props.moveOptions}
        onPick={props.onPickMove}
        onBack={props.onCloseMove}
      />
    </div>
  )
}
