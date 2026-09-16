/**
 * One library record, as a card.
 *
 * The poster block (`LibraryPoster`) takes the video's own ratio, so a 9:16
 * recording is a tall card in its grid column rather than a letterboxed 16:9
 * one; it carries the duration badge and the missing-media chip.
 *
 * A card is an `option` of the grid's listbox (docs/plans/library-finder.md
 * §4.4): a click **selects** it, a double-click (or Enter) opens it, and a
 * click on the name of the card that already was the one selected renames it
 * in place (`VideoNameInput`). A right-click selects it and opens its menu at
 * the pointer — or, inside a multi-selection, the selection's menu. The `…`
 * menu (`LibraryCardMenu`, state in `useRecordMenu`) never changes the
 * selection.
 *
 * The card drags as `application/x-capforge-videos` onto a folder
 * (`useLibraryDrag`); the caller hands in its drag-source props, which carry
 * the whole selection when the card is part of it.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { videoKey } from '../../lib/librarySelection'
import { cn } from '../../lib/cn'
import { displayTitle, formatShortDate, statusPips } from '../../lib/libraryView'
import type { DragSourceProps } from '../../hooks/useLibraryDrag'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { useRecordMenu } from '../../hooks/useRecordMenu'
import { LibraryCardMenu } from './LibraryCardMenu'
import type { LibraryItemUi } from './libraryItemUi'
import { INERT_LIBRARY_ITEM_UI, SELECTED_ITEM_STYLE, itemAttributes } from './libraryItemUi'
import { LibraryPoster } from './LibraryPoster'
import { VideoNameInput } from './VideoNameInput'

export { LibraryCardMenu } from './LibraryCardMenu'
export type { LibraryCardMenuProps } from './LibraryCardMenu'

/** The status rail, in ladder order — also used by the Continue hero. */
const PIP_LABELS = ['Transcribed', 'Captioned', 'Drafted', 'Published'] as const

export interface StatusRailProps {
  video: LibraryVideo
}

export function StatusRail({ video }: StatusRailProps) {
  const pips = statusPips(video.status)
  const lit = [pips.transcribed, pips.captioned, pips.drafted, pips.published]
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Status: ${video.status}`}
      title={PIP_LABELS.filter((_, i) => lit[i]).join(' · ') || 'Imported'}
    >
      {PIP_LABELS.map((label, i) => (
        <span
          key={label}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: lit[i] ? 'var(--color-brand)' : 'var(--color-border-3)',
            opacity: lit[i] ? 1 : 0.6,
          }}
        />
      ))}
    </div>
  )
}

/** The language chip — TrackTabs' badge style, reused verbatim. */
export function LanguageChip({ lang }: { lang: string | null }) {
  if (!lang) return null
  return (
    <span
      className="rounded px-1 text-2xs uppercase tabular-nums"
      style={{ color: 'var(--color-text-3)', background: 'var(--color-surface-3)' }}
      title={`Caption language: ${lang}`}
    >
      {lang}
    </span>
  )
}

/** The folder a record is in, by name, its path in the tooltip — nothing for an unfiled one. */
export function CollectionChip({ folder }: { folder: FolderChip | null | undefined }) {
  if (!folder) return null
  return (
    <span
      className="max-w-[96px] truncate rounded px-1 text-2xs"
      style={{ color: 'var(--color-brand)', background: 'var(--color-surface-3)' }}
      title={`Folder: ${folder.path}`}
    >
      {folder.name}
    </span>
  )
}

/** What the card's folder chip shows. */
export interface FolderChip {
  name: string
  /** `Events › UCK26`; an orphan's bare id. */
  path: string
}

export interface LibraryCardProps extends RecordMenuActions {
  video: LibraryVideo
  /** The record's folder, for the chip; absent or null hides it. */
  folder?: FolderChip | null
  /** Every folder, for "Move to folder…". */
  collections: readonly CollectionSummary[]
  /** Drag the card onto a folder; absent, it does not drag. */
  dragSource?: DragSourceProps
  /** Selection, opening and rename; inert when absent. */
  item?: LibraryItemUi
}

const CARD_BOX_CLASS = 'flex flex-col gap-2.5 rounded-xl p-2 text-left'

export function LibraryCard({
  video,
  folder,
  collections,
  dragSource,
  item = INERT_LIBRARY_ITEM_UI,
  ...actions
}: LibraryCardProps) {
  const { open, toggle, openAt, close, menu } = useRecordMenu(video, actions)
  const title = displayTitle(video)
  const key = videoKey(video.id)
  const selected = item.isSelected(key)
  const renaming = item.renamingVideoId === video.id
  const boxStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    ...(selected ? SELECTED_ITEM_STYLE : {}),
  }
  const body = (
    <>
      <LibraryPoster video={video} />
      <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
        {renaming ? (
          <VideoNameInput video={video} item={item} />
        ) : (
          <span
            className="truncate text-sm"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
            onClick={(e) => item.onNameClick(key, e)}
          >
            {title}
          </span>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <StatusRail video={video} />
          <LanguageChip lang={video.language} />
          <CollectionChip folder={folder} />
          <span
            className="ml-auto shrink-0 whitespace-nowrap text-2xs"
            style={{ color: 'var(--color-text-3)' }}
          >
            {formatShortDate(video.updatedAt)}
          </span>
        </div>
      </div>
    </>
  )

  return (
    <div
      className="group relative flex flex-col gap-2.5"
      {...(renaming ? { draggable: false } : dragSource)}
      onContextMenu={(e) => {
        if (item.onContextMenu(key, e)) openAt({ x: e.clientX, y: e.clientY })
      }}
    >
      {renaming ? (
        <div
          {...itemAttributes(key, selected, 'option')}
          className={CARD_BOX_CLASS}
          style={boxStyle}
        >
          {body}
        </div>
      ) : (
        <button
          type="button"
          {...itemAttributes(key, selected, 'option')}
          className={cn(
            CARD_BOX_CLASS,
            'transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5'
          )}
          style={boxStyle}
          title={video.sourcePath}
          aria-label={title}
          onClick={(e) => item.onSelectClick(key, e)}
          onDoubleClick={() => item.onOpenItem(key)}
        >
          {body}
        </button>
      )}

      {!renaming && (
        <RecordActionsButton
          title={title}
          className="absolute right-3 top-3 opacity-0 group-hover:opacity-100"
          onClick={toggle}
        />
      )}

      {open && (
        <LibraryCardMenu
          video={video}
          collections={collections}
          {...menu}
          onRename={() => {
            close()
            item.onStartRename(key)
          }}
        />
      )}
    </div>
  )
}

export interface RecordActionsButtonProps {
  title: string
  /** Placement and visibility; the button is always shown on keyboard focus. */
  className?: string
  onClick: () => void
}

/** The `…` button that opens a record's menu — the card's and the list row's. */
export function RecordActionsButton({ title, className, onClick }: RecordActionsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${title}`}
      title="Record actions"
      className={cn(
        'rounded px-1.5 text-xs transition-opacity focus-visible:opacity-100',
        className
      )}
      style={{ color: 'var(--color-text-2)', background: 'var(--color-base)' }}
      onClick={onClick}
    >
      ⋯
    </button>
  )
}
