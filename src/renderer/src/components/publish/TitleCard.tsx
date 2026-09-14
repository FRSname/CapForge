/**
 * Title options + the chosen title.
 *
 * The options are radio rows because that is what the agent writes them for:
 * `title_options[]` is a shortlist, and picking one *is* the edit. The meter
 * is YouTube's 100-character limit — the backend refuses a longer one.
 */

import { StudioCard } from '../studio/StudioCard'
import { TITLE_MAX_CHARS } from '../../lib/youtubeRules'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldMeter } from './FieldMeter'
import { FieldViolations } from './FieldViolations'

interface TitleCardProps {
  publish: PublishController
}

export function TitleCard({ publish }: TitleCardProps) {
  const { fields } = publish

  return (
    <StudioCard title="Title" defaultOpen>
      {fields.title_options.length > 0 && (
        <div className="mb-2">
          <FieldHeader publish={publish} field="title_options" />
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Title options">
            {fields.title_options.map((option, i) => (
              <button
                key={`${i}:${option}`}
                type="button"
                role="radio"
                aria-checked={option === fields.title}
                onClick={() => publish.setField('title', option)}
                className="flex items-start gap-2 text-left px-2 py-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors"
                style={{
                  background:
                    option === fields.title ? 'var(--color-accent-subtle)' : 'transparent',
                }}
              >
                <span className="text-2xs shrink-0" style={{ color: 'var(--color-text-3)' }}>
                  {i + 1}
                </span>
                <span className="text-xs min-w-0" style={{ color: 'var(--color-text)' }}>
                  {option}
                </span>
                <span className="ml-auto shrink-0">
                  <FieldMeter used={option.length} limit={TITLE_MAX_CHARS} />
                </span>
              </button>
            ))}
          </div>
          <FieldViolations violations={publish.violationsFor('title_options')} />
        </div>
      )}

      <FieldHeader
        publish={publish}
        field="title"
        meter={<FieldMeter used={fields.title.length} limit={TITLE_MAX_CHARS} />}
      />
      <input
        type="text"
        className="field-input"
        aria-label="Title"
        placeholder="The title that ships"
        value={fields.title}
        onFocus={() => publish.beginEdit('title')}
        onBlur={publish.endEdit}
        onChange={(e) => publish.setField('title', e.target.value)}
      />
      <FieldViolations violations={publish.violationsFor('title')} />
    </StudioCard>
  )
}
