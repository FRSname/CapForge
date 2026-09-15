/**
 * Shorts: the caption and the clip suggestions — spans of the source video,
 * timestamps only (vision §4).
 *
 * Like Chapters, the renderer does what only it can: clicking a timestamp
 * **seeks** the player, "⇤ playhead" / "playhead ⇥" set a clip's ends from
 * where the player is (the start snapped back to a word), and "Add clip at
 * playhead" starts a 30 s clip there. Whether a clip is legal (start before
 * end, inside the duration) and whether it is too long for a Short are the
 * backend's findings, drawn under the row they name.
 */

import { useMemo } from 'react'
import { StudioCard } from '../studio/StudioCard'
import { Button } from '../ui/Button'
import type { Segment } from '../../types/app'
import type { ClipSuggestion, Shorts } from '../../lib/publishMediaTypes'
import {
  CLIP_AT_END_MESSAGE,
  CLIP_ORDER_MESSAGE,
  addClipAt,
  clipRowField,
  formatClipLength,
  removeClip,
  setClipEndAt,
  setClipStartAt,
  setClipWhy,
} from '../../lib/publishClips'
import { partitionViolations } from '../../lib/publishViolations'
import { formatTimestamp } from '../../lib/youtubeRules'
import type { Violation } from '../../lib/publishTypes'
import type { PublishController } from '../../hooks/usePublishRecord'
import { useToast } from '../../hooks/useToast'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

const CAPTION_ROWS = 3

interface ShortsCardProps {
  publish: PublishController
  /** The source transcript — a clip's start snaps back to a word start. */
  segments: readonly Segment[]
  onSeek: (seconds: number) => void
  getPlayhead: () => number
}

interface ClipRowProps {
  clip: ClipSuggestion
  findings: Violation[]
  publish: PublishController
  onSeek: (seconds: number) => void
  onStart: () => void
  onEnd: () => void
  onWhy: (why: string) => void
  onRemove: () => void
}

const STAMP_CLASS =
  'text-[11px] tabular-nums px-1.5 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors shrink-0'
const STAMP_STYLE = { fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text-2)' }
const PLAYHEAD_CLASS = 'text-2xs px-1 py-1 rounded hover:bg-[var(--color-surface-2)] shrink-0'

function ClipRow(props: ClipRowProps) {
  const { clip, findings, publish, onSeek, onStart, onEnd, onWhy, onRemove } = props
  const start = formatTimestamp(clip.start_s)
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={STAMP_CLASS}
          style={STAMP_STYLE}
          title="Seek the player to the start"
          onClick={() => onSeek(clip.start_s)}
        >
          {start}
        </button>
        <button
          type="button"
          className={PLAYHEAD_CLASS}
          style={{ color: 'var(--color-text-3)' }}
          title="Set the start to the playhead"
          onClick={onStart}
        >
          ⇤ playhead
        </button>
        <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          –
        </span>
        <button
          type="button"
          className={PLAYHEAD_CLASS}
          style={{ color: 'var(--color-text-3)' }}
          title="Set the end to the playhead"
          onClick={onEnd}
        >
          playhead ⇥
        </button>
        <button
          type="button"
          className={STAMP_CLASS}
          style={STAMP_STYLE}
          title="Seek the player to the end"
          onClick={() => onSeek(clip.end_s)}
        >
          {formatTimestamp(clip.end_s)}
        </button>
        <span className="ml-auto text-2xs tabular-nums" style={{ color: 'var(--color-text-3)' }}>
          {formatClipLength(clip)}
        </span>
        <button
          type="button"
          className="icon-btn w-5 h-5 text-[11px] shrink-0"
          aria-label={`Remove the clip at ${start}`}
          title="Remove this clip"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      <input
        type="text"
        className="field-input"
        aria-label={`Why the clip at ${start}`}
        placeholder="Why this makes a Short"
        value={clip.why}
        onFocus={() => publish.beginEdit('shorts')}
        onBlur={publish.endEdit}
        onChange={(e) => onWhy(e.target.value)}
      />
      <FieldViolations violations={findings} />
    </li>
  )
}

export function ShortsCard({ publish, segments, onSeek, getPlayhead }: ShortsCardProps) {
  const { toast } = useToast()
  const words = useMemo(() => segments.flatMap((s) => s.words), [segments])
  const shorts = publish.fields.shorts
  const clips = shorts.clip_suggestions
  const duration = publish.record?.duration ?? null
  const {
    placed: [captionFindings, ...rowFindings],
    unplaced,
  } = partitionViolations(publish.violationsFor('shorts'), [
    ['shorts.caption'],
    ...clips.map((_, i) => [clipRowField(i)]),
  ])

  const write = (next: Shorts) => publish.setField('shorts', next)
  /** Apply a clip edit, or say why it was refused. */
  const writeClips = (next: ClipSuggestion[] | null, refusal: string) => {
    if (next === null) toast(refusal, 'info')
    else write({ ...shorts, clip_suggestions: next })
  }

  return (
    <StudioCard title="Shorts" defaultOpen={false}>
      <FieldHeader publish={publish} field="shorts" />
      <textarea
        className="field-input resize-y"
        rows={CAPTION_ROWS}
        aria-label="Shorts caption"
        placeholder="The caption posted with the Short"
        value={shorts.caption}
        onFocus={() => publish.beginEdit('shorts')}
        onBlur={publish.endEdit}
        onChange={(e) => write({ ...shorts, caption: e.target.value })}
      />
      <FieldViolations violations={captionFindings} />

      <span className="label-xs mt-2">Clip suggestions</span>
      {clips.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No clip suggestions yet. Add one at the playhead, or ask the agent for the moments that
          would stand alone as a Short.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Clip suggestions">
          {clips.map((clip, i) => (
            <ClipRow
              key={`${i}:${clip.start_s}`}
              clip={clip}
              findings={rowFindings[i] ?? []}
              publish={publish}
              onSeek={onSeek}
              onStart={() =>
                writeClips(setClipStartAt(clips, i, getPlayhead(), words), CLIP_ORDER_MESSAGE)
              }
              onEnd={() =>
                writeClips(setClipEndAt(clips, i, getPlayhead(), duration), CLIP_ORDER_MESSAGE)
              }
              onWhy={(why) => write({ ...shorts, clip_suggestions: setClipWhy(clips, i, why) })}
              onRemove={() => write({ ...shorts, clip_suggestions: removeClip(clips, i) })}
            />
          ))}
        </ol>
      )}
      <FieldViolations violations={unplaced} />

      <Button
        variant="ghost"
        className="mt-2 text-[11px] py-1 justify-center"
        onClick={() =>
          writeClips(addClipAt(clips, getPlayhead(), words, duration), CLIP_AT_END_MESSAGE)
        }
        title="Add a 30 s clip starting at the playhead, snapped back to the nearest word"
      >
        Add clip at playhead
      </Button>
    </StudioCard>
  )
}
