/**
 * "This video" — the fields every channel shares, below the channel tabs:
 * collection, chapters, Shorts clips, the thumbnail frames and ideas, keywords,
 * speakers and the summary. These keep the plain `publish` controller and
 * write their root fields; each channel picks its own cover on its tab.
 */

import type { PublishController } from '../../hooks/usePublishRecord'
import type { Segment } from '../../types/app'
import { ChaptersCard } from './ChaptersCard'
import { CollectionCard } from './CollectionCard'
import { KeywordsCard } from './KeywordsCard'
import { ShortsCard } from './ShortsCard'
import { SpeakersCard } from './SpeakersCard'
import { SummaryCard } from './SummaryCard'
import { ThumbnailCard } from './ThumbnailCard'

interface PublishVideoSectionProps {
  publish: PublishController
  segments: readonly Segment[]
  onSeek: (seconds: number) => void
  getPlayhead: () => number
}

export function PublishVideoSection({
  publish,
  segments,
  onSeek,
  getPlayhead,
}: PublishVideoSectionProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-1 pt-2">
        <span className="label-xs">This video</span>
        <span aria-hidden="true" className="flex-1 border-t border-[var(--color-border)]" />
      </div>
      <CollectionCard publish={publish} />
      <ChaptersCard publish={publish} onSeek={onSeek} getPlayhead={getPlayhead} />
      <ShortsCard publish={publish} segments={segments} onSeek={onSeek} getPlayhead={getPlayhead} />
      <ThumbnailCard publish={publish} getPlayhead={getPlayhead} />
      <KeywordsCard publish={publish} />
      <SpeakersCard publish={publish} />
      <SummaryCard publish={publish} />
    </>
  )
}
