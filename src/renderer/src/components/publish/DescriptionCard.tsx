/**
 * The description: a 5000-**byte** meter (UTF-8, not characters) and the
 * above-the-fold preview of what a viewer sees before "…more".
 */

import { StudioCard } from '../studio/StudioCard'
import { byteLength, first150 } from '../../lib/publishFields'
import { DESCRIPTION_MAX_BYTES, HOOK_CHARS } from '../../lib/youtubeRules'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldMeter } from './FieldMeter'
import { FieldViolations } from './FieldViolations'

/** Rows of the textarea — tall enough to write a paragraph in. */
const DESCRIPTION_ROWS = 10

interface DescriptionCardProps {
  publish: PublishController
}

export function DescriptionCard({ publish }: DescriptionCardProps) {
  const description = publish.fields.description
  const hook = first150(description)

  return (
    <StudioCard title="Description" defaultOpen>
      <FieldHeader
        publish={publish}
        field="description"
        hideLabel
        meter={
          <FieldMeter used={byteLength(description)} limit={DESCRIPTION_MAX_BYTES} unit="bytes" />
        }
      />
      <textarea
        className="field-input resize-y"
        rows={DESCRIPTION_ROWS}
        aria-label="Description"
        placeholder="What this video is, in the channel's voice"
        value={description}
        onFocus={() => publish.beginEdit('description')}
        onBlur={publish.endEdit}
        onChange={(e) => publish.setField('description', e.target.value)}
      />
      <FieldViolations violations={publish.violationsFor('description')} />

      <div className="mt-2">
        <span className="label-xs">Above the fold</span>
        <p
          className="text-2xs mt-1 px-2 py-1.5 rounded border border-[var(--color-border)]"
          style={{ color: 'var(--color-text-2)', background: 'var(--color-base)' }}
        >
          {hook || `The first ${HOOK_CHARS} characters appear here.`}
        </p>
      </div>
    </StudioCard>
  )
}
