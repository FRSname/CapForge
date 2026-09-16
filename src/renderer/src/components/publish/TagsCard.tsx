/**
 * Tags and hashtags — two lists, two lines, on a YouTube channel's tab.
 * (Keywords are the video's, not the channel's: `KeywordsCard`.)
 *
 * The tags meter counts `", ".join(tags)` because that is what YouTube's
 * 500-character limit counts, which is exactly what `tagsLine` produces.
 */

import { StudioCard } from '../studio/StudioCard'
import {
  hashtagsLine,
  parseHashtags,
  parseTagsLine,
  tagsLine,
} from '../../lib/publishFields'
import { TAGS_MAX_CHARS } from '../../lib/youtubeRules'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldMeter } from './FieldMeter'
import { FieldViolations } from './FieldViolations'

interface TagsCardProps {
  publish: PublishController
}

export function TagsCard({ publish }: TagsCardProps) {
  const { fields } = publish
  const tags = tagsLine(fields.tags)

  return (
    <StudioCard title="Tags & hashtags" defaultOpen>
      <FieldHeader
        publish={publish}
        field="tags"
        meter={<FieldMeter used={tags.length} limit={TAGS_MAX_CHARS} />}
      />
      <input
        type="text"
        className="field-input"
        aria-label="Tags"
        placeholder="comma, separated, tags"
        value={tags}
        onFocus={() => publish.beginEdit('tags')}
        onBlur={publish.endEdit}
        onChange={(e) => publish.setField('tags', parseTagsLine(e.target.value))}
      />
      <FieldViolations violations={publish.violationsFor('tags')} />

      <div className="mt-2">
        <FieldHeader publish={publish} field="hashtags" />
        <input
          type="text"
          className="field-input"
          aria-label="Hashtags"
          placeholder="#ai #captions"
          value={hashtagsLine(fields.hashtags)}
          onFocus={() => publish.beginEdit('hashtags')}
          onBlur={publish.endEdit}
          onChange={(e) => publish.setField('hashtags', parseHashtags(e.target.value))}
        />
        <FieldViolations violations={publish.violationsFor('hashtags')} />
      </div>
    </StudioCard>
  )
}
