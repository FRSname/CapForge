/**
 * A folder in the library grid, before the video cards: the folder glyph, its
 * name and "N videos · M folders". A single click opens it (PR 4 makes that a
 * double-click), right-click or the `…` button opens its menu, and it is both
 * dragged (into another folder) and dropped on (videos and folders).
 *
 * An orphan id is drawn with a dashed glyph and is neither dragged nor a drop
 * target: nothing can move into a folder that does not exist.
 */

import type { CSSProperties } from 'react'
import type { FolderEntry } from '../../lib/libraryLocation'
import { folderSummary } from '../../lib/libraryLocation'
import { FOLDER_GLYPH_LARGE_PX, FolderGlyph } from './FolderGlyph'
import { FolderNameInput } from './FolderNameInput'
import type { FolderItemUi } from './folderItemUi'
import { DROP_TARGET_STYLE, contextMenuHandler, menuButtonHandler } from './folderItemUi'

export const ORPHAN_FOLDER_TITLE = 'No folder has this id — right-click to create it.'

export interface FolderTileProps {
  folder: FolderEntry
  ui: FolderItemUi
}

export function FolderTile({ folder, ui }: FolderTileProps) {
  const renaming = ui.renamingId === folder.id
  // An orphan is not a folder to move, and a name being typed is not a drag.
  const source = folder.orphan || renaming ? { draggable: false } : ui.drag.folderSource(folder.id)
  const target = folder.orphan ? null : ui.drag.target(folder.id, `tile:${folder.id}`)
  const boxStyle: CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    ...(target?.over ? DROP_TARGET_STYLE : {}),
  }
  const body = (
    <>
      <FolderGlyph orphan={folder.orphan} size={FOLDER_GLYPH_LARGE_PX} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {renaming ? (
          <FolderNameInput folder={folder} ui={ui} />
        ) : (
          <span
            className="truncate text-sm"
            style={{
              color: folder.orphan ? 'var(--color-text-2)' : 'var(--color-text)',
              fontFamily: folder.orphan ? 'var(--cf-font-mono)' : 'var(--cf-font-ui)',
            }}
          >
            {folder.name}
          </span>
        )}
        <span className="truncate text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {folderSummary(folder)}
        </span>
      </span>
    </>
  )

  return (
    <div
      className="group relative"
      data-folder-tile={folder.id}
      {...source}
      {...target?.props}
      onContextMenu={contextMenuHandler(folder, ui)}
    >
      {renaming ? (
        <div className="flex items-center gap-3 rounded-xl p-3" style={boxStyle}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl p-3 pr-9 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
          style={boxStyle}
          title={folder.orphan ? ORPHAN_FOLDER_TITLE : folder.path}
          aria-label={`Open folder ${folder.name}`}
          onClick={() => ui.onOpen(folder)}
        >
          {body}
        </button>
      )}
      {!renaming && (
        <FolderActionsButton folder={folder} ui={ui} className="absolute right-2 top-2" />
      )}
    </div>
  )
}

export interface FolderActionsButtonProps {
  folder: FolderEntry
  ui: FolderItemUi
  className?: string
}

/** The `…` that opens a folder's menu under itself — the tile's and the row's. */
export function FolderActionsButton({ folder, ui, className }: FolderActionsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Actions for folder ${folder.name}`}
      aria-haspopup="menu"
      title="Folder actions"
      className={`rounded px-1.5 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${className ?? ''}`}
      style={{ color: 'var(--color-text-2)', background: 'var(--color-base)' }}
      onClick={menuButtonHandler(folder, ui)}
    >
      ⋯
    </button>
  )
}
