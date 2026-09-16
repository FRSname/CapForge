/**
 * The library sidebar (docs/plans/library-finder.md §4.1): "All videos", a
 * "Folders" label, "Library" (the unfiled videos and the top level), then the
 * folder tree — expanded folders remembered in `libraryView.expanded`, counts
 * from `total_members` — and orphan ids with a dashed glyph. "+ New folder" at
 * the foot creates inside the folder on show.
 *
 * "Library" and every real folder take drops (videos move there, folders move
 * inside); a folder can also be dragged. Right-click a folder for its menu.
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryLocation } from '../../lib/libraryLocation'
import {
  ALL_VIDEOS_LABEL,
  ALL_VIDEOS_LOCATION,
  LIBRARY_ROOT_LABEL,
  ROOT_LOCATION,
  folderLocation,
  sameLocation,
} from '../../lib/libraryLocation'
import type { SidebarRow } from '../../lib/librarySidebar'
import { sidebarRows, unfiledCount } from '../../lib/librarySidebar'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { FolderGlyph } from './FolderGlyph'
import { FolderNameInput } from './FolderNameInput'
import { ORPHAN_FOLDER_TITLE } from './FolderTile'
import type { FolderItemUi } from './folderItemUi'
import { contextMenuHandler } from './folderItemUi'
import { LibrarySidebarItem } from './LibrarySidebarItem'
import { NewCollectionPopover } from './NewCollectionForm'

/** The sidebar's fixed width. */
export const LIBRARY_SIDEBAR_WIDTH_PX = 220

const FOLDERS_LABEL_ID = 'library-sidebar-folders'

export interface LibrarySidebarProps {
  location: LibraryLocation
  collections: readonly CollectionSummary[] | null
  videos: readonly LibraryVideo[]
  expanded: readonly string[]
  ui: FolderItemUi
  onNavigate: (location: LibraryLocation) => void
  onToggleExpanded: (folderId: string) => void
  /** "+ New folder": create inside the folder on show. Never rejects. */
  onCreateFolder: (name: string) => Promise<CreateCollectionResult>
  onFolderCreated: (folder: CollectionSummary) => void
  /** Where "+ New folder" creates, for its tooltip. */
  newFolderTitle: string
}

export function LibrarySidebar(props: LibrarySidebarProps) {
  const { location, videos, ui } = props
  const rows = sidebarRows(props.collections, videos, props.expanded, location)
  return (
    <nav
      data-tour="library-sidebar"
      aria-label="Library locations"
      className="app-no-drag flex shrink-0 flex-col gap-3 overflow-y-auto px-2 pb-3 pt-7"
      style={{
        width: `${LIBRARY_SIDEBAR_WIDTH_PX}px`,
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div role="tree" aria-label="Views">
        <LibrarySidebarItem
          label={<span className="truncate">{ALL_VIDEOS_LABEL}</span>}
          name={ALL_VIDEOS_LABEL}
          count={videos.length}
          level={1}
          selected={location.kind === 'all'}
          onActivate={() => props.onNavigate(ALL_VIDEOS_LOCATION)}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-1">
        <p
          id={FOLDERS_LABEL_ID}
          className="px-2 text-[11px] uppercase tracking-widest"
          style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
        >
          Folders
        </p>
        <div role="tree" aria-labelledby={FOLDERS_LABEL_ID}>
          <LibrarySidebarItem
            label={<span className="truncate">{LIBRARY_ROOT_LABEL}</span>}
            name={LIBRARY_ROOT_LABEL}
            count={unfiledCount(videos)}
            level={1}
            selected={location.kind === 'root'}
            target={ui.drag.target(null, 'sidebar:root')}
            onActivate={() => props.onNavigate(ROOT_LOCATION)}
          />
          {rows.map((row) => (
            <FolderTreeItem key={row.entry.id} row={row} {...props} />
          ))}
        </div>
      </div>
      <NewCollectionPopover
        onCreate={props.onCreateFolder}
        onCreated={props.onFolderCreated}
        side="above"
        label="+ New folder"
        title={props.newFolderTitle}
        className="w-full text-left"
      />
    </nav>
  )
}

function FolderTreeItem({ row, ...props }: LibrarySidebarProps & { row: SidebarRow }) {
  const { entry } = row
  const { ui } = props
  const renaming = ui.renamingId === entry.id
  return (
    <LibrarySidebarItem
      label={
        renaming ? (
          <FolderNameInput folder={entry} ui={ui} />
        ) : (
          <span
            className="truncate"
            style={entry.orphan ? { fontFamily: 'var(--cf-font-mono)' } : undefined}
          >
            {entry.name}
          </span>
        )
      }
      name={entry.name}
      count={entry.videoCount}
      level={row.depth + 1}
      selected={sameLocation(props.location, folderLocation(entry.id))}
      expanded={row.hasChildren ? row.expanded : undefined}
      glyph={<FolderGlyph orphan={entry.orphan} />}
      title={entry.orphan ? ORPHAN_FOLDER_TITLE : entry.path}
      source={entry.orphan || renaming ? undefined : ui.drag.folderSource(entry.id)}
      target={entry.orphan ? null : ui.drag.target(entry.id, `sidebar:${entry.id}`)}
      onActivate={() => {
        if (!renaming) props.onNavigate(folderLocation(entry.id))
      }}
      onToggle={row.hasChildren ? () => props.onToggleExpanded(entry.id) : undefined}
      onContextMenu={contextMenuHandler(entry, ui)}
    />
  )
}
