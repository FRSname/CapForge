/**
 * The one record promoted out of the library grid: the session you were last
 * in. Its poster has a fixed height and takes its width from the video's
 * ratio, held to a maximum so a wide video does not push the title out.
 */

import type { LibraryVideo } from '../../lib/libraryTypes'
import { OPENING_LABEL, displayTitle } from '../../lib/libraryView'
import { Spinner } from '../ui/Spinner'
import { LanguageChip, StatusRail } from './LibraryCard'
import { LibraryPoster } from './LibraryPoster'

/** The hero poster's height; a 16:9 frame at this height is exactly the max width. */
export const HERO_POSTER_HEIGHT_PX = 180
export const HERO_POSTER_MAX_WIDTH_PX = 320

const HERO_POSTER_SIZE = { heightPx: HERO_POSTER_HEIGHT_PX, maxWidthPx: HERO_POSTER_MAX_WIDTH_PX }

export interface ContinueHeroProps {
  video: LibraryVideo
  onOpen: (video: LibraryVideo) => void
  /** Its session is being restored: the label says so and the click is off. */
  opening?: boolean
}

export function ContinueHero({ video, onOpen, opening = false }: ContinueHeroProps) {
  const title = displayTitle(video)
  return (
    <button
      type="button"
      aria-label={`Continue ${title}`}
      aria-busy={opening}
      disabled={opening}
      title={video.sourcePath}
      className="flex items-center gap-6 rounded-2xl p-4 text-left transition-transform duration-150 enabled:hover:-translate-y-0.5 enabled:focus-visible:-translate-y-0.5 disabled:cursor-progress"
      style={{
        background: 'linear-gradient(120deg, var(--color-surface-2) 0%, var(--color-surface) 60%)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-3)',
      }}
      onClick={() => onOpen(video)}
    >
      <LibraryPoster video={video} fixedHeight={HERO_POSTER_SIZE} />
      <div className="flex min-w-0 flex-col gap-2">
        <span
          className="flex items-center gap-2 text-[11px] uppercase tracking-widest"
          style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-brand)' }}
        >
          {opening && <Spinner />}
          {opening ? OPENING_LABEL : 'Continue'}
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
