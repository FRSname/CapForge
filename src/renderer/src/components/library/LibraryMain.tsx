/**
 * The library's main column: the masthead (the sidebar toggle, the path bar
 * with its count, the toolbar), the search scope toggle while searching inside
 * a folder, then the contents — or the empty state when the library holds no
 * video at all.
 *
 * The scope toggle — **This folder** (with its subfolders, the default) or
 * **All videos** — only exists inside a folder, and goes back to "This folder"
 * whenever the location changes: the choice is remembered together with the
 * location it was made in, and a different location reads as the default.
 *
 * The main column also owns the selection (`useLibraryItems`), because it
 * spans the masthead and the contents: with two or more items selected the
 * toolbar gives its place to the selection bar, and a right-click inside a
 * multi-selection opens the selection's menu.
 */

import { useState } from 'react'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import { useLibraryItems } from '../../hooks/useLibraryItems'
import type { LibraryLocation, SearchScope } from '../../lib/libraryLocation'
import {
  DEFAULT_SEARCH_SCOPE,
  breadcrumb,
  hasScopeToggle,
  locationKey,
  shownAt,
  visibleContents,
} from '../../lib/libraryLocation'
import { isSearching } from '../../lib/librarySearch'
import { SegmentedControl } from '../ui/SegmentedControl'
import type { FolderItemUi } from './folderItemUi'
import { LibraryContents } from './LibraryContents'
import { LibraryEmptyState } from './LibraryEmptyState'
import { LibraryPathBar } from './LibraryPathBar'
import type { LibraryScreenProps } from './LibraryScreen'
import type { SidebarToggleProps } from './LibraryToolbar'
import { LibraryToolbar, SidebarToggle } from './LibraryToolbar'
import { SelectionBar } from './SelectionBar'
import { SelectionMenu } from './SelectionMenu'

const SCOPE_OPTIONS: ReadonlyArray<{ value: SearchScope; label: React.ReactNode }> = [
  { value: 'folder', label: <span className="whitespace-nowrap px-2.5">This folder</span> },
  { value: 'everywhere', label: <span className="whitespace-nowrap px-2.5">All videos</span> },
]

export interface LibraryMainProps extends LibraryScreenProps {
  location: LibraryLocation
  drag: LibraryDrag
  folderUi: FolderItemUi
  /** Null when there is no sidebar to toggle (an empty library with no folders). */
  sidebarToggle: SidebarToggleProps | null
  /** Changes per file drop, remounting the empty state's drop zone. */
  dropZoneKey: number
  /** The empty state offers "New folder…" (no folders exist yet). */
  emptyStateCreates: boolean
}

export function LibraryMain(props: LibraryMainProps) {
  const { videos, loading, view, search, location } = props
  const collections = props.collections ?? null
  const key = locationKey(location)
  const [scopeChoice, setScopeChoice] = useState({ key, scope: DEFAULT_SEARCH_SCOPE })
  const scope = scopeChoice.key === key ? scopeChoice.scope : DEFAULT_SEARCH_SCOPE
  const searching = isSearching(search.query)
  const shown = shownAt(location, collections, videos, {
    searching,
    query: search.query,
    matchIds: search.matchIds,
    scope,
  })
  const hasVideos = videos.length > 0
  const contents = visibleContents(shown, location, view, searching, videos)
  const items = useLibraryItems({
    scopeKey: key,
    folders: contents.folders,
    videos: contents.videos,
    layout: view.layout,
    collections: collections ?? [],
    folderUi: props.folderUi,
    actions: props,
    openingVideoId: props.openingVideoId ?? null,
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-8 pb-4 pt-7">
        <div className="flex min-w-0 items-end gap-2">
          {props.sidebarToggle && <SidebarToggle {...props.sidebarToggle} />}
          <LibraryPathBar
            crumbs={breadcrumb(location, collections)}
            countLabel={
              loading ? 'loading…' : countLabel(shown.videos.length, shown.total, searching)
            }
            drag={props.drag}
            onNavigate={(next) => props.onViewChange({ ...view, location: next })}
          />
        </div>
        {items.bar ? (
          <SelectionBar {...items.bar} />
        ) : (
          <LibraryToolbar
            onImport={props.onImport}
            onAddVideo={props.onAddVideo}
            view={hasVideos ? view : null}
            onViewChange={props.onViewChange}
            searchQuery={search.query}
            onSearchChange={props.onSearchChange}
          />
        )}
      </header>

      {hasVideos && searching && hasScopeToggle(location) && (
        <div className="app-no-drag flex items-center gap-2 px-8 pb-4 text-xs">
          <span style={{ color: 'var(--color-text-3)' }}>Search in</span>
          <SegmentedControl
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(next) => setScopeChoice({ key, scope: next })}
            ariaLabel="Search in"
          />
        </div>
      )}

      {hasVideos ? (
        <LibraryContents
          {...props}
          contents={contents}
          item={items.item}
          containerProps={items.containerProps}
          collections={collections ?? []}
          channels={props.channels ?? null}
          searching={searching}
          searchInFolder={hasScopeToggle(location) && scope === 'folder'}
        />
      ) : (
        <LibraryEmptyState
          dropZoneKey={props.dropZoneKey}
          onFileSelected={props.onFileDropped}
          onStart={props.onAddVideo}
          onImport={props.onImport}
          onCreateCollection={props.emptyStateCreates ? props.onCreateCollection : undefined}
        />
      )}
      {items.menu && (
        <SelectionMenu key={`${items.menu.point.x}:${items.menu.point.y}`} {...items.menu} />
      )}
    </div>
  )
}

/** "3 videos", or "2 of 3 videos" while a search narrows its scope. */
function countLabel(shown: number, total: number, narrowed: boolean): string {
  const noun = `video${total === 1 ? '' : 's'}`
  return narrowed ? `${shown} of ${total} ${noun}` : `${shown} ${noun}`
}
