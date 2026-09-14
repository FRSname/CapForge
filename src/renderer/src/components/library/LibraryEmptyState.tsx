/**
 * The library with nothing in it.
 *
 * The drop affordance is `DropZoneScreen` itself — the same component the
 * `'file'` screen shows, so there is exactly one drop target implementation and
 * exactly one list of accepted extensions. Picking a file here hands it
 * straight to App, which creates the record and moves to the file screen.
 */

import { DropZoneScreen } from '../screens/DropZoneScreen'

export interface LibraryEmptyStateProps {
  /** A media file was dropped or browsed for. */
  onFileSelected: (path: string) => void
  /** The file is chosen — go transcribe it. */
  onStart: () => void
}

export function LibraryEmptyState({ onFileSelected, onStart }: LibraryEmptyStateProps) {
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
        Drop a video to start a record — everything you do to it is kept here.
      </p>
      <DropZoneScreen filePath={null} onFileSelected={onFileSelected} onStart={onStart} />
    </section>
  )
}
