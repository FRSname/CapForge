/**
 * "Publish to:" — shown in place of the channel tabs while the video has no
 * visible post. Tick the Settings channels this video goes to and Add: one
 * write gives it a post on each (`usePublishChannels.addChannels`).
 *
 * Nothing is ticked by default in PR 3 (the remembered choice arrives with the
 * import sheet in PR 4). With no channels in Settings there is nothing to tick,
 * so a single line points to Settings → Channels.
 */

import { useState } from 'react'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { platformLabel } from '../../lib/channels'
import { requestSettingsCategory } from '../../lib/settingsNavigation'
import { useToast } from '../../hooks/useToast'
import { PlatformBadge } from '../settings/PlatformBadge'
import { Button } from '../ui/Button'

/** Said when Settings could not be opened for us. */
export const MANAGE_CHANNELS_FALLBACK = 'Open Settings (⌘,) → Channels to add a channel.'

interface PublishToChecklistProps {
  /** Settings channels; null while they load. */
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  onAdd: (channelIds: readonly string[]) => void
}

export function PublishToChecklist({ channels, platforms, onAdd }: PublishToChecklistProps) {
  const { toast } = useToast()
  const [ticked, setTicked] = useState<string[]>([])
  return (
    <PublishToChecklistView
      channels={channels}
      platforms={platforms}
      ticked={ticked}
      onToggle={(id) =>
        setTicked((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
      }
      onAdd={() => {
        onAdd(ticked)
        setTicked([])
      }}
      onManage={() => {
        if (!requestSettingsCategory('channels')) toast(MANAGE_CHANNELS_FALLBACK, 'info')
      }}
    />
  )
}

export interface PublishToChecklistViewProps {
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  ticked: readonly string[]
  onToggle: (channelId: string) => void
  onAdd: () => void
  onManage: () => void
}

export function PublishToChecklistView(props: PublishToChecklistViewProps) {
  const { channels, platforms, ticked, onToggle, onAdd, onManage } = props
  return (
    <section
      aria-label="Publish to"
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <span className="label-xs">Publish to:</span>
      {channels === null ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          Loading channels…
        </p>
      ) : channels.length === 0 ? (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          No channels yet.{' '}
          <button
            type="button"
            className="hover:underline"
            style={{ color: 'var(--color-accent)' }}
            onClick={onManage}
          >
            Add one in Settings → Channels
          </button>
        </p>
      ) : (
        <>
          <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
            Pick where this video goes. Each channel gets its own tab and its own text.
          </p>
          <ul className="flex flex-col gap-1">
            {channels.map((channel) => (
              <li key={channel.id}>
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs"
                  style={{ color: 'var(--color-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={ticked.includes(channel.id)}
                    onChange={() => onToggle(channel.id)}
                  />
                  <PlatformBadge
                    platform={channel.platform}
                    label={platformLabel(channel.platform, platforms)}
                  />
                  <span className="truncate">{channel.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            className="self-start text-[11px] py-1 px-3"
            disabled={ticked.length === 0}
            onClick={onAdd}
          >
            Add
          </Button>
        </>
      )}
    </section>
  )
}
