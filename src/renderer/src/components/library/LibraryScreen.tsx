/**
 * The library home screen — where CapForge opens (v3 §4), laid out like a
 * Finder window (docs/plans/library-finder.md §4): a folder sidebar
 * (`LibrarySidebar`) beside the main column (`LibraryMain`: path bar, toolbar,
 * then the location's folders and videos in the remembered layout).
 *
 * The screen shows one **location** (`lib/libraryLocation.ts`): All videos,
 * the Library root, or a folder. It is remembered with the view prefs, and a
 * remembered folder that is gone resolves to the root here, at render time,
 * without writing the prefs back (a write before the stored prefs are read
 * would win over them).
 *
 * Two kinds of drop land on this screen, and they must never mix:
 *   - **files from the OS** anywhere on the screen import. What a drop means
 *     is `droppedImport` (lib/libraryImport.ts), which sorts it exactly like
 *     an Import… pick: one video opens in the editor; folders, several files
 *     and `.capforge` projects are imported together. The handler runs in the
 *     **capture** phase and stops the event there, so the empty state's own
 *     DropZoneScreen never also handles it;
 *   - **cards, rows and folders** dragged onto a folder, "Library" or a path
 *     crumb move there (`useLibraryDrag`). `dragKind` tells them apart, and the
 *     capture handler and its highlight act on `'files'` only, so an internal
 *     drag never reaches the import.
 *
 * Folder menus and inline renames are screen-wide state (`useFolderMenu`):
 * the same folder can be in the sidebar and the main area at once.
 */

import { useState } from 'react'
import type { DragEvent } from 'react'
import type { FolderActions } from '../../hooks/useFolderActions'
import type { FolderMenuState, FolderSurface } from '../../hooks/useFolderMenu'
import { useFolderMenu } from '../../hooks/useFolderMenu'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { LibrarySelectionActions } from '../../hooks/useLibraryItems'
import { useLibraryDrag } from '../../hooks/useLibraryDrag'
import { useLibraryLocation } from '../../hooks/useLibraryLocation'
import type { LibrarySearchView } from '../../hooks/useLibrarySearch'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import { newCollectionPlacement } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { dragKind } from '../../lib/libraryDrag'
import type { DropPlan, ImportPickMode, ImportPlan, LocateOutcome } from '../../lib/libraryImport'
import { droppedImport, droppedItemsOf, droppedSkippedMessage } from '../../lib/libraryImport'
import { folderLocation, resolveLocation } from '../../lib/libraryLocation'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { warmForFile } from '../screens/DropZoneScreen'
import type { FolderItemUi } from './folderItemUi'
import { LibraryFolderMenu } from './LibraryFolderMenu'
import { LibraryMain } from './LibraryMain'
import { LibrarySidebar } from './LibrarySidebar'

export { droppedNotMediaMessage } from '../../lib/libraryImport'

export interface LibraryScreenProps extends LibrarySelectionActions {
  videos: LibraryVideo[]
  /** The folders (collections), flat; null/absent until they load. */
  collections?: readonly CollectionSummary[] | null
  /** Channel names for the list's "Published on"; null/absent shows the ids. */
  channels?: ChannelNames | null
  loading: boolean
  /** The video whose session is being restored: its card, row or hero says "Opening…". */
  openingVideoId?: string | null
  /** Toolbar: go to the drop screen. */
  onAddVideo: () => void
  /** Import… (toolbar and empty state): open the picker in this mode, import what is picked. */
  onImport: (mode: ImportPickMode) => void
  /** A drop that imports (folders, several files, projects): run its plan. */
  onImportDropped: (plan: ImportPlan) => void
  /** A media file was dropped (or browsed for, from the empty state). */
  onFileDropped: (path: string) => void
  /** A dropped file CapForge cannot open — reported, never ignored. */
  onDropRejected: (message: string) => void
  onRemove: (video: LibraryVideo) => void
  onDelete: (video: LibraryVideo) => void
  /** Card: pick a file for missing media and relink it. */
  onLocate: (video: LibraryVideo) => Promise<LocateOutcome>
  /** Card: link a different file anyway, after the inline confirm. */
  onForceLocate: (video: LibraryVideo, path: string) => void
  /** Create a folder by name, inside `parentId` (absent/null: top level). Never rejects. */
  onCreateCollection: (name: string, parentId?: string | null) => Promise<CreateCollectionResult>
  /** Card: put one video in a folder (null: in none). */
  onMoveToCollection: (video: LibraryVideo, collectionId: string | null) => void
  /** A drop: move these videos into a folder (null: the Library root). */
  onMoveVideos: (videos: LibraryVideo[], collectionId: string | null) => void
  /** Rename, move, delete, adopt, Folder settings… (`useFolderActions`). */
  folderActions: FolderActions
  /** Layout, icon size, sort, location and sidebar (remembered by `useLibraryViewPrefs`). */
  view: LibraryViewPrefs
  onViewChange: (next: LibraryViewPrefs) => void
  /** The search field and the backend's matches (`useLibrarySearch`). */
  search: LibrarySearchView
  onSearchChange: (query: string) => void
}

export function LibraryScreen(props: LibraryScreenProps) {
  const { videos, view } = props
  const collections = props.collections ?? null
  const [dragging, setDragging] = useState(false)
  // Bumped per drop to remount the empty state's DropZoneScreen: the capture
  // handler stops the event before that zone can clear its own highlight.
  const [dropCount, setDropCount] = useState(0)
  const menu = useFolderMenu()
  const drag = useLibraryDrag({
    collections: collections ?? [],
    videos,
    onMoveVideos: props.onMoveVideos,
    onMoveFolder: props.folderActions.moveFolder,
  })
  const location = resolveLocation(view.location, collections, videos)
  const place = useLibraryLocation({ ...props, location })
  const placement = newCollectionPlacement(videos.length, collections)
  const folderUi = (surface: FolderSurface) => folderItemUi(surface, props, drag, menu)

  function handleDrop(e: DragEvent) {
    // An internal drag (a card, a folder) belongs to the folder targets.
    if (dragKind(e.dataTransfer.types) !== 'files') return
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDropCount((n) => n + 1)
    // Read synchronously — the DataTransfer is emptied once the handler returns.
    // Electron 32+ removed File.path → the preload bridge resolves files and folders.
    const items = droppedItemsOf(e.dataTransfer, (file) => window.subforge?.getPathForFile(file))
    runDropPlan(droppedImport(items), props)
  }

  return (
    <section
      aria-label="Library"
      className="screen-in flex min-h-0 min-w-0 flex-1"
      style={{
        background: dragging ? 'var(--color-accent-subtle)' : 'transparent',
        transition: 'background 150ms',
      }}
      onDragOver={(e) => {
        if (dragKind(e.dataTransfer.types) !== 'files') return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDropCapture={handleDrop}
    >
      {placement === 'sidebar' && !view.sidebarCollapsed && (
        <LibrarySidebar
          location={location}
          collections={collections}
          videos={videos}
          expanded={view.expanded}
          ui={folderUi('sidebar')}
          onNavigate={place.navigate}
          onToggleExpanded={place.toggleExpanded}
          onCreateFolder={place.createFolder}
          onFolderCreated={place.revealCreated}
          newFolderTitle={place.newFolderTitle}
        />
      )}
      <LibraryMain
        {...props}
        location={location}
        drag={drag}
        folderUi={folderUi('main')}
        sidebarToggle={
          placement === 'sidebar'
            ? { collapsed: view.sidebarCollapsed, onToggle: place.toggleSidebar }
            : null
        }
        dropZoneKey={dropCount}
        emptyStateCreates={placement === 'empty-state'}
      />
      {menu.menu && (
        <LibraryFolderMenu
          key={`${menu.menu.folder.id}:${menu.menu.x}:${menu.menu.y}`}
          anchor={menu.menu}
          collections={collections ?? []}
          menu={menu}
          actions={props.folderActions}
          onCreateInside={place.createInside}
        />
      )}
    </section>
  )
}

function folderItemUi(
  surface: FolderSurface,
  props: LibraryScreenProps,
  drag: LibraryDrag,
  menu: FolderMenuState
): FolderItemUi {
  return {
    drag,
    renamingId: menu.renaming?.surface === surface ? menu.renaming.id : null,
    onOpen: (folder) => props.onViewChange({ ...props.view, location: folderLocation(folder.id) }),
    onOpenMenu: (folder, point) => menu.openMenu(folder, surface, point),
    onRename: props.folderActions.renameFolder,
    onStopRename: menu.stopRename,
    onStartRename: (folderId) => menu.startRename(folderId, surface),
  }
}

function runDropPlan(plan: DropPlan, props: LibraryScreenProps) {
  if (plan.kind === 'none') return
  if (plan.kind === 'rejected') {
    props.onDropRejected(plan.message)
    return
  }
  if (plan.kind === 'import') {
    props.onImportDropped(plan.plan)
    return
  }
  if (plan.skipped.length > 0) props.onDropRejected(droppedSkippedMessage(plan.skipped))
  props.onFileDropped(plan.path)
  warmForFile()
}
