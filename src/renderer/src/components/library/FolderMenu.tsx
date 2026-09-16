/**
 * A folder's menu (docs/plans/library-finder.md §4.1), opened by right-click
 * on a sidebar folder, a folder tile or a folder row, or by their `…`:
 * New folder inside · Rename · Move to… · Folder settings… · Delete.
 *
 * Delete is disabled, with the reason under it, while the folder holds videos
 * or subfolders; otherwise it confirms inline. "Move to…" swaps the actions
 * for a picker of the places the folder may go, labelled by path. An orphan
 * id gets one item, "Create folder", which adopts its videos.
 *
 * `FolderMenuView` is presentational so every mode renders to static markup;
 * `FolderContextMenu` places it at a point in the window (`PointMenu`).
 */

import { useState } from 'react'
import type { FolderMenuAnchor } from '../../hooks/useFolderMenu'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { FolderMenuModel } from '../../lib/folderMenu'
import type { FolderEntry } from '../../lib/libraryLocation'
import { FolderOptionList } from './FolderOptionList'
import { InlineConfirm, MenuItem } from './LibraryMenuParts'
import { NewCollectionForm } from './NewCollectionForm'
import { POINT_MENU_WIDTH_PX, PointMenu } from './PointMenu'

/** The folder menu is a `PointMenu`, at its width. */
export const FOLDER_MENU_WIDTH_PX = POINT_MENU_WIDTH_PX

export type FolderMenuMode = 'actions' | 'new' | 'move' | 'delete'

export interface FolderMenuViewProps {
  folder: FolderEntry
  /** Null for an orphan, which only offers "Create folder". */
  model: FolderMenuModel | null
  mode: FolderMenuMode
  onMode: (mode: FolderMenuMode) => void
  /** Create a folder inside this one. Never rejects. */
  onCreateInside: (name: string) => Promise<CreateCollectionResult>
  onRename: () => void
  onMove: (parentId: string | null) => void
  onOpenSettings: () => void
  onDelete: () => void
  onAdopt: () => void
  /** A menu action finished: close. */
  onDone: () => void
}

export function FolderMenuView(props: FolderMenuViewProps) {
  const { folder, model, mode } = props
  if (!model) {
    return (
      <MenuItem
        label="Create folder"
        title={`Create a folder with the id ${folder.id}, which takes in its videos`}
        onClick={props.onAdopt}
      />
    )
  }
  if (mode === 'new') {
    return (
      <div className="px-1.5 py-1">
        <NewCollectionForm
          onCreate={props.onCreateInside}
          onCreated={props.onDone}
          onCancel={() => props.onMode('actions')}
        />
      </div>
    )
  }
  if (mode === 'move') {
    return (
      <FolderOptionList
        heading={`Move ${folder.name} to`}
        backLabel="Back to folder actions"
        options={model.moveOptions}
        onPick={props.onMove}
        onBack={() => props.onMode('actions')}
      />
    )
  }
  return <FolderActions {...props} model={model} />
}

function FolderActions(props: FolderMenuViewProps & { model: FolderMenuModel }) {
  const { folder, model, mode, onMode } = props
  return (
    <>
      <MenuItem
        label="New folder inside…"
        disabledReason={model.newInsideBlocker}
        onClick={() => onMode('new')}
      />
      <MenuItem label="Rename" onClick={props.onRename} />
      <MenuItem label="Move to…" onClick={() => onMode('move')} />
      <MenuItem
        label="Folder settings…"
        title="Its brief overrides and template slots"
        onClick={props.onOpenSettings}
      />
      {mode === 'delete' && model.deleteBlocker === null ? (
        <InlineConfirm
          prompt={`Delete ${folder.name}?`}
          confirmLabel="Delete"
          confirmColor="var(--color-danger)"
          onConfirm={props.onDelete}
          onCancel={() => onMode('actions')}
        />
      ) : (
        <MenuItem
          label="Delete…"
          color="var(--color-danger)"
          disabledReason={model.deleteBlocker}
          onClick={() => onMode('delete')}
        />
      )}
    </>
  )
}

export interface FolderContextMenuProps extends Omit<
  FolderMenuViewProps,
  'folder' | 'mode' | 'onMode'
> {
  anchor: FolderMenuAnchor
}

export function FolderContextMenu({ anchor, ...props }: FolderContextMenuProps) {
  const [mode, setMode] = useState<FolderMenuMode>('actions')
  return (
    <PointMenu point={anchor} label={`Folder ${anchor.folder.name}`} onDismiss={props.onDone}>
      <FolderMenuView {...props} folder={anchor.folder} mode={mode} onMode={setMode} />
    </PointMenu>
  )
}
