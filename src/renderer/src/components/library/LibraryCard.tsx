/**
 * One library record, as a card.
 *
 * The poster block shows the frame the backend grabbed at import (fetched
 * into a `blob:` URL by `usePosterUrl`, because the CSP refuses `127.0.0.1`
 * images) and falls back to a gradient placeholder; either way it carries the
 * mono duration badge and, when the source file is gone, the missing-media
 * chip, so the card still reads as a *video* rather than a row.
 *
 * The `…` menu is local state and the destructive item confirms **inline**:
 * no native dialog, because the renderer's tests have no DOM and a
 * `window.confirm` would be untestable as well as ugly.
 */

import { useState } from 'react'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { displayTitle, formatDuration, statusPips } from '../../lib/libraryView'
import { usePosterUrl } from '../../hooks/usePosterUrl'

/** The status rail, in ladder order — also used by the Continue hero. */
const PIP_LABELS = ['Transcribed', 'Captioned', 'Drafted', 'Published'] as const

export interface StatusRailProps {
  video: LibraryVideo
}

export function StatusRail({ video }: StatusRailProps) {
  const pips = statusPips(video.status)
  const lit = [pips.transcribed, pips.captioned, pips.drafted, pips.published]
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Status: ${video.status}`}
      title={PIP_LABELS.filter((_, i) => lit[i]).join(' · ') || 'Imported'}
    >
      {PIP_LABELS.map((label, i) => (
        <span
          key={label}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: lit[i] ? 'var(--color-brand)' : 'var(--color-border-3)',
            opacity: lit[i] ? 1 : 0.6,
          }}
        />
      ))}
    </div>
  )
}

/** The language chip — TrackTabs' badge style, reused verbatim. */
export function LanguageChip({ lang }: { lang: string | null }) {
  if (!lang) return null
  return (
    <span
      className="rounded px-1 text-2xs uppercase tabular-nums"
      style={{ color: 'var(--color-text-3)', background: 'var(--color-surface-3)' }}
      title={`Caption language: ${lang}`}
    >
      {lang}
    </span>
  )
}

/** ISO → a short local date; empty when the backend sent nothing usable. */
function formatUpdated(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export interface PosterProps {
  video: LibraryVideo
  /** An object URL for the grabbed frame; null draws the placeholder. */
  posterUrl: string | null
}

/** The 16:9 poster block: the frame when there is one, a gradient when not. The caller sizes it. */
export function Poster({ video, posterUrl }: PosterProps) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        aspectRatio: '16 / 9',
        background: 'linear-gradient(135deg, var(--color-surface-3) 0%, var(--color-surface) 100%)',
        border: '1px solid var(--color-border)',
      }}
    >
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {video.missing_media && (
        <span
          className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-2xs"
          style={{ color: 'var(--color-danger)', background: 'var(--color-danger-subtle)' }}
          title={`The source file is gone: ${video.sourcePath}`}
        >
          Media missing
        </span>
      )}
      <span
        className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-2xs tabular-nums"
        style={{
          fontFamily: 'var(--cf-font-mono)',
          color: 'var(--color-text-2)',
          background: 'var(--color-base)',
        }}
      >
        {formatDuration(video.duration)}
      </span>
    </div>
  )
}

/** `Poster` bound to the record's fetched frame — what the card and the hero mount. */
export function LibraryPoster({ video }: { video: LibraryVideo }) {
  const posterUrl = usePosterUrl(video)
  return <Poster video={video} posterUrl={posterUrl} />
}

export interface LibraryCardProps {
  video: LibraryVideo
  onOpen: (video: LibraryVideo) => void
  /** Hide the record, keeping every file it holds. */
  onRemove: (video: LibraryVideo) => void
  /** Un-index it and move its folder to the Trash. */
  onDelete: (video: LibraryVideo) => void
}

export function LibraryCard({ video, onOpen, onRemove, onDelete }: LibraryCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const title = displayTitle(video)

  function closeMenu() {
    setMenuOpen(false)
    setConfirming(false)
  }

  return (
    <div className="group relative flex flex-col gap-2.5">
      <button
        type="button"
        className="flex flex-col gap-2.5 rounded-xl p-2 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        title={video.sourcePath}
        aria-label={`Open ${title}`}
        onClick={() => onOpen(video)}
      >
        <LibraryPoster video={video} />
        <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
          <span
            className="truncate text-sm"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--cf-font-ui)' }}
          >
            {title}
          </span>
          <div className="flex items-center gap-2">
            <StatusRail video={video} />
            <LanguageChip lang={video.language} />
            <span className="ml-auto text-2xs" style={{ color: 'var(--color-text-3)' }}>
              {formatUpdated(video.updatedAt)}
            </span>
          </div>
        </div>
      </button>

      <button
        type="button"
        aria-label={`Actions for ${title}`}
        title="Record actions"
        className="absolute right-3 top-3 rounded px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        style={{ color: 'var(--color-text-2)', background: 'var(--color-base)' }}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-3 top-9 z-10 flex w-52 flex-col rounded-lg p-1 text-xs"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
            style={{ color: 'var(--color-text)' }}
            onClick={() => {
              closeMenu()
              onRemove(video)
            }}
          >
            Remove from library
          </button>
          {confirming ? (
            <div className="flex items-center gap-1 px-2 py-1.5">
              <span style={{ color: 'var(--color-text-2)' }}>Delete?</span>
              <button
                type="button"
                role="menuitem"
                className="ml-auto rounded px-1.5 py-0.5"
                style={{ color: 'var(--color-danger)' }}
                onClick={() => {
                  closeMenu()
                  onDelete(video)
                }}
              >
                Delete
              </button>
              <button
                type="button"
                role="menuitem"
                className="rounded px-1.5 py-0.5"
                style={{ color: 'var(--color-text-3)' }}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
              style={{ color: 'var(--color-danger)' }}
              onClick={() => setConfirming(true)}
            >
              Delete record…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
