/**
 * The library as a table (docs/plans/library-finder.md §3.4): thumbnail, Name,
 * Duration, Status, Folder (the full path; only in All videos and search
 * results), Published on and Modified. Folder rows (`FolderRow`) come first.
 *
 * The table is a multi-select `grid` whose rows are the selectable items
 * (`useLibraryItems` owns the selection).
 *
 * The caller hands the folders and videos in already sorted; a header click
 * only reports the next video sort (`toggledSort`: the active column reverses,
 * another starts in its natural direction) — folders stay on top by name.
 * Folder and Published on are not sort keys, so their headers are plain text.
 *
 * The table scrolls sideways in its own container, so a narrow window never
 * squeezes the columns into each other. That container also clips vertically,
 * so it keeps room below the last row for a row's `…` menu to open into.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import type { FolderEntry } from '../../lib/libraryLocation'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { LibrarySort, LibrarySortKey } from '../../lib/librarySort'
import { toggledSort } from '../../lib/librarySort'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import { FolderRow } from './FolderRow'
import type { LibraryItemUi } from './libraryItemUi'
import { INERT_LIBRARY_ITEM_UI } from './libraryItemUi'
import { LibraryListRow } from './LibraryListRow'
import type { FolderItemUi } from './folderItemUi'

export { LIST_THUMB_HEIGHT_PX, LIST_THUMB_WIDTH_PX } from './LibraryListRow'

/** Below this the columns stop shrinking and the table scrolls instead. */
const TABLE_MIN_WIDTH_PX = 760
/** Room under the last row for its `…` menu (`LibraryCardMenu`, four items). */
const MENU_CLEARANCE_PX = 160
/** The video columns a folder row's summary spans: Duration, Status, Published on, Modified. */
const SUMMARY_COLUMNS = 4

const ARROW = { asc: '▲', desc: '▼' } as const
const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

export interface LibraryListProps extends RecordMenuActions {
  /** Folder rows, before the videos, in display order. */
  folders: readonly FolderEntry[]
  /** In display order — the caller sorts. */
  videos: readonly LibraryVideo[]
  collections: readonly CollectionSummary[]
  /** Channel names for "Published on"; null shows the ids. */
  channels: ChannelNames | null
  /** The Folder column: All videos and search results. */
  showFolder: boolean
  sort: LibrarySort
  onSortChange: (sort: LibrarySort) => void
  folderUi: FolderItemUi
  drag: LibraryDrag
  /** Selection, opening and rename; inert when absent. */
  item?: LibraryItemUi
}

export function LibraryList({
  folders,
  videos,
  collections,
  channels,
  showFolder,
  sort,
  onSortChange,
  folderUi,
  drag,
  item = INERT_LIBRARY_ITEM_UI,
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
        role="grid"
        aria-multiselectable="true"
        aria-label="Folders and videos"
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
            {showFolder && <PlainHeader label="Folder" />}
            <PlainHeader label="Published on" />
            {sortable('Modified', 'modified')}
            <th scope="col" className="w-0 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              ui={folderUi}
              summarySpan={SUMMARY_COLUMNS + (showFolder ? 1 : 0)}
              item={item}
            />
          ))}
          {videos.map((video) => (
            <LibraryListRow
              key={video.id}
              video={video}
              collections={collections}
              channels={channels}
              showFolder={showFolder}
              dragSource={drag.videoSource(video, () => item.onVideoDragStart(video.id))}
              item={item}
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
