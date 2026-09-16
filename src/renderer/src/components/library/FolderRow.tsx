/**
 * A folder in the library list, before the video rows: the glyph in the
 * thumbnail cell, its name, then "N videos · M folders" across the video
 * columns. Behaves like `FolderTile`: a click opens it, right-click or `…`
 * opens its menu, and a real folder is dragged and dropped on.
 */

import type { FolderEntry } from '../../lib/libraryLocation'
import { folderSummary } from '../../lib/libraryLocation'
import { FOLDER_GLYPH_ROW_PX, FolderGlyph } from './FolderGlyph'
import { LIST_THUMB_WIDTH_PX } from './LibraryListRow'
import { FolderNameInput } from './FolderNameInput'
import { FolderActionsButton, ORPHAN_FOLDER_TITLE } from './FolderTile'
import type { FolderItemUi } from './folderItemUi'
import { DROP_TARGET_STYLE, contextMenuHandler } from './folderItemUi'

export interface FolderRowProps {
  folder: FolderEntry
  ui: FolderItemUi
  /** How many video columns the summary spans (Duration … Modified). */
  summarySpan: number
}

export function FolderRow({ folder, ui, summarySpan }: FolderRowProps) {
  const renaming = ui.renamingId === folder.id
  // An orphan is not a folder to move, and a name being typed is not a drag.
  const source = folder.orphan || renaming ? { draggable: false } : ui.drag.folderSource(folder.id)
  const target = folder.orphan ? null : ui.drag.target(folder.id, `row:${folder.id}`)
  return (
    <tr
      className="group cursor-pointer transition-colors hover:bg-[var(--color-surface)]"
      style={{
        borderBottom: '1px solid var(--color-border)',
        ...(target?.over ? { background: DROP_TARGET_STYLE.background } : {}),
        ...(target?.over ? { outline: `1px solid ${DROP_TARGET_STYLE.borderColor}` } : {}),
      }}
      title={folder.orphan ? ORPHAN_FOLDER_TITLE : folder.path}
      data-folder-row={folder.id}
      {...source}
      {...target?.props}
      onClick={() => {
        if (!renaming) ui.onOpen(folder)
      }}
      onContextMenu={contextMenuHandler(folder, ui)}
    >
      <td className="py-1.5 pr-3">
        <span className="flex justify-center" style={{ width: `${LIST_THUMB_WIDTH_PX}px` }}>
          <FolderGlyph orphan={folder.orphan} size={FOLDER_GLYPH_ROW_PX} />
        </span>
      </td>
      <td className="max-w-[18rem] py-1.5 pr-4">
        {renaming ? (
          <FolderNameInput folder={folder} ui={ui} />
        ) : (
          <button
            type="button"
            className="truncate text-left text-sm"
            style={{
              color: folder.orphan ? 'var(--color-text-2)' : 'var(--color-text)',
              fontFamily: folder.orphan ? 'var(--cf-font-mono)' : 'var(--cf-font-ui)',
            }}
            aria-label={`Open folder ${folder.name}`}
            onClick={(e) => {
              // The row opens on click too; one open per click.
              e.stopPropagation()
              ui.onOpen(folder)
            }}
          >
            {folder.name}
          </button>
        )}
      </td>
      <td
        colSpan={summarySpan}
        className="whitespace-nowrap py-1.5 pr-4"
        style={{ color: 'var(--color-text-3)' }}
      >
        {folderSummary(folder)}
      </td>
      <td className="relative py-1.5" onClick={(e) => e.stopPropagation()}>
        <FolderActionsButton folder={folder} ui={ui} />
      </td>
    </tr>
  )
}
