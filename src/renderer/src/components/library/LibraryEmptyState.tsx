/**
 * The library with nothing in it.
 *
 * The drop affordance is `DropZoneScreen` itself — the same component the
 * `'file'` screen shows, so there is exactly one drop target implementation and
 * exactly one list of accepted extensions. Browsing for a file here hands it
 * straight to App, which creates the record and moves to the file screen.
 * A *drop* is handled by `LibraryScreen` before it reaches the zone (a folder,
 * a project or several files mean something else there), which is why the
 * zone is keyed: a remount per drop clears the highlight it never got to clear
 * itself.
 *
 * A creator's recordings live in folders, so the toolbar's Import… (files,
 * folders and projects) is offered right here too. So is "New collection…",
 * when the library has no collections yet (the toolbar only offers it beside
 * the filter, which an empty library does not show).
 */

import type { CreateCollectionResult } from '../../lib/collectionCreate'
import type { ImportPickMode } from '../../lib/libraryImport'
import { DropZoneScreen } from '../screens/DropZoneScreen'
import { ImportButton } from './ImportButton'
import { NewCollectionPopover } from './NewCollectionForm'

export interface LibraryEmptyStateProps {
  /** A media file was browsed for. */
  onFileSelected: (path: string) => void
  /** The file is chosen — go transcribe it. */
  onStart: () => void
  /** Import… — the same action as the toolbar's. */
  onImport: (mode: ImportPickMode) => void
  /** Offers "New collection…" when given. The create itself confirms with a toast. */
  onCreateCollection?: (name: string) => Promise<CreateCollectionResult>
  /** Changes per drop on the library, remounting the drop zone. */
  dropZoneKey?: number
}

/** Nothing to show after a create here: the success toast says it, and no filter is visible. */
function ignoreCreated(): void {}

export function LibraryEmptyState({
  onFileSelected,
  onStart,
  onImport,
  onCreateCollection,
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
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ImportButton onImport={onImport} align="center" />
        {onCreateCollection && (
          <NewCollectionPopover
            onCreate={onCreateCollection}
            onCreated={ignoreCreated}
            align="center"
          />
        )}
      </div>
    </section>
  )
}
