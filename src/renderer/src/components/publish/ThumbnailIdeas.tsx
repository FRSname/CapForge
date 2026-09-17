/**
 * The Thumbnail card's idea rows — text briefs for a thumbnail, not rendered
 * boards (vision §4 "Deferred"): label, type, headline, subtext, visual
 * suggestion, and which one is recommended.
 *
 * "Exactly one recommended" is the backend's style rule; the radio keeps the
 * list that way by construction and the finding renders underneath if an
 * agent wrote it otherwise.
 */

import { useId } from 'react'
import { THUMBNAIL_IDEA_TYPES } from '../../lib/publishMediaTypes'
import type { Thumbnail, ThumbnailIdea } from '../../lib/publishMediaTypes'
import type { Violation } from '../../lib/publishTypes'
import type { IdeaEdit } from '../../lib/publishThumbnail'
import { addIdea, removeIdea, toggleRecommended, updateIdea } from '../../lib/publishThumbnail'
import type { PublishController } from '../../hooks/usePublishRecord'
import { Button } from '../ui/Button'
import { FieldViolations } from './FieldViolations'

/** The type select's width; `.field-input` is 100% wide unless set inline. */
const TYPE_SELECT_WIDTH_PX = 96

interface ThumbnailIdeasProps {
  publish: PublishController
  violations: Violation[]
}

interface IdeaRowProps {
  idea: ThumbnailIdea
  index: number
  group: string
  write: (next: Thumbnail) => void
  thumbnail: Thumbnail
  publish: PublishController
}

function IdeaRow({ idea, index, group, write, thumbnail, publish }: IdeaRowProps) {
  const n = index + 1
  const edit = (patch: IdeaEdit) => write(updateIdea(thumbnail, index, patch))
  const focus = {
    onFocus: () => publish.beginEdit('thumbnail'),
    onBlur: publish.endEdit,
  }
  const types: readonly string[] = THUMBNAIL_IDEA_TYPES.includes(idea.type as never)
    ? THUMBNAIL_IDEA_TYPES
    : [...THUMBNAIL_IDEA_TYPES, idea.type]

  return (
    <li className="flex flex-col gap-1 p-1.5 rounded border border-[var(--color-border)]">
      <div className="flex items-center gap-1.5">
        <input
          type="radio"
          name={group}
          checked={idea.recommended}
          aria-label={`Recommend idea ${n}`}
          title="The recommended idea"
          onChange={() => write(toggleRecommended(thumbnail, index))}
        />
        <input
          type="text"
          className="field-input"
          style={{ width: 'auto', flex: 1, minWidth: 0 }}
          aria-label={`Idea ${n} label`}
          placeholder="Label"
          value={idea.label}
          {...focus}
          onChange={(e) => edit({ label: e.target.value })}
        />
        <select
          className="field-input"
          style={{ width: TYPE_SELECT_WIDTH_PX, flex: 'none' }}
          aria-label={`Idea ${n} type`}
          value={idea.type}
          {...focus}
          onChange={(e) => edit({ type: e.target.value })}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-btn w-5 h-5 text-xs-plus shrink-0"
          aria-label={`Remove idea ${n}`}
          title="Remove this idea"
          onClick={() => write(removeIdea(thumbnail, index))}
        >
          ✕
        </button>
      </div>
      <input
        type="text"
        className="field-input"
        aria-label={`Idea ${n} headline`}
        placeholder="Headline — the words on the thumbnail"
        value={idea.headline}
        {...focus}
        onChange={(e) => edit({ headline: e.target.value })}
      />
      <input
        type="text"
        className="field-input"
        aria-label={`Idea ${n} subtext`}
        placeholder="Subtext (optional)"
        value={idea.subtext ?? ''}
        {...focus}
        onChange={(e) => edit({ subtext: e.target.value })}
      />
      <input
        type="text"
        className="field-input"
        aria-label={`Idea ${n} visual suggestion`}
        placeholder="Visual suggestion (optional)"
        value={idea.visual_suggestion ?? ''}
        {...focus}
        onChange={(e) => edit({ visual_suggestion: e.target.value })}
      />
    </li>
  )
}

export function ThumbnailIdeas({ publish, violations }: ThumbnailIdeasProps) {
  const group = useId()
  const thumbnail = publish.fields.thumbnail
  const write = (next: Thumbnail) => publish.setField('thumbnail', next)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-xs">Ideas</span>
      {thumbnail.ideas.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No thumbnail ideas yet — add one, or ask the agent for a few.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5" aria-label="Thumbnail ideas">
          {thumbnail.ideas.map((idea, i) => (
            <IdeaRow
              key={i}
              idea={idea}
              index={i}
              group={group}
              write={write}
              thumbnail={thumbnail}
              publish={publish}
            />
          ))}
        </ol>
      )}
      <FieldViolations violations={violations} />
      <Button
        variant="ghost"
        className="text-xs-plus py-1 justify-center"
        onClick={() => write(addIdea(thumbnail))}
      >
        Add idea
      </Button>
    </div>
  )
}
