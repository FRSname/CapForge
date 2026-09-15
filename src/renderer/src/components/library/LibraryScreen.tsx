/**
 * The library home screen — where CapForge opens (v3 §4).
 *
 * Composition: a masthead with the two toolbar actions, a "Continue" hero for
 * the most recent record that has a session to resume, then the rest of the
 * library as a grid of cards. The hero is deliberately *not* repeated in the
 * grid: it is the same record promoted, not a second one.
 *
 * The whole screen is a drop target, and what a drop means is decided by
 * `droppedImport` (lib/libraryImport.ts): one video opens in the editor as
 * before, several import without opening, a folder imports the folder.
 * The handler runs in the **capture** phase and stops the event there, so the
 * empty state's own DropZoneScreen never also handles it (it would open a
 * dropped folder as if it were a media file, and open a file twice).
 */

import { useState } from 'react'
import type { DropPlan, LocateOutcome } from '../../lib/libraryImport'
import { droppedImport, droppedItemsOf, droppedSkippedMessage } from '../../lib/libraryImport'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { continueCandidate, displayTitle, sortByUpdated } from '../../lib/libraryView'
import { warmForFile } from '../screens/DropZoneScreen'
import { Button } from '../ui/Button'
import { LanguageChip, LibraryCard, LibraryPoster, StatusRail } from './LibraryCard'
import { LibraryEmptyState } from './LibraryEmptyState'

export { droppedNotMediaMessage } from '../../lib/libraryImport'

export interface LibraryScreenProps {
  videos: LibraryVideo[]
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
}

export function LibraryScreen({
  videos,
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
}: LibraryScreenProps) {
  const [dragging, setDragging] = useState(false)
  // Bumped per drop to remount the empty state's DropZoneScreen: the capture
  // handler stops the event before that zone can clear its own highlight.
  const [dropCount, setDropCount] = useState(0)

  const hero = continueCandidate(videos)
  const rest = sortByUpdated(videos).filter((v) => v.id !== hero?.id)

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
      <header className="flex items-end justify-between gap-4 px-8 pb-4 pt-7">
        <div className="flex items-baseline gap-3">
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
            className="text-[11px] uppercase tracking-widest"
            style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
          >
            {loading ? 'loading…' : `${videos.length} video${videos.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="app-no-drag flex items-center gap-2">
          <Button variant="ghost" className="text-xs" onClick={() => onImportFolder()}>
            Import folder…
          </Button>
          <Button variant="ghost" className="text-xs" onClick={onImportProjects}>
            Import project files…
          </Button>
          <Button variant="primary" className="text-xs" onClick={onAddVideo}>
            Add video
          </Button>
        </div>
      </header>

      {videos.length === 0 ? (
        <LibraryEmptyState
          dropZoneKey={dropCount}
          onFileSelected={onFileDropped}
          onStart={onAddVideo}
          onImportFolder={() => onImportFolder()}
        />
      ) : (
        <div className="flex flex-col gap-8 px-8 pb-10">
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
                    onOpen={onOpen}
                    onRemove={onRemove}
                    onDelete={onDelete}
                    onLocate={onLocate}
                    onForceLocate={onForceLocate}
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
