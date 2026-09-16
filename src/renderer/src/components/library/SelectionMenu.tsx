/**
 * The right-click menu of a multi-selection (docs/plans/library-finder.md
 * §4.4): Move to… · Remove from library · Delete…, at the pointer.
 *
 * The same rules as the selection bar: Remove and Delete apply to videos only
 * and are disabled with the reason while a folder is selected, and each asks
 * once, inline, naming the count. "Move to…" swaps the actions for the folder
 * picker.
 */

import { useState } from 'react'
import type { MoveOption } from '../../lib/collectionMove'
import type { BulkKind } from '../../lib/libraryBulk'
import { BULK_CONFIRM_LABEL, bulkConfirmPrompt } from '../../lib/libraryBulk'
import { FolderOptionList } from './FolderOptionList'
import { InlineConfirm, MenuItem } from './LibraryMenuParts'
import type { MenuPoint } from './PointMenu'
import { PointMenu } from './PointMenu'

/** Under a disabled Delete, which sits right below Remove and its full reason. */
export const DESELECT_FOLDERS_FIRST = 'Deselect the folders first.'

export type SelectionMenuMode = 'actions' | 'move' | BulkKind

export interface SelectionMenuViewProps {
  count: number
  videoCount: number
  blocker: string | null
  moveOptions: readonly MoveOption[]
  mode: SelectionMenuMode
  onMode: (mode: SelectionMenuMode) => void
  onPickMove: (folderId: string | null) => void
  onConfirm: (kind: BulkKind) => void
}

export function SelectionMenuView(props: SelectionMenuViewProps) {
  const { mode, onMode } = props
  if (mode === 'move') {
    return (
      <FolderOptionList
        heading={`Move ${props.count} items to`}
        backLabel="Back to selection actions"
        options={props.moveOptions}
        onPick={props.onPickMove}
        onBack={() => onMode('actions')}
      />
    )
  }
  const confirm = (kind: BulkKind) => (
    <InlineConfirm
      prompt={bulkConfirmPrompt(kind, props.videoCount)}
      confirmLabel={BULK_CONFIRM_LABEL[kind]}
      confirmColor={kind === 'delete' ? 'var(--color-danger)' : 'var(--color-text)'}
      onConfirm={() => props.onConfirm(kind)}
      onCancel={() => onMode('actions')}
    />
  )
  return (
    <>
      <MenuItem label="Move to…" onClick={() => onMode('move')} />
      {mode === 'remove' && props.blocker === null ? (
        confirm('remove')
      ) : (
        <MenuItem
          label="Remove from library"
          disabledReason={props.blocker}
          onClick={() => onMode('remove')}
        />
      )}
      {mode === 'delete' && props.blocker === null ? (
        confirm('delete')
      ) : (
        <MenuItem
          label="Delete…"
          color="var(--color-danger)"
          disabledReason={props.blocker === null ? null : DESELECT_FOLDERS_FIRST}
          onClick={() => onMode('delete')}
        />
      )}
    </>
  )
}

export interface SelectionMenuProps extends Omit<SelectionMenuViewProps, 'mode' | 'onMode'> {
  point: MenuPoint
  onDismiss: () => void
}

export function SelectionMenu({ point, onDismiss, ...props }: SelectionMenuProps) {
  const [mode, setMode] = useState<SelectionMenuMode>('actions')
  return (
    <PointMenu point={point} label={`${props.count} selected`} onDismiss={onDismiss}>
      <SelectionMenuView {...props} mode={mode} onMode={setMode} />
    </PointMenu>
  )
}
