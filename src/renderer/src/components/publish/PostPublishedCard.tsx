/**
 * Where a TikTok, Instagram, LinkedIn or X post went live. Paste its link and
 * the post remembers it (`posts.<id>.published`) — which is what puts the dot
 * on the tab and flips the video's status to `published`. Any URL is accepted
 * off YouTube; the YouTube tab keeps `PublishStateCard`.
 */

import { useState } from 'react'
import { StudioCard } from '../studio/StudioCard'
import { Button } from '../ui/Button'
import type { ChannelPublishController } from '../../lib/channelPublishView'
import { FieldViolations } from './FieldViolations'

interface PostPublishedCardProps {
  view: ChannelPublishController
}

export function PostPublishedCard({ view }: PostPublishedCardProps) {
  const [url, setUrl] = useState('')
  const { published } = view.post

  return (
    <StudioCard title="Published link" defaultOpen={false}>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          className="field-input"
          aria-label="Post URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          variant="ghost"
          className="text-[11px] py-1 px-2 shrink-0"
          onClick={() => view.markPublished(url)}
        >
          Mark published
        </Button>
      </div>
      <p className="text-2xs mt-2 break-all" style={{ color: 'var(--color-text-3)' }}>
        {published.url
          ? `Published at ${published.url}${published.at ? ` · ${published.at}` : ''}`
          : 'Not published yet.'}
      </p>
      <FieldViolations violations={view.postViolations('published')} />
    </StudioCard>
  )
}
