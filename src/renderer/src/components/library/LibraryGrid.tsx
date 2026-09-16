/**
 * The library's grid: subfolder tiles first, then the video cards, together
 * one multi-select `listbox` whose options are the tiles and cards
 * (`useLibraryItems` owns the selection; Up/Down step by the column count the
 * hook measures from a `data-library-grid` section). The column width comes from the icon-size slider
 * through the `--library-tile` CSS variable (`minmax(var(--library-tile), 1fr)`),
 * so resizing is one style write, not a re-layout in React.
 *
 * Cards keep their poster's ratio, so the grid is `items-start`: a row never
 * stretches its shorter (landscape) cards to its tallest one.
 */

import type { CSSProperties } from 'react'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { pathLabel } from '../../lib/collectionTree'
import { collectionLabel } from '../../lib/collections'
import type { FolderEntry } from '../../lib/libraryLocation'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { GRID_SECTION_ATTRIBUTE } from '../../lib/libraryKeyboard'
import { FolderTile } from './FolderTile'
import type { LibraryItemUi } from './libraryItemUi'
import { INERT_LIBRARY_ITEM_UI } from './libraryItemUi'
import type { FolderChip } from './LibraryCard'
import { LibraryCard } from './LibraryCard'
import type { FolderItemUi } from './folderItemUi'

export const GRID_CLASS =
  'grid grid-cols-[repeat(auto-fill,minmax(var(--library-tile),1fr))] items-start gap-4'

export interface LibraryGridProps extends RecordMenuActions {
  /** Subfolder tiles, before the videos, in display order. */
  folders: readonly FolderEntry[]
  /** In display order — the caller sorts and leaves out the hero. */
  videos: readonly LibraryVideo[]
  collections: readonly CollectionSummary[]
  /** The grid column's minimum width, in CSS pixels (the icon-size slider). */
  tileSize: number
  /** Cards wear their folder chip (All videos and search results). */
  showFolder: boolean
  folderUi: FolderItemUi
  drag: LibraryDrag
  /** Selection, opening and rename; inert when absent. */
  item?: LibraryItemUi
}

/** The chip for a record's folder: its name (an orphan's id) and path. */
export function folderChipOf(
  collections: readonly CollectionSummary[],
  collectionId: string | null
): FolderChip | null {
  const name = collectionLabel(collections, collectionId)
  return name && collectionId ? { name, path: pathLabel(collections, collectionId) } : null
}

export function LibraryGrid({
  folders,
  videos,
  collections,
  tileSize,
  showFolder,
  folderUi,
  drag,
  item = INERT_LIBRARY_ITEM_UI,
  ...actions
}: LibraryGridProps) {
  const style = { '--library-tile': `${tileSize}px` } as CSSProperties
  const section = { [GRID_SECTION_ATTRIBUTE]: '' }
  return (
    <div
      className="flex flex-col gap-4"
      role="listbox"
      aria-multiselectable="true"
      aria-label="Folders and videos"
    >
      {folders.length > 0 && (
        <div className={GRID_CLASS} style={style} aria-label="Folders" role="group" {...section}>
          {folders.map((folder) => (
            <FolderTile key={folder.id} folder={folder} ui={folderUi} item={item} />
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className={GRID_CLASS} style={style} aria-label="Videos" role="group" {...section}>
          {videos.map((video) => (
            <LibraryCard
              key={video.id}
              video={video}
              folder={showFolder ? folderChipOf(collections, video.collection_id) : null}
              collections={collections}
              dragSource={drag.videoSource(video, () => item.onVideoDragStart(video.id))}
              item={item}
              {...actions}
            />
          ))}
        </div>
      )}
    </div>
  )
}
