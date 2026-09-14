/**
 * The library with nothing in it.
 *
 * The drop affordance is `DropZoneScreen` itself — the same component the
 * `'file'` screen shows, so there is exactly one drop target implementation and
 * exactly one list of accepted extensions. Browsing for a file here hands it
 * straight to App, which creates the record and moves to the file screen.
 * A *drop* is handled by `LibraryScreen` before it reaches the zone (a folder
 * or several files mean something else there), which is why the zone is keyed:
 * a remount per drop clears the highlight it never got to clear itself.
 *
 * A creator's recordings live in folders, so importing a whole folder is
 * offered right here too, not only in the toolbar.
 */

import { DropZoneScreen } from '../screens/DropZoneScreen'
import { Button } from '../ui/Button'

export interface LibraryEmptyStateProps {
  /** A media file was browsed for. */
  onFileSelected: (path: string) => void
  /** The file is chosen — go transcribe it. */
  onStart: () => void
  /** Pick a folder and import every recording in it. */
  onImportFolder: () => void
  /** Changes per drop on the library, remounting the drop zone. */
  dropZoneKey?: number
}

export function LibraryEmptyState({
  onFileSelected,
  onStart,
  onImportFolder,
  dropZoneKey,
}: LibraryEmptyStateProps) {
  return (
    <section
      aria-labelledby="library-empty-heading"
      className="flex flex-1 flex-col items-center justify-center gap-1 py-6"
    >
      <h2
        id="library-empty-heading"
        className="text-2xl"
        style={{
          fontFamily: 'var(--cf-font-display)',
          fontStyle: 'italic',
          color: 'var(--color-text)',
        }}
      >
        Your library is empty
      </h2>
      <p className="text-xs" style={{ color: 'var(--color-text-2)' }}>
        Drop a video — or a whole folder — to start a record. Everything you do to it is kept here.
      </p>
      <DropZoneScreen
        key={dropZoneKey}
        filePath={null}
        onFileSelected={onFileSelected}
        onStart={onStart}
      />
      <Button variant="ghost" className="text-xs" onClick={onImportFolder}>
        Import a folder of recordings…
      </Button>
    </section>
  )
}
