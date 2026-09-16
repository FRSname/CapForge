/**
 * The library as a table (docs/plans/library-finder.md §3.4): thumbnail, Name,
 * Duration, Status, Collection (only under "All videos"), Published on and
 * Modified.
 *
 * The caller hands the videos in already sorted (`sortVideos`); a header click
 * only reports the next sort (`toggledSort`: the active column reverses,
 * another starts in its natural direction). Collection and Published on are
 * not sort keys, so their headers are plain text.
 *
 * The table scrolls sideways in its own container, so a narrow window never
 * squeezes the columns into each other. That container also clips vertically,
 * so it keeps room below the last row for a row's `…` menu to open into.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { LibrarySort, LibrarySortKey } from '../../lib/librarySort'
import { toggledSort } from '../../lib/librarySort'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import { LibraryListRow } from './LibraryListRow'

export { LIST_THUMB_HEIGHT_PX, LIST_THUMB_WIDTH_PX } from './LibraryListRow'

/** Below this the columns stop shrinking and the table scrolls instead. */
const TABLE_MIN_WIDTH_PX = 760
/** Room under the last row for its `…` menu (`LibraryCardMenu`, four items). */
const MENU_CLEARANCE_PX = 160

const ARROW = { asc: '▲', desc: '▼' } as const
const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

export interface LibraryListProps extends RecordMenuActions {
  /** In display order — the caller sorts. */
  videos: readonly LibraryVideo[]
  collections: readonly CollectionSummary[]
  /** Channel names for "Published on"; null shows the ids. */
  channels: ChannelNames | null
  /** The Collection column: only when the collection filter is "All videos". */
  showCollection: boolean
  sort: LibrarySort
  onSortChange: (sort: LibrarySort) => void
  onOpen: (video: LibraryVideo) => void
}

export function LibraryList({
  videos,
  collections,
  channels,
  showCollection,
  sort,
  onSortChange,
  onOpen,
  ...actions
}: LibraryListProps) {
  const sortable = (label: string, key: LibrarySortKey, className?: string) => (
    <SortHeader
      label={label}
      sortKey={key}
      sort={sort}
      className={className}
      onSort={() => onSortChange(toggledSort(sort, key))}
    />
  )
  return (
    <div className="overflow-x-auto" style={{ paddingBottom: `${MENU_CLEARANCE_PX}px` }}>
      <table
        className="w-full border-collapse text-left text-xs"
        style={{ minWidth: `${TABLE_MIN_WIDTH_PX}px`, color: 'var(--color-text-2)' }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            <th scope="col" className="w-0 py-2 pr-3">
              <span className="sr-only">Poster</span>
            </th>
            {sortable('Name', 'name')}
            {sortable('Duration', 'duration', 'text-right')}
            {sortable('Status', 'status')}
            {showCollection && <PlainHeader label="Collection" />}
            <PlainHeader label="Published on" />
            {sortable('Modified', 'modified')}
            <th scope="col" className="w-0 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <LibraryListRow
              key={video.id}
              video={video}
              collections={collections}
              channels={channels}
              showCollection={showCollection}
              onOpen={onOpen}
              {...actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const HEADER_TEXT = {
  fontFamily: 'var(--cf-font-mono)',
  color: 'var(--color-text-3)',
} as const

function PlainHeader({ label }: { label: string }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap py-2 pr-4 text-[11px] font-normal uppercase tracking-widest"
      style={HEADER_TEXT}
    >
      {label}
    </th>
  )
}

interface SortHeaderProps {
  label: string
  sortKey: LibrarySortKey
  sort: LibrarySort
  className?: string
  onSort: () => void
}

function SortHeader({ label, sortKey, sort, className, onSort }: SortHeaderProps) {
  const active = sort.key === sortKey
  return (
    <th
      scope="col"
      aria-sort={active ? ARIA_SORT[sort.direction] : undefined}
      className={`whitespace-nowrap py-2 pr-4 font-normal ${className ?? ''}`}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest"
        style={{ ...HEADER_TEXT, color: active ? 'var(--color-text)' : HEADER_TEXT.color }}
        title={`Sort by ${label.toLowerCase()}`}
        onClick={onSort}
      >
        <span>{label}</span>
        {active && <span aria-hidden="true">{ARROW[sort.direction]}</span>}
      </button>
    </th>
  )
}
