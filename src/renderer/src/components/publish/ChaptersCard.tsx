/**
 * Chapters: `MM:SS · title` rows over the record's `chapters[{start_s, title}]`.
 *
 * Three things only the renderer can do live here — clicking a row **seeks**
 * the open player, "Insert at playhead" **snaps** to a word start
 * (`lib/youtubeRules.ts`), and "Suggest" reads the library's moments route.
 * Whether the result is legal (first at 00:00, ≥ 3, ascending, ≥ 10 s apart,
 * inside the duration) is Python's answer, rendered underneath.
 */

import { StudioCard } from '../studio/StudioCard'
import { Button } from '../ui/Button'
import { formatTimestamp } from '../../lib/youtubeRules'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

interface ChaptersCardProps {
  publish: PublishController
  /** Move the player to a chapter's start. */
  onSeek: (seconds: number) => void
  /** Where the player is now — the "Insert at playhead" anchor. */
  getPlayhead: () => number
}

export function ChaptersCard({ publish, onSeek, getPlayhead }: ChaptersCardProps) {
  const chapters = publish.fields.chapters

  return (
    <StudioCard title="Chapters" defaultOpen>
      <FieldHeader publish={publish} field="chapters" />

      {chapters.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No chapters yet. Insert one at the playhead, or ask for suggestions from the pauses and
          speaker changes in the transcript.
        </p>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Chapters">
          {chapters.map((chapter, i) => (
            <li key={`${i}:${chapter.start_s}`} className="flex items-center gap-1.5">
              <button
                type="button"
                className="text-xs-plus tabular-nums px-1.5 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors shrink-0"
                style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-2)' }}
                title="Seek the player here"
                onClick={() => onSeek(chapter.start_s)}
              >
                {formatTimestamp(chapter.start_s)}
              </button>
              <input
                type="text"
                className="field-input"
                aria-label={`Chapter at ${formatTimestamp(chapter.start_s)}`}
                placeholder="Chapter title"
                value={chapter.title}
                onFocus={() => publish.beginEdit('chapters')}
                onBlur={publish.endEdit}
                onChange={(e) => publish.renameChapter(i, e.target.value)}
              />
              <button
                type="button"
                className="icon-btn w-5 h-5 text-xs-plus shrink-0"
                aria-label={`Remove the chapter at ${formatTimestamp(chapter.start_s)}`}
                title="Remove this chapter"
                onClick={() => publish.removeChapterAt(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      <FieldViolations violations={publish.violationsFor('chapters')} />

      <div className="flex gap-1.5 mt-2">
        <Button
          variant="ghost"
          className="flex-1 text-xs-plus py-1 justify-center"
          onClick={() => publish.insertChapterAt(getPlayhead())}
          title="Add a chapter at the playhead, snapped back to the nearest word"
        >
          Insert at playhead
        </Button>
        <Button
          variant="ghost"
          className="flex-1 text-xs-plus py-1 justify-center"
          onClick={publish.suggestChapters}
          title="Suggest chapters from the transcript's pauses and speaker changes"
        >
          Suggest
        </Button>
      </div>
    </StudioCard>
  )
}
