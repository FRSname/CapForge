/**
 * The Transcript tab: the active track's segments, read-only, with a chapter
 * gutter.
 *
 * - Each row is `MM:SS`, the speaker label when present, and the text. Clicking
 *   it seeks the player; the row under the playhead is highlighted.
 * - Chapter markers (title + `MM:SS`) sit above the segment each chapter starts
 *   in (`placeChapters`); chapters past the last segment are listed at the end.
 * - With a library record each row offers "Insert chapter here", which goes
 *   through the Chapters card's own insert (snapped to a word start, saved by
 *   the draft writer). Renaming and removing stay in the card.
 *
 * **Performance.** The screen re-renders this on every playback tick. Rows are
 * memoised and receive only `isActive`, driven by `activeSegmentIndex` (a
 * binary search), and the row list itself is memoised on the active index — so
 * a tick that stays inside one segment re-renders no row, and a tick that
 * crosses a boundary re-renders exactly two.
 */

import { memo, useMemo } from 'react'
import type { Segment } from '../../types/app'
import type { Chapter } from '../../lib/publishTypes'
import { formatTimestamp } from '../../lib/youtubeRules'
import { activeSegmentIndex, placeChapters } from '../../lib/transcriptChapters'
import { usePublishRecordContext } from '../../hooks/usePublishRecordContext'

interface TranscriptViewProps {
  /** The active track's segments, in transcript order. */
  segments: readonly Segment[]
  /** The playhead — only its segment index reaches the rows. */
  currentTime: number
  /** The screen's `handleSeek`; must be referentially stable. */
  onSeek: (seconds: number) => void
}

const NO_CHAPTERS: readonly Chapter[] = []

const UNTITLED_CHAPTER = 'Untitled chapter'

function ChapterMarker({ chapter }: { chapter: Chapter }) {
  return (
    <div
      data-chapter-marker
      className="flex items-center gap-2 px-1 pt-1.5 pb-0.5 text-2xs"
      style={{ color: 'var(--color-brand)' }}
    >
      <span className="tabular-nums shrink-0" style={{ fontFamily: 'var(--cf-font-mono)' }}>
        {formatTimestamp(chapter.start_s)}
      </span>
      <span className="font-semibold truncate">{chapter.title || UNTITLED_CHAPTER}</span>
      <span aria-hidden className="flex-1 border-t" style={{ borderColor: 'var(--color-brand)' }} />
    </div>
  )
}

interface TranscriptRowProps {
  segment: Segment
  isActive: boolean
  /** The chapters drawn above this row; the shared empty list when none. */
  chapters: readonly Chapter[]
  onSeek: (seconds: number) => void
  /** Null without a record: no insert button is drawn. */
  onInsertChapter: ((seconds: number) => void) | null
}

const TranscriptRow = memo(function TranscriptRow({
  segment,
  isActive,
  chapters,
  onSeek,
  onInsertChapter,
}: TranscriptRowProps) {
  return (
    <li className="flex flex-col">
      {chapters.map((chapter, i) => (
        <ChapterMarker key={`${i}:${chapter.start_s}`} chapter={chapter} />
      ))}
      <div
        data-segment-row
        aria-current={isActive ? 'true' : undefined}
        className="group flex items-start gap-1 rounded-md border transition-colors"
        style={{
          borderColor: isActive ? 'var(--color-accent)' : 'transparent',
          background: isActive ? 'var(--color-surface-2)' : 'transparent',
        }}
      >
        <button
          type="button"
          className="flex-1 min-w-0 flex items-start gap-2 text-left px-2 py-1.5 rounded-md hover:bg-[var(--color-surface-2)] transition-colors"
          title="Seek the player here"
          onClick={() => onSeek(segment.start)}
        >
          <span
            className="text-2xs tabular-nums shrink-0 mt-0.5"
            style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-3)' }}
          >
            {formatTimestamp(segment.start)}
          </span>
          <span className="text-body leading-relaxed min-w-0" style={{ color: 'var(--color-text)' }}>
            {segment.speaker && (
              <span
                data-speaker
                className="text-2xs font-semibold mr-1.5"
                style={{ color: 'var(--color-accent)' }}
              >
                {segment.speaker}
              </span>
            )}
            {segment.text}
          </span>
        </button>
        {onInsertChapter && (
          <button
            type="button"
            className="shrink-0 text-2xs px-1.5 py-1 mt-0.5 mr-1 rounded border border-[var(--color-border)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--color-surface-3)] transition-opacity"
            style={{ color: 'var(--color-text-2)' }}
            aria-label="Insert chapter here"
            title="Insert a chapter at this segment, snapped to a word start"
            onClick={() => onInsertChapter(segment.start)}
          >
            + Chapter
          </button>
        )}
      </div>
    </li>
  )
})

export function TranscriptView({ segments, currentTime, onSeek }: TranscriptViewProps) {
  const { chapters, insertChapterAt, hasRecord } = usePublishRecordContext()
  const placed = useMemo(() => placeChapters(segments, chapters), [segments, chapters])
  const active = activeSegmentIndex(segments, currentTime)
  const onInsertChapter = hasRecord ? insertChapterAt : null

  const rows = useMemo(
    () =>
      segments.map((segment, i) => (
        <TranscriptRow
          key={segment.id}
          segment={segment}
          isActive={i === active}
          chapters={placed.bySegment.get(i) ?? NO_CHAPTERS}
          onSeek={onSeek}
          onInsertChapter={onInsertChapter}
        />
      )),
    [segments, active, placed, onSeek, onInsertChapter]
  )

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
      {segments.length === 0 && (
        <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-3)' }}>
          No transcript yet.
        </p>
      )}
      <ol className="flex flex-col gap-0.5" aria-label="Transcript">
        {rows}
      </ol>
      {placed.trailing.length > 0 && (
        <div className="flex flex-col" aria-label="Chapters after the transcript">
          {placed.trailing.map((chapter, i) => (
            <ChapterMarker key={`${i}:${chapter.start_s}`} chapter={chapter} />
          ))}
        </div>
      )}
    </div>
  )
}
