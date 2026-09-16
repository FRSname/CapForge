/**
 * Settings → Channels (docs/plans/multi-channel-publish.md §4.1a, §7): where a
 * video can be published — a YouTube channel, an Instagram account… — and,
 * above all, how each one looks and sounds, so Claude can write for it.
 *
 * This file is the list: a platform monogram, the name, a Primary badge, and
 * "New channel…" (platform + name). The selected channel — the primary one
 * until another is clicked — opens in `ChannelEditor`. All I/O and every
 * failure toast live in `useChannels`; the backend decides ids.
 */

import { useState } from 'react'
import { useChannels } from '../../hooks/useChannels'
import { useToast } from '../../hooks/useToast'
import type { Channel, Platform, PlatformSpec } from '../../lib/channelTypes'
import { platformLabel, platformOptions } from '../../lib/channels'
import { slugPreview } from '../../lib/collections'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { ChannelEditor } from './ChannelEditor'
import { PlatformBadge } from './PlatformBadge'

const DEFAULT_NEW_PLATFORM: Platform = 'youtube'
/** The platform picker's width in the "New channel…" row (see the note at its use). */
const PLATFORM_PICKER_WIDTH = '8rem'

export function ChannelsSettings() {
  const { toast } = useToast()
  const { channels, platforms, create, patch, remove, makePrimary } = useChannels()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = channels ?? []
  const shownId = selectedId ?? list.find((c) => c.primary)?.id ?? null
  const selected = list.find((c) => c.id === shownId) ?? null

  function onCreate(platform: Platform, name: string) {
    void create({ platform, name }).then((created) => {
      if (!created) return
      toast(`Created ${created.name}`, 'success')
      setSelectedId(created.id)
    })
  }

  return (
    <div data-tour="settings-channels" className="flex flex-col gap-5">
      <ChannelsSettingsView
        channels={list}
        platforms={platforms}
        loading={channels === null}
        selectedId={shownId}
        onSelect={setSelectedId}
        onCreate={onCreate}
      />
      {selected && (
        <ChannelEditor
          key={selected.id}
          channel={selected}
          platforms={platforms}
          onPatch={patch}
          onMakePrimary={(id) => void makePrimary(id)}
          onDelete={(id) =>
            void remove(id).then((done) => {
              if (!done) return
              toast(`Deleted ${selected.name}`, 'success')
              setSelectedId(null)
            })
          }
        />
      )}
    </div>
  )
}

export interface ChannelsSettingsViewProps {
  channels: readonly Channel[]
  platforms: readonly PlatformSpec[] | null
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (platform: Platform, name: string) => void
}

export function ChannelsSettingsView(props: ChannelsSettingsViewProps) {
  const { channels, platforms, loading, selectedId, onSelect } = props
  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        A channel is somewhere your videos are published. Describe how each one looks and sounds —
        Claude reads it before it writes a post for that channel.
      </p>

      <ul className="flex flex-col gap-0.5" aria-label="Channels">
        {channels.map((c) => (
          <li key={c.id}>
            <ChannelRow
              channel={c}
              label={platformLabel(c.platform, platforms)}
              selected={c.id === selectedId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>

      {channels.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
          {loading ? 'Reading channels…' : 'No channels yet.'}
        </p>
      )}

      <CreateChannelRow platforms={platforms} onCreate={props.onCreate} />
    </div>
  )
}

interface ChannelRowProps {
  channel: Channel
  label: string
  selected: boolean
  onSelect: (id: string) => void
}

function ChannelRow({ channel, label, selected, onSelect }: ChannelRowProps) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surface-2)]"
      style={{
        background: selected ? 'var(--color-surface-2)' : 'transparent',
        color: 'var(--color-text)',
      }}
      onClick={() => onSelect(channel.id)}
    >
      <PlatformBadge platform={channel.platform} label={label} />
      <span className="truncate">{channel.name}</span>
      <span className="shrink-0 text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {label}
      </span>
      {channel.primary && (
        <span
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-2xs"
          style={{ color: 'var(--color-brand)', background: 'var(--color-surface-3)' }}
        >
          Primary
        </span>
      )}
    </button>
  )
}

interface CreateChannelRowProps {
  platforms: readonly PlatformSpec[] | null
  onCreate: (platform: Platform, name: string) => void
}

function CreateChannelRow({ platforms, onCreate }: CreateChannelRowProps) {
  const [platform, setPlatform] = useState<Platform>(DEFAULT_NEW_PLATFORM)
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const slug = slugPreview(trimmed)
  const options = platformOptions(platforms)

  function submit() {
    if (!trimmed) return
    onCreate(platform, trimmed)
    setName('')
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="label-xs">New channel…</span>
      <div className="flex items-center gap-1.5">
        {/* `.field-input` sets `width: 100%`, which outranks the `w-32` utility, so
            the picker's width has to be inline — without it the name field and the
            Create button are pushed off the edge of the Settings dialog. */}
        <Select
          aria-label="New channel platform"
          className="w-32 shrink-0"
          style={{ width: PLATFORM_PICKER_WIDTH }}
          value={platform}
          onChange={(e) => {
            const next = options.find((o) => o.id === e.target.value)
            if (next) setPlatform(next.id)
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <input
          type="text"
          className="field-input"
          aria-label="New channel name"
          placeholder="Channel name — e.g. Update Conference"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <Button variant="primary" className="shrink-0 text-xs" disabled={!trimmed} onClick={submit}>
          Create
        </Button>
      </div>
      {slug && (
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {`Its id will likely be ${slug} — the backend decides, and adds -2 on a clash.`}
        </p>
      )}
    </div>
  )
}
