/**
 * The library's grid: subfolder tiles first, then the video cards. The column width comes from the icon-size slider
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
import { FolderTile } from './FolderTile'
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
  onOpen: (video: LibraryVideo) => void
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
  onOpen,
  ...actions
}: LibraryGridProps) {
  const style = { '--library-tile': `${tileSize}px` } as CSSProperties
  return (
    <div className="flex flex-col gap-4">
      {folders.length > 0 && (
        <div className={GRID_CLASS} style={style} aria-label="Folders" role="group">
          {folders.map((folder) => (
            <FolderTile key={folder.id} folder={folder} ui={folderUi} />
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className={GRID_CLASS} style={style}>
          {videos.map((video) => (
            <LibraryCard
              key={video.id}
              video={video}
              folder={showFolder ? folderChipOf(collections, video.collection_id) : null}
              collections={collections}
              dragSource={drag.videoSource(video)}
              onOpen={onOpen}
              {...actions}
            />
          ))}
        </div>
      )}
    </div>
  )
}
