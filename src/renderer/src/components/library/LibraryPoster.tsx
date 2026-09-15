/**
 * A record's poster block: the cover chosen in Publish, else the frame the
 * backend grabbed at import (fetched into a `blob:` URL by `usePosterUrl`,
 * because the CSP refuses `127.0.0.1` images), or a gradient placeholder.
 * Either way it carries the mono duration badge and, when the source file is
 * gone, the missing-media chip, so a card still reads as a *video* rather than
 * a row.
 *
 * The box keeps the video's ratio. The poster JPEG is the frame scaled with
 * its ratio preserved, so `LibraryPoster` reads the ratio off the loaded
 * image (`naturalWidth` / `naturalHeight`, through `posterAspect`) — until it
 * has one, and whenever there is no picture, the box is 16:9. In a grid
 * column the box fills the width and grows taller for portrait; with
 * `fixedHeight` (the Continue hero) the height is fixed and the width follows.
 */

import type { CSSProperties } from 'react'
import { useState } from 'react'
import { cn } from '../../lib/cn'
import type { LibraryVideo } from '../../lib/libraryTypes'
import { cardImageAsset, formatDuration, posterAspect, posterBoxWidth } from '../../lib/libraryView'
import { usePosterUrl } from '../../hooks/usePosterUrl'

/** `POSTER_ASPECT_FALLBACK` as CSS — kept as the ratio it is rather than a long decimal. */
const FALLBACK_ASPECT_CSS = '16 / 9'

/**
 * Ratios already measured, by record id **and** picture (`aspectKey`), so
 * coming back to the library does not redraw every portrait card at 16:9 while
 * its poster is re-fetched, and a newly chosen cover of another shape is never
 * drawn at the old picture's ratio. A cache only: a re-measured picture
 * overwrites its entry.
 */
const measuredAspects = new Map<string, number>()

function aspectKey(id: string, asset: string | null): string {
  return `${id}\n${asset ?? ''}`
}

export interface PosterFixedHeight {
  heightPx: number
  /** The width a wide ratio is held to; the picture is cropped past it. */
  maxWidthPx: number
}

export interface PosterProps {
  video: LibraryVideo
  /** An object URL for the grabbed frame; null draws the placeholder. */
  posterUrl: string | null
  /** The frame's width / height; absent or unusable means 16:9. Ignored without a poster. */
  aspect?: number | null
  /** A fixed-height box whose width follows the ratio. Absent: the box fills its width. */
  fixedHeight?: PosterFixedHeight
  /** The loaded frame's natural size. */
  onImageSize?: (width: number, height: number) => void
}

function usableAspect(aspect: number | null | undefined): number | null {
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : null
}

function boxSize(aspect: number | null, fixedHeight: PosterFixedHeight | undefined): CSSProperties {
  if (fixedHeight) {
    const width = posterBoxWidth(aspect, fixedHeight.heightPx, fixedHeight.maxWidthPx)
    return { height: `${fixedHeight.heightPx}px`, width: `${width}px` }
  }
  return { aspectRatio: aspect === null ? FALLBACK_ASPECT_CSS : String(aspect) }
}

/** The poster box: the frame when there is one, a gradient when not. */
export function Poster({ video, posterUrl, aspect, fixedHeight, onImageSize }: PosterProps) {
  const known = posterUrl ? usableAspect(aspect) : null
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden rounded-lg', !fixedHeight && 'w-full')}
      style={{
        ...boxSize(known, fixedHeight),
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
          onLoad={(e) => onImageSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
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

export interface LibraryPosterProps {
  video: LibraryVideo
  fixedHeight?: PosterFixedHeight
}

/** `Poster` bound to the record's fetched frame and its measured ratio — what the card and the hero mount. */
export function LibraryPoster({ video, fixedHeight }: LibraryPosterProps) {
  const posterUrl = usePosterUrl(video)
  // Keyed by id and picture, so a hero that switches records, or a card whose
  // cover changed, never shows the last picture's ratio.
  const key = aspectKey(video.id, cardImageAsset(video))
  const [measured, setMeasured] = useState<{ key: string; aspect: number } | null>(null)
  const aspect = measured?.key === key ? measured.aspect : (measuredAspects.get(key) ?? null)

  function handleImageSize(width: number, height: number) {
    const next = posterAspect(width, height)
    if (next === null) return
    measuredAspects.set(key, next)
    setMeasured({ key, aspect: next })
  }

  return (
    <Poster
      video={video}
      posterUrl={posterUrl}
      aspect={aspect}
      fixedHeight={fixedHeight}
      onImageSize={handleImageSize}
    />
  )
}
