/**
 * The library main area's items, wired (docs/plans/library-finder.md §4.4–§4.5):
 * the selection over the visible order, what a click, double-click, name click,
 * right-click and drag do to it, the keyboard on the contents container, the
 * inline video rename, and the selection's commands (the bar and its menu).
 *
 * Every decision is pure — `lib/librarySelection.ts`, `libraryNavigation.ts`,
 * `libraryKeyboard.ts`, `libraryBulk.ts`, `selectionMove.ts` — and each builder
 * below only binds one of them to the screen's callbacks.
 */

import type { MouseEvent } from 'react'
import type { FolderItemUi } from '../components/library/folderItemUi'
import type { LibraryItemUi } from '../components/library/libraryItemUi'
import type { SelectionBarProps } from '../components/library/SelectionBar'
import type { SelectionMenuProps } from '../components/library/SelectionMenu'
import type { CollectionSummary } from '../lib/collectionTypes'
import type { BulkKind } from '../lib/libraryBulk'
import { bulkBlocker } from '../lib/libraryBulk'
import type { LibraryKeyAction } from '../lib/libraryKeyboard'
import type { FolderEntry } from '../lib/libraryLocation'
import type { ItemLayout } from '../lib/libraryNavigation'
import { moveFocus } from '../lib/libraryNavigation'
import type { LibraryLayout } from '../lib/libraryPrefs'
import type { ItemKey, KeyOrigin, Selection, SelectionParts } from '../lib/librarySelection'
import {
  clearSelection,
  clickItem,
  clickModifiers,
  contextSelect,
  dragStart,
  enterTarget,
  isSelected,
  nameClickStartsRename,
  parseItemKey,
  selectAllVideos,
  selectionParts,
  visibleKeys,
} from '../lib/librarySelection'
import type { LibraryVideo } from '../lib/libraryTypes'
import type { RenameRecordResult } from '../lib/recordRename'
import { selectionMoveOptions } from '../lib/selectionMove'
import type { LibraryContainerProps } from './useLibraryKeyboard'
import { onMacPlatform, useLibraryKeyboard } from './useLibraryKeyboard'
import { useLibrarySelection } from './useLibrarySelection'
import type { RenameClick } from './useRenameClick'
import { useRenameClick } from './useRenameClick'
import type { SelectionCommands } from './useSelectionCommands'
import { selectionSignature, useSelectionCommands } from './useSelectionCommands'

/** What the screen does with an item or a selection. */
export interface LibrarySelectionActions {
  /** Double-click / Enter on a video — restore its session, or go transcribe its file. */
  onOpen: (video: LibraryVideo) => void
  /** Never rejects. */
  onRenameVideo: (video: LibraryVideo, name: string) => Promise<RenameRecordResult>
  /** The confirmed bulk Remove: videos only. */
  onRemoveVideos: (videos: LibraryVideo[]) => void
  /** The confirmed bulk Delete: videos only. */
  onDeleteVideos: (videos: LibraryVideo[]) => void
  /** Move to…: the selected videos and folders (null: the top level). */
  onMoveSelection: (videos: LibraryVideo[], folderIds: string[], targetId: string | null) => void
}

export interface LibraryItemsInput {
  /** The location's key: a different one starts with nothing selected. */
  scopeKey: string
  folders: readonly FolderEntry[]
  /** In display order. */
  videos: readonly LibraryVideo[]
  layout: LibraryLayout
  collections: readonly CollectionSummary[]
  folderUi: FolderItemUi
  actions: LibrarySelectionActions
  /** The video whose session is being restored right now (`useLibrarySession`). */
  openingVideoId: string | null
}

export interface LibraryItems {
  item: LibraryItemUi
  containerProps: LibraryContainerProps
  /** The bar in the toolbar's place; null shows the toolbar. */
  bar: SelectionBarProps | null
  /** The selection's right-click menu; null when closed. */
  menu: SelectionMenuProps | null
}

interface Ctx {
  input: LibraryItemsInput
  visible: readonly ItemKey[]
  selection: Selection
  update: (change: (current: Selection) => Selection) => void
  rename: RenameClick
  commands: SelectionCommands
}

function openItem({ input }: Ctx, key: ItemKey) {
  const item = parseItemKey(key)
  if (item?.kind === 'video') {
    const video = input.videos.find((v) => v.id === item.id)
    if (video) input.actions.onOpen(video)
  }
  if (item?.kind === 'folder') {
    const folder = input.folders.find((f) => f.id === item.id)
    if (folder) input.folderUi.onOpen(folder)
  }
}

function startRename({ input, rename }: Ctx, key: ItemKey) {
  const item = parseItemKey(key)
  rename.cancel()
  if (item?.kind === 'video') rename.startVideo(item.id)
  // An orphan id is not a folder yet: it has no name to change.
  if (item?.kind === 'folder' && input.folders.some((f) => f.id === item.id && !f.orphan)) {
    input.folderUi.onStartRename(item.id)
  }
}

function onContextMenu(ctx: Ctx, key: ItemKey, e: MouseEvent): boolean {
  e.preventDefault()
  e.stopPropagation()
  ctx.rename.cancel()
  const next = contextSelect(ctx.selection, key)
  if (next !== ctx.selection) ctx.update(() => next)
  if (next.selected.length < 2) return true
  ctx.commands.openMenu({ x: e.clientX, y: e.clientY })
  return false
}

function buildItemUi(ctx: Ctx): LibraryItemUi {
  const { selection, update, visible, rename, input } = ctx
  const mac = onMacPlatform()
  const renaming = rename.renamingVideoId
  return {
    isSelected: (key) => isSelected(selection, key),
    onSelectClick: (key, e) => {
      rename.cancelOther(key)
      update((current) => clickItem(current, visible, key, clickModifiers(e, mac)))
    },
    onOpenItem: (key) => {
      rename.cancel()
      openItem(ctx, key)
    },
    onNameClick: (key, e) => {
      if (nameClickStartsRename(selection, key, clickModifiers(e, mac), e.detail)) {
        rename.schedule(key, () => startRename(ctx, key))
      } else {
        rename.cancel()
      }
    },
    onContextMenu: (key, e) => onContextMenu(ctx, key, e),
    onVideoDragStart: (videoId) => {
      rename.cancel()
      const started = dragStart(selection, visible, videoId)
      if (started.selection !== selection) update(() => started.selection)
      return started.ids
    },
    renamingVideoId:
      renaming !== null && input.videos.some((v) => v.id === renaming) ? renaming : null,
    openingVideoId: input.openingVideoId,
    onStartRename: (key) => startRename(ctx, key),
    onRenameVideo: input.actions.onRenameVideo,
    onStopRename: rename.stop,
  }
}

function runKeyAction(
  ctx: Ctx,
  action: LibraryKeyAction,
  layout: ItemLayout,
  origin: KeyOrigin,
  focusItem: (key: ItemKey | null) => void
): boolean {
  const { selection, update, visible } = ctx
  ctx.rename.cancel()
  if (action.kind === 'move') {
    const next = moveFocus(selection, visible, layout, action.direction, action.extend)
    update(() => next)
    focusItem(next.focus)
    return visible.length > 0
  }
  if (action.kind === 'select-all') {
    update((current) => selectAllVideos(current, visible))
    return true
  }
  if (action.kind === 'clear') {
    if (selection.selected.length === 0) return false
    update(clearSelection)
    return true
  }
  if (action.kind === 'open') {
    const key = enterTarget(selection, origin)
    if (key !== null) openItem(ctx, key)
    return key !== null
  }
  if (bulkBlocker(selectionParts(selection, visible)) !== null) return false
  ctx.commands.askConfirm('remove')
  return true
}

function selectedVideos(ctx: Ctx, parts: SelectionParts): LibraryVideo[] {
  const ids = new Set(parts.videoIds)
  return ctx.input.videos.filter((v) => ids.has(v.id))
}

function pickMove(ctx: Ctx, parts: SelectionParts, targetId: string | null) {
  const videos = selectedVideos(ctx, parts)
  const options = selectionMoveOptions(ctx.input.collections, videos, parts.folderIds)
  // The checked place is where everything already is: nothing to send.
  if (options.find((o) => o.id === targetId)?.checked) return
  ctx.input.actions.onMoveSelection(videos, parts.folderIds, targetId)
}

function runConfirmed(ctx: Ctx, parts: SelectionParts, kind: BulkKind) {
  const videos = selectedVideos(ctx, parts)
  ctx.commands.cancelConfirm()
  ctx.update(clearSelection)
  if (kind === 'remove') ctx.input.actions.onRemoveVideos(videos)
  else ctx.input.actions.onDeleteVideos(videos)
}

function buildBar(ctx: Ctx, parts: SelectionParts): SelectionBarProps | null {
  const { commands, selection } = ctx
  if (selection.selected.length < 2 && commands.confirming === null) return null
  const videos = selectedVideos(ctx, parts)
  return {
    count: selection.selected.length,
    videoCount: parts.videoIds.length,
    blocker: bulkBlocker(parts),
    confirming: commands.confirming,
    moving: commands.moving,
    moveOptions: selectionMoveOptions(ctx.input.collections, videos, parts.folderIds),
    onToggleMove: commands.toggleMove,
    onCloseMove: commands.closeMove,
    onPickMove: (targetId) => {
      commands.closeMove()
      pickMove(ctx, parts, targetId)
    },
    onAsk: commands.askConfirm,
    onConfirm: () => {
      if (commands.confirming) runConfirmed(ctx, parts, commands.confirming)
    },
    onCancelConfirm: commands.cancelConfirm,
    onClear: () => ctx.update(clearSelection),
  }
}

function buildMenu(ctx: Ctx, parts: SelectionParts): SelectionMenuProps | null {
  const { commands, selection } = ctx
  if (commands.menuPoint === null || selection.selected.length < 2) return null
  const videos = selectedVideos(ctx, parts)
  return {
    point: commands.menuPoint,
    count: selection.selected.length,
    videoCount: parts.videoIds.length,
    blocker: bulkBlocker(parts),
    moveOptions: selectionMoveOptions(ctx.input.collections, videos, parts.folderIds),
    onPickMove: (targetId) => {
      commands.closeMenu()
      pickMove(ctx, parts, targetId)
    },
    onConfirm: (kind) => {
      commands.closeMenu()
      runConfirmed(ctx, parts, kind)
    },
    onDismiss: commands.closeMenu,
  }
}

export function useLibraryItems(input: LibraryItemsInput): LibraryItems {
  const visible = visibleKeys(input.folders, input.videos)
  const { selection, update } = useLibrarySelection(input.scopeKey, visible)
  const rename = useRenameClick(input.scopeKey)
  const commands = useSelectionCommands(selectionSignature(selection))
  const ctx: Ctx = { input, visible, selection, update, rename, commands }
  const keyboard = useLibraryKeyboard({
    layout: input.layout,
    sections: [input.folders.length, input.videos.length],
    onAction: (action, layout, origin) =>
      runKeyAction(ctx, action, layout, origin, keyboard.focusItem),
    onEmptySpaceClick: () => {
      rename.cancel()
      update(clearSelection)
    },
  })
  const parts = selectionParts(selection, visible)
  return {
    item: buildItemUi(ctx),
    containerProps: keyboard.containerProps,
    bar: buildBar(ctx, parts),
    menu: buildMenu(ctx, parts),
  }
}
