/**
 * The library home screen — where CapForge opens (v3 §4).
 *
 * Composition: a masthead with the two toolbar actions, a "Continue" hero for
 * the most recent record that has a session to resume, then the rest of the
 * library as a grid of cards. The hero is deliberately *not* repeated in the
 * grid: it is the same record promoted, not a second one.
 *
 * The whole screen is a drop target — dropping a video anywhere starts a
 * record for it. Nothing here loads a `127.0.0.1` image (§9.4 CSP): the poster
 * block is a placeholder until v3 #6.
 */

import { useState } from 'react'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { continueCandidate, displayTitle, isMediaPath, sortByUpdated } from '../../lib/libraryView'
import { Button } from '../ui/Button'
import { LanguageChip, LibraryCard, Poster, StatusRail } from './LibraryCard'
import { LibraryEmptyState } from './LibraryEmptyState'

/** Reported when something that is not media is dropped on the library. */
export function droppedNotMediaMessage(name: string): string {
  return `${name} is not a video or audio file CapForge can open.`
}

export interface LibraryScreenProps {
  videos: LibraryVideo[]
  loading: boolean
  /** A card was clicked — restore its session, or go transcribe its file. */
  onOpen: (video: LibraryVideo) => void
  /** Toolbar: go to the drop screen. */
  onAddVideo: () => void
  /** Toolbar: pick `.capforge` files and adopt them as records. */
  onImportProjects: () => void
  /** A media file was dropped (or browsed for, from the empty state). */
  onFileDropped: (path: string) => void
  /** A dropped file CapForge cannot open — reported, never ignored. */
  onDropRejected: (message: string) => void
  onRemove: (video: LibraryVideo) => void
  onDelete: (video: LibraryVideo) => void
}

export function LibraryScreen({
  videos,
  loading,
  onOpen,
  onAddVideo,
  onImportProjects,
  onFileDropped,
  onDropRejected,
  onRemove,
  onDelete,
}: LibraryScreenProps) {
  const [dragging, setDragging] = useState(false)

  const hero = continueCandidate(videos)
  const rest = sortByUpdated(videos).filter((v) => v.id !== hero?.id)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // Electron 32+ removed File.path → use the preload bridge (DropZoneScreen).
    const path = window.subforge?.getPathForFile(file)
    if (!path) return
    if (!isMediaPath(path)) {
      onDropRejected(droppedNotMediaMessage(file.name))
      return
    }
    onFileDropped(path)
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
      onDrop={handleDrop}
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
          <Button variant="ghost" className="text-xs" onClick={onImportProjects}>
            Import project files…
          </Button>
          <Button variant="primary" className="text-xs" onClick={onAddVideo}>
            Add video
          </Button>
        </div>
      </header>

      {videos.length === 0 ? (
        <LibraryEmptyState onFileSelected={onFileDropped} onStart={onAddVideo} />
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
        <Poster video={video} />
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
