/**
 * One channel, opened from Settings → Channels: its identity, then "About this
 * channel — for Claude" (the context an agent reads before writing for it),
 * then "Pasted into posts" (the profile the package renderer pastes).
 *
 * The container keeps a local draft of the channel. A keystroke is a draft, a
 * blur (text) or change (toggles, list edits, removals) is a `PATCH` carrying
 * only that field — `context` and `profile` merge per field on the backend.
 * A landed write is adopted for the fields it sent only (`adoptPatched`), so
 * a field being typed meanwhile survives. A blur that changed nothing sends
 * nothing. Failures are toasted by `useChannels`.
 */

import { useState } from 'react'
import { useToast } from '../../hooks/useToast'
import type { Channel, ChannelContext, ChannelPatch, PlatformSpec } from '../../lib/channelTypes'
import type { ChannelProfile } from '../../lib/channelTypes'
import {
  BLANK_CHANNEL_NAME_MESSAGE,
  adoptPatched,
  platformLabel,
  sameValue,
} from '../../lib/channels'
import { ChannelContextSection } from './ChannelContextSection'
import type { IdentityField } from './ChannelIdentitySection'
import { ChannelIdentitySection } from './ChannelIdentitySection'
import { ChannelProfileSection } from './ChannelProfileSection'

export type DraftContext = <K extends keyof ChannelContext>(
  field: K,
  value: ChannelContext[K]
) => void
export type CommitContext = DraftContext
export type DraftProfile = <K extends keyof ChannelProfile>(
  field: K,
  value: ChannelProfile[K]
) => void
export type CommitProfile = DraftProfile

interface ChannelEditorProps {
  /** The saved channel, as the list holds it. */
  channel: Channel
  platforms: readonly PlatformSpec[] | null
  onPatch: (id: string, patch: ChannelPatch) => Promise<Channel | null>
  onMakePrimary: (id: string) => void
  onDelete: (id: string) => void
}

export function ChannelEditor({
  channel,
  platforms,
  onPatch,
  onMakePrimary,
  onDelete,
}: ChannelEditorProps) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Channel>(channel)

  function save(patch: ChannelPatch) {
    void onPatch(channel.id, patch).then((answer) => {
      if (answer) setDraft((prev) => adoptPatched(prev, answer, patch))
    })
  }

  function commitIdentity(field: IdentityField) {
    const value = field === 'name' ? draft.name.trim() : draft[field]
    if (field === 'name' && !value) {
      toast(BLANK_CHANNEL_NAME_MESSAGE, 'error')
      setDraft((prev) => ({ ...prev, name: channel.name }))
      return
    }
    if (value !== channel[field]) save({ [field]: value })
  }

  const draftContext: DraftContext = (field, value) =>
    setDraft((prev) => ({ ...prev, context: { ...prev.context, [field]: value } }))

  const commitContext: CommitContext = (field, value) => {
    draftContext(field, value)
    if (!sameValue(value, channel.context[field])) save({ context: { [field]: value } })
  }

  const draftProfile: DraftProfile = (field, value) =>
    setDraft((prev) => ({ ...prev, profile: { ...prev.profile, [field]: value } }))

  const commitProfile: CommitProfile = (field, value) => {
    draftProfile(field, value)
    if (!sameValue(value, channel.profile[field])) save({ profile: { [field]: value } })
  }

  return (
    <ChannelEditorView
      // `primary` belongs to the list: another channel's promotion changes it, not a draft.
      channel={{ ...draft, primary: channel.primary }}
      platforms={platforms}
      onDraftIdentity={(field, value) => setDraft((prev) => ({ ...prev, [field]: value }))}
      onCommitIdentity={commitIdentity}
      onDraftContext={draftContext}
      onCommitContext={commitContext}
      onDraftProfile={draftProfile}
      onCommitProfile={commitProfile}
      onMakePrimary={() => onMakePrimary(channel.id)}
      onDelete={() => onDelete(channel.id)}
    />
  )
}

export interface ChannelEditorViewProps {
  channel: Channel
  platforms: readonly PlatformSpec[] | null
  onDraftIdentity: (field: IdentityField, value: string) => void
  onCommitIdentity: (field: IdentityField) => void
  onDraftContext: DraftContext
  onCommitContext: CommitContext
  onDraftProfile: DraftProfile
  onCommitProfile: CommitProfile
  onMakePrimary: () => void
  onDelete: () => void
}

export function ChannelEditorView(props: ChannelEditorViewProps) {
  const { channel } = props
  const label = platformLabel(channel.platform, props.platforms)

  return (
    <section
      aria-label={`Channel ${channel.name}`}
      className="flex flex-col gap-6 rounded-lg p-4"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <ChannelIdentitySection
        channel={channel}
        platformLabel={label}
        onDraft={props.onDraftIdentity}
        onCommit={props.onCommitIdentity}
        onMakePrimary={props.onMakePrimary}
        onDelete={props.onDelete}
      />
      <ChannelContextSection
        context={channel.context}
        onDraft={props.onDraftContext}
        onCommit={props.onCommitContext}
      />
      <ChannelProfileSection
        platform={channel.platform}
        profile={channel.profile}
        onDraft={props.onDraftProfile}
        onCommit={props.onCommitProfile}
      />
    </section>
  )
}
