/**
 * The library's card grid. The column width comes from the icon-size slider
 * through the `--library-tile` CSS variable (`minmax(var(--library-tile), 1fr)`),
 * so resizing is one style write, not a re-layout in React.
 *
 * Cards keep their poster's ratio, so the grid is `items-start`: a row never
 * stretches its shorter (landscape) cards to its tallest one.
 */

import type { CSSProperties } from 'react'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { collectionLabel } from '../../lib/collections'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { LibraryCard } from './LibraryCard'

export interface LibraryGridProps extends RecordMenuActions {
  /** In display order — the caller sorts and leaves out the hero. */
  videos: readonly LibraryVideo[]
  collections: readonly CollectionSummary[]
  /** The grid column's minimum width, in CSS pixels (the icon-size slider). */
  tileSize: number
  onOpen: (video: LibraryVideo) => void
}

export function LibraryGrid({
  videos,
  collections,
  tileSize,
  onOpen,
  ...actions
}: LibraryGridProps) {
  const style = { '--library-tile': `${tileSize}px` } as CSSProperties
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(var(--library-tile),1fr))] items-start gap-4"
      style={style}
    >
      {videos.map((video) => (
        <LibraryCard
          key={video.id}
          video={video}
          collectionName={collectionLabel(collections, video.collection_id)}
          collections={collections}
          onOpen={onOpen}
          {...actions}
        />
      ))}
    </div>
  )
}
