/**
 * `summary_md` — the long-form markdown summary the breakdown skill writes and
 * the Update-conf push maps to `longDescriptionMd`. No meter: nothing on
 * YouTube's side limits it.
 */

import { StudioCard } from '../studio/StudioCard'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

const SUMMARY_ROWS = 8

interface SummaryCardProps {
  publish: PublishController
}

export function SummaryCard({ publish }: SummaryCardProps) {
  return (
    <StudioCard title="Summary" defaultOpen={false}>
      <FieldHeader
        publish={publish}
        field="summary_md"
        hideLabel
        copy={{ text: publish.fields.summary_md, what: 'the summary' }}
      />
      <textarea
        className="field-input resize-y"
        rows={SUMMARY_ROWS}
        aria-label="Summary"
        placeholder="Markdown summary — headings, bullets, whatever the breakdown wrote"
        value={publish.fields.summary_md}
        onFocus={() => publish.beginEdit('summary_md')}
        onBlur={publish.endEdit}
        onChange={(e) => publish.setField('summary_md', e.target.value)}
      />
      <FieldViolations violations={publish.violationsFor('summary_md')} />
    </StudioCard>
  )
}
