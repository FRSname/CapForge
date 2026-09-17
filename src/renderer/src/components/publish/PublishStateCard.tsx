/**
 * Where the video ended up. Paste the YouTube URL and the record remembers the
 * id, the link and when it was marked — which is what flips its status to
 * `published` and what fills `[FULL VIDEO URL]` in the Shorts block.
 *
 * Recording a URL the user pasted is tier 1 (vision §3.5): it applies
 * immediately, and `mark_published` over MCP does exactly the same thing.
 */

import { useState } from 'react'
import { StudioCard } from '../studio/StudioCard'
import { Button } from '../ui/Button'
import type { PublishController } from '../../hooks/usePublishRecord'
import { FieldHeader } from './FieldHeader'
import { FieldViolations } from './FieldViolations'

interface PublishStateCardProps {
  publish: PublishController
}

export function PublishStateCard({ publish }: PublishStateCardProps) {
  const youtube = publish.fields.publish.youtube
  const [url, setUrl] = useState('')

  return (
    <StudioCard title="Publish state" defaultOpen={false}>
      <FieldHeader publish={publish} field="publish" hideLabel />

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          className="field-input"
          aria-label="YouTube URL"
          placeholder="https://youtu.be/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          variant="ghost"
          className="text-xs-plus py-1 px-2 shrink-0"
          onClick={() => publish.markPublished(url)}
        >
          Mark published
        </Button>
      </div>

      <p className="text-2xs mt-2" style={{ color: 'var(--color-text-3)' }}>
        {youtube
          ? `Published as ${youtube.videoId}${youtube.publishedAt ? ` · ${youtube.publishedAt}` : ''}`
          : 'Not published yet.'}
      </p>
      {publish.record && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Status: {publish.record.status || 'unknown'}
        </p>
      )}
      <FieldViolations violations={publish.violationsFor('publish')} />
    </StudioCard>
  )
}
