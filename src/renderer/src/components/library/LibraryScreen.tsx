/**
 * The library home screen — where CapForge opens (v3 §4).
 *
 * Composition: a masthead with the toolbar (`LibraryToolbar`), a "Continue"
 * hero for the most recent record that has a session to resume, then the rest
 * of the library as a grid of cards. The hero is deliberately *not* repeated in
 * the grid: it is the same record promoted, not a second one.
 *
 * The whole screen is a drop target, and what a drop means is decided by
 * `droppedImport` (lib/libraryImport.ts): one video opens in the editor as
 * before, several import without opening, a folder imports the folder.
 * The handler runs in the **capture** phase and stops the event there, so the
 * empty state's own DropZoneScreen never also handles it (it would open a
 * dropped folder as if it were a media file, and open a file twice).
 */

import { useState } from 'react'
import type { CreateCollectionResult } from '../../lib/collectionCreate'
import { newCollectionPlacement } from '../../lib/collectionCreate'
import type { DropPlan, LocateOutcome } from '../../lib/libraryImport'
import { droppedImport, droppedItemsOf, droppedSkippedMessage } from '../../lib/libraryImport'
import type { CollectionSummary } from '../../lib/collectionTypes'
import { collectionLabel } from '../../lib/collections'
import type { CollectionFilter } from '../../lib/libraryView'
import type { LibraryVideo } from '../../lib/libraryTypes'
import {
  ALL_COLLECTIONS,
  collectionFilterOptions,
  continueCandidate,
  displayTitle,
  filterByCollection,
  sortByUpdated,
} from '../../lib/libraryView'
import { warmForFile } from '../screens/DropZoneScreen'
import { LanguageChip, LibraryCard, LibraryPoster, StatusRail } from './LibraryCard'
import { LibraryEmptyState } from './LibraryEmptyState'
import { LibraryToolbar } from './LibraryToolbar'

export { droppedNotMediaMessage } from '../../lib/libraryImport'

export interface LibraryScreenProps {
  videos: LibraryVideo[]
  /** Names for the filter and the card chips; null/absent until they load. */
  collections?: readonly CollectionSummary[] | null
  loading: boolean
  /** A card was clicked — restore its session, or go transcribe its file. */
  onOpen: (video: LibraryVideo) => void
  /** Toolbar: go to the drop screen. */
  onAddVideo: () => void
  /** Toolbar: pick `.capforge` files and adopt them as records. */
  onImportProjects: () => void
  /** Import a folder of media — the picker when no path, the dropped folder otherwise. */
  onImportFolder: (path?: string) => void
  /** Several media files were dropped: import them without opening any. */
  onImportFiles: (paths: string[]) => void
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
  /** Create a collection by name. Never rejects: failures are inline or toasted. */
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
  /** Card: put one video in a collection (null: in none). */
  onMoveToCollection: (video: LibraryVideo, collectionId: string | null) => void
}

export function LibraryScreen({
  videos,
  collections,
  loading,
  onOpen,
  onAddVideo,
  onImportProjects,
  onImportFolder,
  onImportFiles,
  onFileDropped,
  onDropRejected,
  onRemove,
  onDelete,
  onLocate,
  onForceLocate,
  onCreateCollection,
  onMoveToCollection,
}: LibraryScreenProps) {
  const [dragging, setDragging] = useState(false)
  // Bumped per drop to remount the empty state's DropZoneScreen: the capture
  // handler stops the event before that zone can clear its own highlight.
  const [dropCount, setDropCount] = useState(0)

  const [filter, setFilter] = useState<CollectionFilter>(ALL_COLLECTIONS)

  const known = collections ?? []
  const shown = filterByCollection(videos, filter)
  const hero = continueCandidate(shown)
  const rest = sortByUpdated(shown).filter((v) => v.id !== hero?.id)
  const filtering = filter !== ALL_COLLECTIONS
  const placement = newCollectionPlacement(videos.length, collections ?? null)

  function runDropPlan(plan: DropPlan) {
    if (plan.kind === 'none') return
    if (plan.kind === 'rejected') {
      onDropRejected(plan.message)
      return
    }
    if (plan.kind === 'folder') {
      onImportFolder(plan.path)
      return
    }
    if (plan.skipped.length > 0) onDropRejected(droppedSkippedMessage(plan.skipped))
    if (plan.kind === 'open') {
      onFileDropped(plan.path)
      warmForFile()
      return
    }
    onImportFiles(plan.paths)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDropCount((n) => n + 1)
    // Read synchronously — the DataTransfer is emptied once the handler returns.
    // Electron 32+ removed File.path → the preload bridge resolves files and folders.
    const items = droppedItemsOf(e.dataTransfer, (file) => window.subforge?.getPathForFile(file))
    runDropPlan(droppedImport(items))
  }

  return (
    <section
      aria-label="Library"
      className="screen-in flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      style={{
        background: dragging ? 'var(--color-accent-subtle)' : 'transparent',
        transition: 'background 150ms',
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDropCapture={handleDrop}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-8 pb-4 pt-7">
        <div className="flex shrink-0 items-baseline gap-3">
          <h1
            className="text-3xl leading-none"
            style={{
              fontFamily: 'var(--cf-font-display)',
              fontStyle: 'italic',
              color: 'var(--color-text)',
            }}
          >
            Library
          </h1>
          <span
            className="whitespace-nowrap text-[11px] uppercase tracking-widest"
            style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
          >
            {loading ? 'loading…' : countLabel(shown.length, videos.length, filtering)}
          </span>
        </div>
        <LibraryToolbar
          filterOptions={placement === 'toolbar' ? collectionFilterOptions(known, videos) : null}
          filter={filter}
          onFilterChange={setFilter}
          onCreateCollection={onCreateCollection}
          onImportFolder={() => onImportFolder()}
          onImportProjects={onImportProjects}
          onAddVideo={onAddVideo}
        />
      </header>

      {videos.length === 0 ? (
        <LibraryEmptyState
          dropZoneKey={dropCount}
          onFileSelected={onFileDropped}
          onStart={onAddVideo}
          onImportFolder={() => onImportFolder()}
          onCreateCollection={placement === 'empty-state' ? onCreateCollection : undefined}
        />
      ) : (
        <div className="flex flex-col gap-8 px-8 pb-10">
          {shown.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
              No videos match this collection filter.
            </p>
          )}
          {hero && <ContinueHero video={hero} onOpen={onOpen} />}
          {rest.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2
                className="text-[11px] uppercase tracking-widest"
                style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
              >
                All videos
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                {rest.map((video) => (
                  <LibraryCard
                    key={video.id}
                    video={video}
                    collectionName={collectionLabel(known, video.collection_id)}
                    collections={known}
                    onOpen={onOpen}
                    onRemove={onRemove}
                    onDelete={onDelete}
                    onLocate={onLocate}
                    onForceLocate={onForceLocate}
                    onMoveToCollection={onMoveToCollection}
                    onCreateCollection={onCreateCollection}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** "3 videos", or "2 of 3 videos" while a collection filter is on. */
function countLabel(shown: number, total: number, filtering: boolean): string {
  const noun = `video${total === 1 ? '' : 's'}`
  return filtering ? `${shown} of ${total} ${noun}` : `${total} ${noun}`
}

interface ContinueHeroProps {
  video: LibraryVideo
  onOpen: (video: LibraryVideo) => void
}

/** The one record promoted out of the grid: the session you were last in. */
function ContinueHero({ video, onOpen }: ContinueHeroProps) {
  const title = displayTitle(video)
  return (
    <button
      type="button"
      aria-label={`Continue ${title}`}
      title={video.sourcePath}
      className="flex items-center gap-6 rounded-2xl p-4 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
      style={{
        background:
          'linear-gradient(120deg, var(--color-surface-2) 0%, var(--color-surface) 60%)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-3)',
      }}
      onClick={() => onOpen(video)}
    >
      <div className="w-[260px] shrink-0">
        <LibraryPoster video={video} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span
          className="text-[11px] uppercase tracking-widest"
          style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-brand)' }}
        >
          Continue
        </span>
        <span
          className="truncate text-2xl"
          style={{
            fontFamily: 'var(--cf-font-display)',
            fontStyle: 'italic',
            color: 'var(--color-text)',
          }}
        >
          {title}
        </span>
        <div className="flex items-center gap-2">
          <StatusRail video={video} />
          <LanguageChip lang={video.language} />
        </div>
      </div>
    </button>
  )
}
