/**
 * The main area's body: what the location (or the search) shows, in the
 * remembered layout (`visibleContents`). Folders come first, by name, whatever
 * the video sort; the Continue hero shows only at All videos and the Library
 * root, in grid, and not while searching. An empty folder says so and takes
 * drops.
 *
 * The body is also the selection's keyboard scope (`useLibraryItems`): it
 * takes the keys while the focus is inside it, and a click on its empty space
 * clears the selection. The Continue hero stays a single-click button.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryLocation, VisibleContents } from '../../lib/libraryLocation'
import { EMPTY_FOLDER_MESSAGE, showsFolderColumn } from '../../lib/libraryLocation'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import { noMatchMessage } from '../../lib/librarySearch'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { LibraryContainerProps } from '../../hooks/useLibraryKeyboard'
import type { LibrarySearchView } from '../../hooks/useLibrarySearch'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { ContinueHero } from './ContinueHero'
import { DROP_TARGET_STYLE } from './folderItemUi'
import type { FolderItemUi } from './folderItemUi'
import { LibraryGrid } from './LibraryGrid'
import type { LibraryItemUi } from './libraryItemUi'
import { LibraryList } from './LibraryList'

export interface LibraryContentsProps extends RecordMenuActions {
  /** The hero, the folders and the sorted videos, as drawn. */
  contents: VisibleContents
  location: LibraryLocation
  collections: readonly CollectionSummary[]
  channels: ChannelNames | null
  view: LibraryViewPrefs
  onViewChange: (next: LibraryViewPrefs) => void
  search: LibrarySearchView
  searching: boolean
  /** The search is limited to the folder on show. */
  searchInFolder: boolean
  folderUi: FolderItemUi
  drag: LibraryDrag
  /** The hero's single click. */
  onOpen: (video: LibraryVideo) => void
  /** Selection, opening and rename for every item. */
  item: LibraryItemUi
  /** The keyboard scope and the empty-space click. */
  containerProps: LibraryContainerProps
}

export function LibraryContents(props: LibraryContentsProps) {
  const { contents, location, view, searching, drag } = props
  const { hero, folders, videos } = contents
  const empty = folders.length === 0 && videos.length === 0 && hero === null
  const showFolder = showsFolderColumn(location, searching)
  const actions: RecordMenuActions = {
    onRemove: props.onRemove,
    onDelete: props.onDelete,
    onLocate: props.onLocate,
    onForceLocate: props.onForceLocate,
    onMoveToCollection: props.onMoveToCollection,
    onCreateCollection: props.onCreateCollection,
  }
  const shared = {
    folders,
    videos,
    collections: props.collections,
    showFolder,
    folderUi: props.folderUi,
    drag,
    item: props.item,
    ...actions,
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-8 pb-10 outline-none" {...props.containerProps}>
      {empty && <EmptyLine {...props} />}
      {hero && (
        <ContinueHero
          video={hero}
          onOpen={props.onOpen}
          opening={props.item.openingVideoId === hero.id}
        />
      )}
      {(folders.length > 0 || videos.length > 0) && (
        <div className="flex flex-col gap-3">
          {(hero || searching) && (
            <h2
              className="text-xs-plus uppercase tracking-widest"
              style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
            >
              {searching ? 'Search results' : 'Videos'}
            </h2>
          )}
          {view.layout === 'list' ? (
            <LibraryList
              {...shared}
              channels={props.channels}
              sort={view.sort}
              onSortChange={(sort) => props.onViewChange({ ...view, sort })}
            />
          ) : (
            <LibraryGrid {...shared} tileSize={view.tileSize} />
          )}
        </div>
      )}
    </div>
  )
}

/** "No videos match …" for a search, or the empty folder's line (a drop target). */
function EmptyLine({ location, searching, search, searchInFolder, drag }: LibraryContentsProps) {
  if (searching) {
    if (search.matchIds === null) return null
    return (
      <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
        {noMatchMessage(search.query, searchInFolder)}
      </p>
    )
  }
  if (location.kind !== 'folder') return null
  const target = drag.target(location.id, `empty:${location.id}`)
  return (
    <p
      className="rounded-xl border border-dashed px-4 py-10 text-center text-xs"
      style={{
        color: 'var(--color-text-3)',
        borderColor: 'var(--color-border-2)',
        ...(target.over ? DROP_TARGET_STYLE : {}),
      }}
      {...target.props}
    >
      {EMPTY_FOLDER_MESSAGE}
    </p>
  )
}
