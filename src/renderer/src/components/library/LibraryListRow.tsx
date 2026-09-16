/**
 * One record as a list row. A click anywhere on the row opens the video,
 * exactly like a card; the name is also a button so the row is reachable from
 * the keyboard. The `…` cell stops the click, so working the menu never opens
 * the video, and the menu itself is the card's (`LibraryCardMenu` over
 * `useRecordMenu`).
 *
 * The thumbnail is a fixed 16:9 box with the picture letterboxed inside, so
 * rows keep one height whatever shape the video is.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import { pathLabel } from '../../lib/collectionTree'
import type { LibraryVideo } from '../../lib/libraryTypes'
import {
  displayTitle,
  formatDuration,
  formatShortDate,
  publishedOnLabel,
} from '../../lib/libraryView'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import type { DragSourceProps } from '../../hooks/useLibraryDrag'
import { usePosterUrl } from '../../hooks/usePosterUrl'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { useRecordMenu } from '../../hooks/useRecordMenu'
import { LanguageChip, LibraryCardMenu, RecordActionsButton, StatusRail } from './LibraryCard'

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
  onOpen: (video: LibraryVideo) => void
}

export function LibraryListRow({
  video,
  collections,
  channels,
  showFolder,
  dragSource,
  onOpen,
  ...actions
}: LibraryListRowProps) {
  const { open, toggle, menu } = useRecordMenu(video, actions)
  const title = displayTitle(video)
  const published = publishedOnLabel(video.publishedOn, channels)

  return (
    <tr
      className="group cursor-pointer transition-colors hover:bg-[var(--color-surface)]"
      style={{ borderBottom: '1px solid var(--color-border)' }}
      title={video.sourcePath}
      {...dragSource}
      onClick={() => onOpen(video)}
    >
      <td className="py-1.5 pr-3">
        <ListThumb video={video} />
      </td>
      <td className="max-w-[18rem] py-1.5 pr-4">
        <NameCell video={video} title={title} onOpen={onOpen} />
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-right tabular-nums" style={MONO}>
        {formatDuration(video.duration)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4">
        <span className="flex items-center gap-2">
          <StatusRail video={video} />
          <span>{statusLabel(video.status)}</span>
        </span>
      </td>
      {showFolder && <FolderCell collections={collections} collectionId={video.collection_id} />}
      <td className="max-w-[12rem] truncate py-1.5 pr-4">{published || EMPTY_CELL}</td>
      <td className="whitespace-nowrap py-1.5 pr-4" style={{ color: 'var(--color-text-3)' }}>
        {formatShortDate(video.updatedAt)}
      </td>
      <td className="relative py-1.5" onClick={(e) => e.stopPropagation()}>
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

/** "captioned" → "Captioned". */
function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

interface NameCellProps {
  video: LibraryVideo
  title: string
  onOpen: (video: LibraryVideo) => void
}

function NameCell({ video, title, onOpen }: NameCellProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className="truncate text-left text-sm"
        style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
        aria-label={`Open ${title}`}
        onClick={(e) => {
          // The row opens on click too; one open per click.
          e.stopPropagation()
          onOpen(video)
        }}
      >
        {title}
      </button>
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
