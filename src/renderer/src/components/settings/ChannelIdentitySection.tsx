/**
 * A channel's identity: its platform (read-only — the backend refuses a
 * platform change), name, handle, URL and language, "Make primary" for a
 * YouTube channel, and delete (refused for the primary channel).
 */

import { useState } from 'react'
import type { Channel } from '../../lib/channelTypes'
import {
  PLATFORM_LOCKED_NOTE,
  PRIMARY_DELETE_HINT,
  PRIMARY_NOTE,
  canDeleteChannel,
  canMakePrimary,
  showsMakePrimary,
} from '../../lib/channels'
import { Button } from '../ui/Button'
import { BriefFieldRow } from './BriefFields'
import { PlatformBadge } from './PlatformBadge'

export type IdentityField = 'name' | 'handle' | 'url' | 'language'

const IDENTITY_FIELDS: ReadonlyArray<{ field: IdentityField; label: string; placeholder: string }> =
  [
    { field: 'name', label: 'Name', placeholder: 'What you call this channel' },
    { field: 'handle', label: 'Handle', placeholder: '@handle' },
    { field: 'url', label: 'URL', placeholder: 'https://' },
    { field: 'language', label: 'Language', placeholder: 'Empty = the transcript’s language' },
  ]

interface ChannelIdentitySectionProps {
  channel: Channel
  platformLabel: string
  onDraft: (field: IdentityField, value: string) => void
  onCommit: (field: IdentityField) => void
  onMakePrimary: () => void
  onDelete: () => void
}

export function ChannelIdentitySection(props: ChannelIdentitySectionProps) {
  const { channel, platformLabel } = props
  return (
    <div role="group" aria-label="Identity" className="flex flex-col gap-4">
      <span className="text-sm" style={{ color: 'var(--color-text)' }}>
        {channel.name}
      </span>

      <BriefFieldRow label="Platform" help={PLATFORM_LOCKED_NOTE}>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
          <PlatformBadge platform={channel.platform} label={platformLabel} />
          <span>{platformLabel}</span>
        </div>
      </BriefFieldRow>

      {IDENTITY_FIELDS.map(({ field, label, placeholder }) => (
        <BriefFieldRow key={field} label={label} htmlFor={`channel-${field}`}>
          <input
            id={`channel-${field}`}
            type="text"
            className="field-input"
            placeholder={placeholder}
            value={channel[field]}
            onChange={(e) => props.onDraft(field, e.target.value)}
            onBlur={() => props.onCommit(field)}
          />
        </BriefFieldRow>
      ))}

      {showsMakePrimary(channel) && (
        <PrimaryRow channel={channel} onMakePrimary={props.onMakePrimary} />
      )}
      <DeleteRow channel={channel} onDelete={props.onDelete} />
    </div>
  )
}

function PrimaryRow({ channel, onMakePrimary }: { channel: Channel; onMakePrimary: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        className="self-start text-xs"
        disabled={!canMakePrimary(channel)}
        onClick={onMakePrimary}
      >
        {channel.primary ? 'Primary channel' : 'Make primary'}
      </Button>
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {PRIMARY_NOTE}
      </p>
    </div>
  )
}

function DeleteRow({ channel, onDelete }: { channel: Channel; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const deletable = canDeleteChannel(channel)
  return (
    <div className="flex flex-col gap-1.5">
      {confirming && deletable ? (
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--color-text-2)' }}>{`Delete ${channel.name}?`}</span>
          <Button variant="danger" className="text-xs" onClick={onDelete}>
            Delete
          </Button>
          <Button variant="ghost" className="text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          className="self-start text-xs"
          disabled={!deletable}
          onClick={() => setConfirming(true)}
        >
          Delete channel
        </Button>
      )}
      {!deletable && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {PRIMARY_DELETE_HINT}
        </p>
      )}
    </div>
  )
}
