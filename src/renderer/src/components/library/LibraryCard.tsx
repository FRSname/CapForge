/**
 * One library record, as a card.
 *
 * The poster block (`LibraryPoster`) takes the video's own ratio, so a 9:16
 * recording is a tall card in its grid column rather than a letterboxed 16:9
 * one; it carries the duration badge and the missing-media chip.
 *
 * The `…` menu's state lives in `useRecordMenu` (the list row shares it and
 * `LibraryCardMenu`), and the destructive item confirms **inline**:
 * no native dialog, because the renderer's tests have no DOM and a
 * `window.confirm` would be untestable as well as ugly. A record whose media
 * is missing also gets "Locate…"; if the picked file is different media, the
 * same inline pattern asks before linking it anyway. "Move to folder…" swaps
 * the actions for `MoveToCollectionMenu`.
 *
 * The card drags as `application/x-capforge-videos` onto a folder
 * (`useLibraryDrag`); the caller hands in its drag-source props.
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { cn } from '../../lib/cn'
import { pathBaseName } from '../../lib/libraryImport'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle, formatShortDate, statusPips } from '../../lib/libraryView'
import type { DragSourceProps } from '../../hooks/useLibraryDrag'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { useRecordMenu } from '../../hooks/useRecordMenu'
import { InlineConfirm, MenuItem } from './LibraryMenuParts'
import { LibraryPoster } from './LibraryPoster'
import { MoveToCollectionMenu } from './MoveToCollectionMenu'

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
  onOpen: (video: LibraryVideo) => void
}

export function LibraryCard({
  video,
  folder,
  collections,
  dragSource,
  onOpen,
  ...actions
}: LibraryCardProps) {
  const { open, toggle, menu } = useRecordMenu(video, actions)
  const title = displayTitle(video)

  return (
    <div className="group relative flex flex-col gap-2.5" {...dragSource}>
      <button
        type="button"
        className="flex flex-col gap-2.5 rounded-xl p-2 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        title={video.sourcePath}
        aria-label={`Open ${title}`}
        onClick={() => onOpen(video)}
      >
        <LibraryPoster video={video} />
        <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
          <span
            className="truncate text-sm"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
          >
            {title}
          </span>
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
      </button>

      <RecordActionsButton
        title={title}
        className="absolute right-3 top-3 opacity-0 group-hover:opacity-100"
        onClick={toggle}
      />

      {open && <LibraryCardMenu video={video} collections={collections} {...menu} />}
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

export interface LibraryCardMenuProps {
  video: LibraryVideo
  /** "Delete record…" was clicked; the inline Delete/Cancel shows instead. */
  confirmingDelete: boolean
  /** A different-media file awaiting "link anyway?"; null when none. */
  pendingLinkPath: string | null
  /** "Move to folder…" was clicked; the sub-list shows instead of the actions. */
  moving: boolean
  collections: readonly CollectionSummary[]
  onRemove: () => void
  onAskDelete: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onLocate: () => void
  onLink: () => void
  onCancelLink: () => void
  onAskMove: () => void
  onBackFromMove: () => void
  onPickCollection: (collectionId: string | null) => void
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
  /** Where the menu hangs; the card's placement by default. */
  placement?: string
}

/** Under the card's `…` button, which sits in the poster's top-right corner. */
const CARD_MENU_PLACEMENT = 'right-3 top-9'

/** The card's `…` menu — presentational, so every state renders to static markup. */
export function LibraryCardMenu(props: LibraryCardMenuProps) {
  const { video, confirmingDelete, pendingLinkPath } = props
  return (
    <div
      role="menu"
      className={cn(
        'absolute z-10 flex w-52 flex-col rounded-lg p-1 text-left text-xs',
        props.placement ?? CARD_MENU_PLACEMENT
      )}
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      {props.moving ? (
        <MoveToCollectionMenu
          collections={props.collections}
          currentId={video.collection_id}
          onPick={props.onPickCollection}
          onCreate={props.onCreateCollection}
          onBack={props.onBackFromMove}
        />
      ) : (
        <>
          {video.missing_media &&
            (pendingLinkPath ? (
              <InlineConfirm
                prompt="Different file — link anyway?"
                title={`${pathBaseName(pendingLinkPath)} is not the media this video was made from`}
                confirmLabel="Link"
                confirmColor="var(--color-brand)"
                onConfirm={props.onLink}
                onCancel={props.onCancelLink}
              />
            ) : (
              <MenuItem
                label="Locate…"
                title={`Find the moved file: ${video.sourcePath}`}
                onClick={props.onLocate}
              />
            ))}
          <MenuItem label="Move to folder…" onClick={props.onAskMove} />
          <MenuItem label="Remove from library" onClick={props.onRemove} />
          {confirmingDelete ? (
            <InlineConfirm
              prompt="Delete?"
              confirmLabel="Delete"
              confirmColor="var(--color-danger)"
              onConfirm={props.onDelete}
              onCancel={props.onCancelDelete}
            />
          ) : (
            <MenuItem
              label="Delete record…"
              color="var(--color-danger)"
              onClick={props.onAskDelete}
            />
          )}
        </>
      )}
    </div>
  )
}
