/**
 * What a card, a list row, a folder tile or a folder row needs from the
 * selection (docs/plans/library-finder.md §4.4–§4.5): whether it is selected,
 * what a click, a double-click, a click on its name, a right-click and a drag
 * do, and the video rename. Built by `useLibraryItems` in the main area; the
 * sidebar takes no part (a sidebar folder stays single-click navigation).
 */

import type { CSSProperties, MouseEvent } from 'react'
import type { ItemKey } from '../../lib/librarySelection'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { RenameRecordResult } from '../../lib/recordRename'
import { ITEM_ATTRIBUTE } from '../../lib/libraryKeyboard'

export interface LibraryItemUi {
  isSelected: (key: ItemKey) => boolean
  /** A click on the item: select it (⌘/Ctrl toggles, Shift takes the range). */
  onSelectClick: (key: ItemKey, e: MouseEvent) => void
  /** A double-click: open it. */
  onOpenItem: (key: ItemKey) => void
  /**
   * A click on the item's name, before the item's own click sees it: on the
   * item that already was the one selected, a rename starts after a pause
   * unless a double-click arrives.
   */
  onNameClick: (key: ItemKey, e: MouseEvent) => void
  /**
   * A right-click. Selects the item first when it is not selected; then either
   * opens the selection's menu and returns false, or returns true for the item
   * to open its own menu at the pointer.
   */
  onContextMenu: (key: ItemKey, e: MouseEvent) => boolean
  /** A drag starts on this video: the ids it carries (the selected videos, or this one). */
  onVideoDragStart: (videoId: string) => readonly string[]
  /** The video whose name is an input; null when none. */
  renamingVideoId: string | null
  /** Turn an item's name into an input (a video's here, a folder's through its menu state). */
  onStartRename: (key: ItemKey) => void
  /** Never rejects. */
  onRenameVideo: (video: LibraryVideo, name: string) => Promise<RenameRecordResult>
  onStopRename: () => void
}

/** Nothing is selected and nothing happens — for static markup. */
export const INERT_LIBRARY_ITEM_UI: LibraryItemUi = {
  isSelected: () => false,
  onSelectClick: () => {},
  onOpenItem: () => {},
  onNameClick: () => {},
  onContextMenu: () => true,
  onVideoDragStart: (videoId) => [videoId],
  renamingVideoId: null,
  onStartRename: () => {},
  onRenameVideo: () => Promise.resolve({ kind: 'renamed' }),
  onStopRename: () => {},
}

/** The selected look: the accent border and a subtle accent fill. */
export const SELECTED_ITEM_STYLE: CSSProperties = {
  borderColor: 'var(--color-accent)',
  background: 'var(--color-accent-subtle)',
}

/** A selected list row: the fill, and the accent drawn inside the row's edge. */
export const SELECTED_ROW_STYLE: CSSProperties = {
  background: 'var(--color-accent-subtle)',
  outline: '1px solid var(--color-accent)',
  outlineOffset: '-1px',
}

/** The keyboard focus ring on a row (a `<tr>` draws no box-shadow ring). */
export const ROW_FOCUS_CLASS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]'

/**
 * The attributes that make an element an item: its key and its selected state.
 * A grid tile is an `option` of the grid's `listbox`; a list row keeps its
 * native `row` role inside the table's `grid`.
 */
export function itemAttributes(key: ItemKey, selected: boolean, as: 'option' | 'row') {
  return {
    [ITEM_ATTRIBUTE]: key,
    ...(as === 'option' ? { role: 'option' } : {}),
    'aria-selected': selected,
  }
}
