/**
 * The active channel's cards — only the fields that channel's platform has.
 *
 * Every card renders against `channelPublishController`, so a YouTube tab
 * reuses Title, Description, Tags & hashtags, Localized and Publish state
 * unchanged while their writes land on `posts.<id>` (the primary tab's Title
 * excepted; Publish state sits above Localized and the cover, which are the two
 * least used). A TikTok, Instagram, LinkedIn or X tab gets the post text with its
 * hashtags, a cover (not X) and the published link. Findings on this post that
 * no card draws are listed at the end, so none is lost.
 *
 * Mount it keyed by the channel id: the cards' local state (the Localized
 * card's chosen language, a typed URL) belongs to one tab.
 */

import type { PublishController } from '../../hooks/usePublishRecord'
import type { PublishChannels } from '../../hooks/usePublishChannels'
import type { ChannelPublishController, ChannelTab } from '../../lib/channelPublishView'
import { channelPublishController, unclaimedPostViolations } from '../../lib/channelPublishView'
import type { PostField } from '../../lib/publishPosts'
import { bodyFieldFor, hasCoverField } from '../../lib/platformSpecs'
import { writeStartFromDraft } from '../../lib/publishStartFrom'
import { ChannelLanguageChip } from './ChannelLanguageChip'
import { StartFromStrip } from './StartFromStrip'
import { DescriptionCard } from './DescriptionCard'
import { FieldViolations } from './FieldViolations'
import { LocalizedCard } from './LocalizedCard'
import { PostCoverPicker } from './PostCoverPicker'
import { PostPublishedCard } from './PostPublishedCard'
import { PostTextCard } from './PostTextCard'
import { PublishStateCard } from './PublishStateCard'
import { TagsCard } from './TagsCard'
import { TitleCard } from './TitleCard'

/** The post fields a YouTube tab's cards draw (the primary's title findings are the root's). */
const YOUTUBE_CLAIMED: readonly PostField[] = [
  'title',
  'description',
  'tags',
  'hashtags',
  'localized',
  'cover',
  'published',
  'language',
]

export const ORPHAN_CHANNEL_TEXT =
  'This channel is no longer in Settings → Channels. Its text is kept; hide the tab, or recreate the channel with this id.'

interface ChannelSectionProps {
  publish: PublishController
  tab: ChannelTab
  channels: Pick<PublishChannels, 'channels' | 'platforms' | 'channelViolations' | 'notify'>
}

function YoutubeCards({ view }: { view: ChannelPublishController }) {
  return (
    <>
      <TitleCard publish={view} />
      <DescriptionCard publish={view} />
      <TagsCard publish={view} />
      <PublishStateCard publish={view} />
      <LocalizedCard publish={view} />
      <PostCoverPicker view={view} />
    </>
  )
}

export function ChannelSection({ publish, tab, channels }: ChannelSectionProps) {
  const platform = tab.platform
  if (!platform) {
    return (
      <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-3)' }}>
        {channels.channels === null ? 'Loading channels…' : ORPHAN_CHANNEL_TEXT}
      </p>
    )
  }
  const view = channelPublishController(
    publish,
    tab,
    channels.platforms,
    channels.channelViolations,
    channels.notify
  )
  const cover = hasCoverField(channels.platforms, platform)
  const claimed: readonly PostField[] =
    platform === 'youtube'
      ? YOUTUBE_CLAIMED
      : [
          bodyFieldFor(platform),
          'hashtags',
          'published',
          'language',
          ...(cover ? ['cover' as const] : []),
        ]

  return (
    <>
      <ChannelLanguageChip view={view} />
      {publish.record && (
        <StartFromStrip
          videoId={publish.record.id}
          tab={tab}
          platform={platform}
          record={publish.record}
          body={view.post[bodyFieldFor(platform)]}
          channels={channels.channels}
          platforms={channels.platforms}
          onDraft={(patch) => writeStartFromDraft(patch, view.setPostField)}
          notify={channels.notify}
        />
      )}
      {platform === 'youtube' ? (
        <YoutubeCards view={view} />
      ) : (
        <>
          <PostTextCard view={view} />
          {cover && <PostCoverPicker view={view} />}
          <PostPublishedCard view={view} />
        </>
      )}
      <FieldViolations violations={unclaimedPostViolations(view, claimed)} />
    </>
  )
}
