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
 */

import type { LibraryVideo } from '../../lib/libraryTypes'
import { useCollections } from '../../hooks/useCollections'
import { useLibraryActions } from '../../hooks/useLibraryActions'
import { useToast } from '../../hooks/useToast'
import { useLibraryList } from '../../hooks/useLibraryList'
import { useLibraryMigration } from '../../hooks/useLibraryMigration'
import { LibraryScreen } from './LibraryScreen'

export interface LibraryHomeProps {
  /** A card was opened — App's `session.openRecord`. */
  onOpen: (video: LibraryVideo) => void
  /** Toolbar "Add video" — go to the drop screen. */
  onAddVideo: () => void
  /** One media file was dropped on the library — open it in the editor. */
  onFileDropped: (path: string) => void
  /** App's toast relay; every failure below is reported through it. */
  notify: (message: string) => void
}

export function LibraryHome({ onOpen, onAddVideo, onFileDropped, notify }: LibraryHomeProps) {
  const { videos, loading, refresh } = useLibraryList({ active: true, notify })
  useLibraryMigration({ refresh, notify })
  // LibraryHome renders inside ToastProvider, so an import summary is toasted
  // with its own tone here; App's `notify` relay always shows an error.
  const { toast } = useToast()
  const actions = useLibraryActions({ refresh, notify, inform: toast })
  // Names for the collection filter and the card chips; re-read on every visit.
  const { collections } = useCollections({ notify })

  return (
    <LibraryScreen
      videos={videos}
      collections={collections}
      loading={loading}
      onOpen={onOpen}
      onAddVideo={onAddVideo}
      onImportProjects={actions.importProjects}
      onImportFolder={actions.importFolder}
      onImportFiles={actions.importFiles}
      onFileDropped={onFileDropped}
      onDropRejected={notify}
      onRemove={actions.removeRecord}
      onDelete={actions.deleteRecord}
      onLocate={actions.locate}
      onForceLocate={actions.forceLocate}
    />
  )
}
