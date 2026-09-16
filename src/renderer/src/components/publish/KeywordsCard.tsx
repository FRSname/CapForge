/**
 * Keywords — the terms this video should rank for. A video-level field (the
 * channel tabs carry tags and hashtags), so it sits under This video.
 */

import { StudioCard } from '../studio/StudioCard'
import { parseTagsLine, tagsLine } from '../../lib/publishFields'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

interface KeywordsCardProps {
  publish: PublishController
}

export function KeywordsCard({ publish }: KeywordsCardProps) {
  return (
    <StudioCard title="Keywords" defaultOpen={false}>
      <FieldHeader publish={publish} field="keywords" />
      <input
        type="text"
        className="field-input"
        aria-label="Keywords"
        placeholder="the terms this video should rank for"
        value={tagsLine(publish.fields.keywords)}
        onFocus={() => publish.beginEdit('keywords')}
        onBlur={publish.endEdit}
        onChange={(e) => publish.setField('keywords', parseTagsLine(e.target.value))}
      />
      <FieldViolations violations={publish.violationsFor('keywords')} />
    </StudioCard>
  )
}
