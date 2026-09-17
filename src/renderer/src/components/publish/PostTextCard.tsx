/**
 * A TikTok, Instagram, LinkedIn or X post: its caption or text, and its hashtags.
 *
 * The meters count what gets pasted — the text, then the hashtag line with the
 * channel's default hashtags first — in the platform's own unit (UTF-16 for
 * TikTok, weighted for X), from the served table (`lib/platformSpecs.ts`).
 * They are display only: the findings under each field are the backend's.
 *
 * Each box has a copy button for its own text. The full pasted text — body,
 * then the channel's hashtags and the post's — is the footer's copy.
 */

import type { PlatformLimitUnit } from '../../lib/channelTypes'
import type { ChannelPublishController } from '../../lib/channelPublishView'
import { hashtagsLine, parseHashtags } from '../../lib/publishFields'
import type { PostBodyField } from '../../lib/platformSpecs'
import { bodyFieldFor, countUnits, mergedHashtags, pastedText } from '../../lib/platformSpecs'
import { StudioCard } from '../studio/StudioCard'
import { CopyButton } from '../ui/CopyButton'
import type { MeterUnit } from './FieldMeter'
import { FieldMeter } from './FieldMeter'
import { FieldViolations } from './FieldViolations'

/** Rows of the textarea — room for a caption without scrolling. */
const BODY_ROWS = 8

const BODY_TITLES: { readonly [F in PostBodyField]: string } = {
  description: 'Description',
  caption: 'Caption',
  text: 'Post text',
}

const METER_UNITS: { readonly [U in PlatformLimitUnit]: MeterUnit } = {
  chars: 'chars',
  bytes: 'bytes',
  utf16: 'chars',
  weighted: 'chars',
  items: 'hashtags',
}

interface PostTextCardProps {
  view: ChannelPublishController
}

export function PostTextCard({ view }: PostTextCardProps) {
  const platform = view.channel.platform
  if (!platform) return null
  const field = bodyFieldFor(platform)
  const title = BODY_TITLES[field]
  const { post, channel } = view
  const body = post[field]
  const bodyLimit = view.limit(field)
  const tagLimit = view.limit('hashtags')
  const pasted = pastedText(body, post.hashtags, channel.defaultHashtags)
  const tags = mergedHashtags(channel.defaultHashtags, post.hashtags)
  const hashtags = hashtagsLine(post.hashtags)

  return (
    <StudioCard title={title} defaultOpen>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="label-xs truncate">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {bodyLimit && (
            <FieldMeter
              used={countUnits(bodyLimit.unit, pasted)}
              limit={bodyLimit.max}
              unit={METER_UNITS[bodyLimit.unit]}
            />
          )}
          <CopyButton text={body} what={`the ${title.toLowerCase()}`} />
        </span>
      </div>
      <textarea
        className="field-input resize-y"
        rows={BODY_ROWS}
        aria-label={title}
        placeholder={`The ${title.toLowerCase()} for ${channel.name}`}
        value={body}
        onFocus={() => view.beginEdit('posts')}
        onBlur={view.endEdit}
        onChange={(e) => view.setPostField(field, e.target.value)}
      />
      <FieldViolations violations={view.postViolations(field)} />

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="label-xs">Hashtags</span>
          <span className="flex items-center gap-2 shrink-0">
            {tagLimit && (
              <FieldMeter used={countUnits('items', tags)} limit={tagLimit.max} unit="hashtags" />
            )}
            <CopyButton text={hashtags} what="the hashtags" />
          </span>
        </div>
        <input
          type="text"
          className="field-input"
          aria-label="Hashtags"
          placeholder="#ai #captions"
          value={hashtags}
          onFocus={() => view.beginEdit('posts')}
          onBlur={view.endEdit}
          onChange={(e) => view.setPostField('hashtags', parseHashtags(e.target.value))}
        />
        {channel.defaultHashtags.length > 0 && (
          <p className="text-2xs mt-1" style={{ color: 'var(--color-text-3)' }}>
            The channel adds {hashtagsLine(channel.defaultHashtags)} first.
          </p>
        )}
        <FieldViolations violations={view.postViolations('hashtags')} />
      </div>
    </StudioCard>
  )
}
