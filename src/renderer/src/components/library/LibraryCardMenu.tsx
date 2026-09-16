/**
 * A record's menu — the card's and the list row's, opened by their `…` button
 * or by a right-click (docs/plans/library-finder.md §4.4): Rename, Locate…
 * (missing media only), Move to folder…, Remove from library, Delete record….
 *
 * Presentational, so every state renders to static markup; the state is
 * `useRecordMenu`. Destructive items confirm **inline** — no native dialog,
 * because the renderer's tests have no DOM and a `window.confirm` would be
 * untestable as well as ugly. "Move to folder…" swaps the actions for
 * `MoveToCollectionMenu`.
 *
 * Opened by `…` it hangs under the button (`placement`); opened by a
 * right-click it is a `PointMenu` at the pointer, closed on Esc or a press
 * elsewhere.
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { cn } from '../../lib/cn'
import { pathBaseName } from '../../lib/libraryImport'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle } from '../../lib/libraryView'
import { InlineConfirm, MenuItem } from './LibraryMenuParts'
import { MoveToCollectionMenu } from './MoveToCollectionMenu'
import type { MenuPoint } from './PointMenu'
import { PointMenu } from './PointMenu'

export interface LibraryCardMenuProps {
  video: LibraryVideo
  /** "Delete record…" was clicked; the inline Delete/Cancel shows instead. */
  confirmingDelete: boolean
  /** A different-media file awaiting "link anyway?"; null when none. */
  pendingLinkPath: string | null
  /** "Move to folder…" was clicked; the sub-list shows instead of the actions. */
  moving: boolean
  collections: readonly CollectionSummary[]
  /** Rename in place; absent, the item is not offered. */
  onRename?: () => void
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
  /** Where the menu hangs under its `…`; the card's placement by default. */
  placement?: string
  /** Opened by a right-click: the menu sits at this point instead. */
  point?: MenuPoint | null
  /** Esc or a press elsewhere, for a menu at a point. */
  onDismiss?: () => void
}

/** Under the card's `…` button, which sits in the poster's top-right corner. */
const CARD_MENU_PLACEMENT = 'right-3 top-9'

export function LibraryCardMenu(props: LibraryCardMenuProps) {
  if (props.point) {
    return (
      <PointMenu
        point={props.point}
        label={`Actions for ${displayTitle(props.video)}`}
        onDismiss={props.onDismiss ?? (() => {})}
      >
        <LibraryCardMenuItems {...props} />
      </PointMenu>
    )
  }
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
      <LibraryCardMenuItems {...props} />
    </div>
  )
}

function LibraryCardMenuItems(props: LibraryCardMenuProps) {
  const { video, confirmingDelete, pendingLinkPath } = props
  if (props.moving) {
    return (
      <MoveToCollectionMenu
        collections={props.collections}
        currentId={video.collection_id}
        onPick={props.onPickCollection}
        onCreate={props.onCreateCollection}
        onBack={props.onBackFromMove}
      />
    )
  }
  return (
    <>
      {props.onRename && <MenuItem label="Rename" onClick={props.onRename} />}
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
        <MenuItem label="Delete record…" color="var(--color-danger)" onClick={props.onAskDelete} />
      )}
    </>
  )
}
