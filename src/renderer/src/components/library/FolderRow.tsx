/**
 * A folder in the library list, before the video rows: the glyph in the
 * thumbnail cell, its name, then "N videos · M folders" across the video
 * columns. Behaves like `FolderTile`: a click selects it, a double-click or
 * Enter opens it, a click on the selected row's name renames it, right-click
 * or `…` opens its menu, and a real folder is dragged and dropped on.
 */

import { cn } from '../../lib/cn'
import type { FolderEntry } from '../../lib/libraryLocation'
import { folderSummary } from '../../lib/libraryLocation'
import { folderKey } from '../../lib/librarySelection'
import { FOLDER_GLYPH_ROW_PX, FolderGlyph } from './FolderGlyph'
import { LIST_THUMB_WIDTH_PX } from './LibraryListRow'
import { FolderNameInput } from './FolderNameInput'
import { FolderActionsButton, ORPHAN_FOLDER_TITLE, folderContextMenu } from './FolderTile'
import type { FolderItemUi } from './folderItemUi'
import { DROP_TARGET_STYLE } from './folderItemUi'
import type { LibraryItemUi } from './libraryItemUi'
import {
  INERT_LIBRARY_ITEM_UI,
  ROW_FOCUS_CLASS,
  SELECTED_ROW_STYLE,
  itemAttributes,
} from './libraryItemUi'

export interface FolderRowProps {
  folder: FolderEntry
  ui: FolderItemUi
  /** How many video columns the summary spans (Duration … Modified). */
  summarySpan: number
  /** Selection and opening; inert when absent. */
  item?: LibraryItemUi
}

export function FolderRow({
  folder,
  ui,
  summarySpan,
  item = INERT_LIBRARY_ITEM_UI,
}: FolderRowProps) {
  const renaming = ui.renamingId === folder.id
  const key = folderKey(folder.id)
  const selected = item.isSelected(key)
  // An orphan is not a folder to move, and a name being typed is not a drag.
  const source = folder.orphan || renaming ? { draggable: false } : ui.drag.folderSource(folder.id)
  const target = folder.orphan ? null : ui.drag.target(folder.id, `row:${folder.id}`)
  return (
    <tr
      {...itemAttributes(key, selected, 'row')}
      tabIndex={0}
      aria-label={renaming ? undefined : `Folder ${folder.name}`}
      className={cn(
        'group cursor-default transition-colors hover:bg-[var(--color-surface)]',
        ROW_FOCUS_CLASS
      )}
      style={{
        borderBottom: '1px solid var(--color-border)',
        ...(selected ? SELECTED_ROW_STYLE : {}),
        ...(target?.over ? { background: DROP_TARGET_STYLE.background } : {}),
        ...(target?.over ? { outline: `1px solid ${DROP_TARGET_STYLE.borderColor}` } : {}),
      }}
      title={folder.orphan ? ORPHAN_FOLDER_TITLE : folder.path}
      data-folder-row={folder.id}
      {...source}
      {...target?.props}
      onClick={(e) => {
        if (!renaming) item.onSelectClick(key, e)
      }}
      onDoubleClick={() => {
        if (!renaming) item.onOpenItem(key)
      }}
      onContextMenu={folderContextMenu(folder, ui, item)}
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
          <span
            className="block truncate text-left text-sm"
            style={{
              color: folder.orphan ? 'var(--color-text-2)' : 'var(--color-text)',
              fontFamily: folder.orphan ? 'var(--cf-font-mono)' : 'var(--cf-font-ui)',
            }}
            onClick={(e) => item.onNameClick(key, e)}
          >
            {folder.name}
          </span>
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
