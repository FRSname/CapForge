/**
 * One record as a list row, a `row` of the table's grid, and a selectable item
 * exactly like a card (docs/plans/library-finder.md §4.4): a click selects it,
 * a double-click or Enter opens it, a click on the name of the row that already
 * was the one selected renames it in place, and a right-click opens its menu
 * at the pointer (the selection's, inside a multi-selection). The row itself
 * is focusable. The `…` cell stops the click, so working the menu never
 * changes the selection, and the menu is the card's (`LibraryCardMenu` over
 * `useRecordMenu`).
 *
 * The thumbnail is a fixed 16:9 box with the picture letterboxed inside, so
 * rows keep one height whatever shape the video is.
 */

import type { MouseEvent } from 'react'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { pathLabel } from '../../lib/collectionTree'
import { cn } from '../../lib/cn'
import { videoKey } from '../../lib/librarySelection'
import type { LibraryVideo } from '../../lib/libraryTypes'
import {
  OPENING_LABEL,
  displayTitle,
  formatDuration,
  formatShortDate,
  publishedOnLabel,
  statusLabel,
} from '../../lib/libraryView'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import type { DragSourceProps } from '../../hooks/useLibraryDrag'
import { usePosterUrl } from '../../hooks/usePosterUrl'
import { Spinner } from '../ui/Spinner'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { useRecordMenu } from '../../hooks/useRecordMenu'
import { LanguageChip, RecordActionsButton, StatusRail } from './LibraryCard'
import { LibraryCardMenu } from './LibraryCardMenu'
import type { LibraryItemUi } from './libraryItemUi'
import {
  INERT_LIBRARY_ITEM_UI,
  ROW_FOCUS_CLASS,
  SELECTED_ROW_STYLE,
  itemAttributes,
} from './libraryItemUi'
import { VideoNameInput } from './VideoNameInput'

export const LIST_THUMB_WIDTH_PX = 64
export const LIST_THUMB_HEIGHT_PX = 36

/** Shown in a cell with nothing to say (in no folder, published nowhere). */
const EMPTY_CELL = '—'
/** A row's menu hangs under its `…` button, right-aligned to the cell. */
const ROW_MENU_PLACEMENT = 'right-0 top-full mt-1'

export interface LibraryListRowProps extends RecordMenuActions {
  video: LibraryVideo
  collections: readonly CollectionSummary[]
  channels: ChannelNames | null
  /** The Folder column, with the folder's full path. */
  showFolder: boolean
  /** Drag the row onto a folder; absent, it does not drag. */
  dragSource?: DragSourceProps
  /** Selection, opening and rename; inert when absent. */
  item?: LibraryItemUi
}

export function LibraryListRow({
  video,
  collections,
  channels,
  showFolder,
  dragSource,
  item = INERT_LIBRARY_ITEM_UI,
  ...actions
}: LibraryListRowProps) {
  const { open, toggle, openAt, close, menu } = useRecordMenu(video, actions)
  const title = displayTitle(video)
  const published = publishedOnLabel(video.publishedOn, channels)
  const key = videoKey(video.id)
  const selected = item.isSelected(key)
  const renaming = item.renamingVideoId === video.id
  const opening = item.openingVideoId === video.id

  return (
    <tr
      {...itemAttributes(key, selected, 'row')}
      tabIndex={0}
      aria-label={renaming ? undefined : title}
      aria-busy={opening}
      className={cn(
        'group cursor-default transition-colors hover:bg-[var(--color-surface)]',
        ROW_FOCUS_CLASS
      )}
      style={{
        borderBottom: '1px solid var(--color-border)',
        ...(selected ? SELECTED_ROW_STYLE : {}),
      }}
      title={video.sourcePath}
      {...(renaming ? { draggable: false } : dragSource)}
      onClick={(e) => item.onSelectClick(key, e)}
      onDoubleClick={() => item.onOpenItem(key)}
      onContextMenu={(e) => {
        if (item.onContextMenu(key, e)) openAt({ x: e.clientX, y: e.clientY })
      }}
    >
      <td className="py-1.5 pr-3">
        <ListThumb video={video} />
      </td>
      <td className="max-w-[18rem] py-1.5 pr-4">
        {renaming ? (
          <VideoNameInput video={video} item={item} />
        ) : (
          <NameCell video={video} title={title} onClick={(e) => item.onNameClick(key, e)} />
        )}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-right tabular-nums" style={MONO}>
        {formatDuration(video.duration)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4">
        <span className="flex items-center gap-2">
          {opening ? <Spinner /> : <StatusRail video={video} />}
          <span>{opening ? OPENING_LABEL : statusLabel(video.status)}</span>
        </span>
      </td>
      {showFolder && <FolderCell collections={collections} collectionId={video.collection_id} />}
      <td className="max-w-[12rem] truncate py-1.5 pr-4">{published || EMPTY_CELL}</td>
      <td className="whitespace-nowrap py-1.5 pr-4" style={{ color: 'var(--color-text-3)' }}>
        {formatShortDate(video.updatedAt)}
      </td>
      <td
        className="relative py-1.5"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <RecordActionsButton
          title={title}
          className="opacity-0 group-hover:opacity-100"
          onClick={toggle}
        />
        {open && (
          <LibraryCardMenu
            video={video}
            collections={collections}
            placement={ROW_MENU_PLACEMENT}
            {...menu}
            onRename={() => {
              close()
              item.onStartRename(key)
            }}
          />
        )}
      </td>
    </tr>
  )
}

const MONO = { fontFamily: 'var(--cf-font-mono)' } as const

interface FolderCellProps {
  collections: readonly CollectionSummary[]
  collectionId: string | null
}

/** `Events › UCK26` (an orphan's bare id), or a dash in no folder. */
function FolderCell({ collections, collectionId }: FolderCellProps) {
  const path = collectionId ? pathLabel(collections, collectionId) : null
  return (
    <td className="max-w-[14rem] truncate py-1.5 pr-4" title={path ?? undefined}>
      {path ?? EMPTY_CELL}
    </td>
  )
}

interface NameCellProps {
  video: LibraryVideo
  title: string
  /** A click on the name (it still reaches the row, which selects). */
  onClick: (e: MouseEvent) => void
}

function NameCell({ video, title, onClick }: NameCellProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="truncate text-left text-sm"
        style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
        onClick={onClick}
      >
        {title}
      </span>
      <LanguageChip lang={video.language} />
      {video.missing_media && (
        <span
          className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-2xs"
          style={{ color: 'var(--color-danger)', background: 'var(--color-danger-subtle)' }}
          title={`The source file is gone: ${video.sourcePath}`}
        >
          Media missing
        </span>
      )}
    </span>
  )
}

/** The record's picture, letterboxed in a fixed 16:9 box. */
function ListThumb({ video }: { video: LibraryVideo }) {
  const posterUrl = usePosterUrl(video)
  return (
    <div
      className="relative overflow-hidden rounded"
      style={{
        width: `${LIST_THUMB_WIDTH_PX}px`,
        height: `${LIST_THUMB_HEIGHT_PX}px`,
        background: 'var(--color-base)',
        border: '1px solid var(--color-border)',
      }}
    >
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
    </div>
  )
}
