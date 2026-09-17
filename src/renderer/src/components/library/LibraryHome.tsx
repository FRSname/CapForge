/**
 * The library screen's container: it owns the data loading and the side
 * effects, `LibraryScreen` stays presentational.
 *
 * It exists because `App.tsx` is at its size ceiling (§9.3) and because the
 * three concerns wired here — the list, the first-launch migration and the
 * record actions — belong together: all three end in the same `refresh()`.
 *
 * Mounted only while the library screen is on show, so the list is re-fetched
 * every time the user comes back to it (a session that just finished
 * transcribing has moved its record up the status ladder). The migration is
 * flag-guarded, so a remount costs one `app-state` read.
 *
 * It also owns the view state that must outlive a re-render but not the
 * screen: the remembered layout/size/sort/location/sidebar
 * (`useLibraryViewPrefs`), the search field (`useLibrarySearch`, cleared on
 * leaving), the channel names the list view shows, the folder actions
 * (`useLibraryCollectionActions`, `useFolderActions`), the selection's bulk
 * Remove / Delete / Move to… and the video rename (`useRecordRename`), and ⌘O → Import…
 * (`useLibraryImportShortcut`), which is why that shortcut does nothing on any
 * other screen.
 */

import type { ImportPickMode } from '../../lib/libraryImport'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { useCollections } from '../../hooks/useCollections'
import { useFolderActions } from '../../hooks/useFolderActions'
import { useImportChannels } from '../../hooks/useImportChannels'
import { useLibraryActions } from '../../hooks/useLibraryActions'
import { useLibraryChannels } from '../../hooks/useLibraryChannels'
import { useLibraryCollectionActions } from '../../hooks/useLibraryCollectionActions'
import { useToast } from '../../hooks/useToast'
import { useLibraryList } from '../../hooks/useLibraryList'
import { useLibraryImportShortcut } from '../../hooks/useLibraryImportShortcut'
import { useLibraryMigration } from '../../hooks/useLibraryMigration'
import { useLibrarySearch } from '../../hooks/useLibrarySearch'
import { useLibraryViewPrefs } from '../../hooks/useLibraryViewPrefs'
import { useRecordRename } from '../../hooks/useRecordRename'
import { LibraryScreen } from './LibraryScreen'

export interface LibraryHomeProps {
  /** A card was opened — App's `session.openRecord`. */
  onOpen: (video: LibraryVideo) => void
  /** App's `session.openingVideoId`: the record whose open is in flight. */
  openingVideoId?: string | null
  /** Toolbar "Add video" — go to the drop screen. */
  onAddVideo: () => void
  /** One media file was dropped on the library — open it in the editor. */
  onFileDropped: (path: string) => void
  /** App's toast relay; every failure below is reported through it. */
  notify: (message: string) => void
}

export function LibraryHome({
  onOpen,
  openingVideoId = null,
  onAddVideo,
  onFileDropped,
  notify,
}: LibraryHomeProps) {
  const { videos, loading, refresh } = useLibraryList({ active: true, notify })
  useLibraryMigration({ refresh, notify })
  // LibraryHome renders inside ToastProvider, so the one import summary is
  // toasted with its own tone here; App's `notify` relay always shows an error.
  const { toast } = useToast()
  // Asked once per import, before any request: the sheet is mounted below.
  const importChannels = useImportChannels({ inform: (message) => toast(message, 'info') })
  // The folder tree, its counts and the card chips; re-read on every visit.
  const { collections, refresh: refreshCollections } = useCollections({ notify })
  const actions = useLibraryActions({
    refresh,
    refreshCollections,
    notify,
    inform: toast,
    askChannels: importChannels.ask,
  })
  const renameVideo = useRecordRename({ refresh, notify })
  const collectionActions = useLibraryCollectionActions({
    collections,
    refresh,
    refreshCollections,
    notify,
    inform: (message) => toast(message, 'success'),
  })
  const folderActions = useFolderActions({
    collections,
    refreshCollections,
    notify,
    inform: (message) => toast(message, 'success'),
    explain: (message) => toast(message, 'info'),
  })
  const { prefs, setPrefs } = useLibraryViewPrefs({ notify })
  const search = useLibrarySearch({ notify })
  const channels = useLibraryChannels({ wanted: prefs.layout === 'list', notify })
  const pickAndImport = (mode: ImportPickMode) => void actions.pickAndImport(mode)
  useLibraryImportShortcut({ onImport: pickAndImport, enabled: importChannels.sheet === null })

  return (
    <>
      <LibraryScreen
        videos={videos}
        collections={collections}
        channels={channels}
        loading={loading}
        onOpen={onOpen}
        openingVideoId={openingVideoId}
        onAddVideo={onAddVideo}
        onImport={pickAndImport}
        onImportDropped={(plan) => void actions.runImport(plan)}
        onFileDropped={onFileDropped}
        onDropRejected={notify}
        onRemove={actions.removeRecord}
        onDelete={actions.deleteRecord}
        onLocate={actions.locate}
        onForceLocate={actions.forceLocate}
        onCreateCollection={collectionActions.createCollection}
        onMoveToCollection={(video, collectionId) =>
          void collectionActions.moveVideos([video], collectionId)
        }
        onMoveVideos={(moving, collectionId) =>
          void collectionActions.moveVideos(moving, collectionId)
        }
        onMoveSelection={(moving, folderIds, targetId) =>
          void collectionActions.moveSelection(moving, folderIds, targetId)
        }
        onRemoveVideos={(removing) => void actions.removeRecords(removing)}
        onDeleteVideos={(deleting) => void actions.deleteRecords(deleting)}
        onRenameVideo={renameVideo}
        folderActions={folderActions}
        view={prefs}
        onViewChange={setPrefs}
        search={search}
        onSearchChange={search.setQuery}
      />
      {importChannels.sheet}
    </>
  )
}
