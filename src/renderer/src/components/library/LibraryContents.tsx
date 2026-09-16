/**
 * The main area's body: what the location (or the search) shows, in the
 * remembered layout. Folders come first, by name, whatever the video sort;
 * the Continue hero shows only at All videos and the Library root, in grid,
 * and not while searching. An empty folder says so and takes drops.
 */

import type { CollectionSummary } from '../../lib/collectionTypes'
import type { LibraryLocation, Shown } from '../../lib/libraryLocation'
import {
  EMPTY_FOLDER_MESSAGE,
  showsContinueHero,
  showsFolderColumn,
} from '../../lib/libraryLocation'
import type { LibraryViewPrefs } from '../../lib/libraryPrefs'
import { noMatchMessage } from '../../lib/librarySearch'
import { sortVideos } from '../../lib/librarySort'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { continueCandidate } from '../../lib/libraryView'
import type { ChannelNames } from '../../hooks/useLibraryChannels'
import type { LibraryDrag } from '../../hooks/useLibraryDrag'
import type { LibrarySearchView } from '../../hooks/useLibrarySearch'
import type { RecordMenuActions } from '../../hooks/useRecordMenu'
import { ContinueHero } from './ContinueHero'
import { DROP_TARGET_STYLE } from './folderItemUi'
import type { FolderItemUi } from './folderItemUi'
import { LibraryGrid } from './LibraryGrid'
import { LibraryList } from './LibraryList'

export interface LibraryContentsProps extends RecordMenuActions {
  /** Every video: the Continue hero is the session last worked on, wherever it is filed. */
  allVideos: readonly LibraryVideo[]
  shown: Shown
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
  onOpen: (video: LibraryVideo) => void
}

export function LibraryContents(props: LibraryContentsProps) {
  const { shown, location, view, searching, drag } = props
  const hero = showsContinueHero(location, view.layout, searching)
    ? continueCandidate(props.allVideos)
    : null
  const videos = sortVideos(shown.videos, view.sort).filter((v) => v.id !== hero?.id)
  const empty = shown.folders.length === 0 && shown.videos.length === 0
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
    folders: shown.folders,
    videos,
    collections: props.collections,
    showFolder,
    folderUi: props.folderUi,
    drag,
    onOpen: props.onOpen,
    ...actions,
  }

  return (
    <div className="flex flex-col gap-8 px-8 pb-10">
      {empty && <EmptyLine {...props} />}
      {hero && <ContinueHero video={hero} onOpen={props.onOpen} />}
      {(shown.folders.length > 0 || videos.length > 0) && (
        <div className="flex flex-col gap-3">
          {(hero || searching) && (
            <h2
              className="text-[11px] uppercase tracking-widest"
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
