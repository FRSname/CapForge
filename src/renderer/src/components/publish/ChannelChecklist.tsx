/**
 * "Publish to:" — the tick-a-channel list, shared by the two places that ask
 * the same question: the Publish panel's empty state (PR 3, for a video on no
 * channel yet) and the import sheet (PR 4, for a batch about to be imported).
 *
 * It owns no state and decides nothing: the caller holds the ticked ids and
 * renders its own actions as `children`, so "Add" and "Import / Skip / Cancel"
 * live with the flow they belong to. With no channels in Settings there is
 * nothing to tick, so a single line points to Settings → Channels.
 */

import type { ReactNode } from 'react'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { platformLabel } from '../../lib/channels'
import { PlatformBadge } from '../settings/PlatformBadge'

export interface ChannelChecklistProps {
  /** Settings channels; null while they load. */
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  ticked: readonly string[]
  onToggle: (channelId: string) => void
  /** Open Settings → Channels (or say where to find it). */
  onManage: () => void
  /** The sentence above the list. */
  intro: string
  /** Why the channels could not be read — shown in place of the list, never swallowed. */
  error?: string | null
  /** The actions under the list. */
  children?: ReactNode
}

export function ChannelChecklist(props: ChannelChecklistProps) {
  const { channels, platforms, ticked, onToggle, onManage, intro, error, children } = props
  return (
    <section
      aria-label="Publish to"
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <span className="label-xs">Publish to:</span>
      {error ? (
        <p className="text-2xs" style={{ color: 'var(--color-amber-2)' }}>
          {error}
        </p>
      ) : channels === null ? (
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
            {intro}
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
        </>
      )}
      {children}
    </section>
  )
}
