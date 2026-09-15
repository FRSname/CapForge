/**
 * "Pasted into posts": the channel's `profile`, which the package renderer
 * pastes mechanically (footer, links, default hashtags, template, slots, house
 * rules). Collapsed by default — a native disclosure, so it is closed in
 * static markup too — because most of the channel's value is the context above.
 *
 * The editors are the brief's own (`BriefFields.tsx`, `SlotFields.tsx`). A
 * YouTube channel shows every field; other platforms have no description, so
 * they show only default hashtags and link rows (`profileFieldsFor`).
 */

import type { ChannelProfile, Platform } from '../../lib/channelTypes'
import type { ChannelProfileField } from '../../lib/channels'
import { profileFieldsFor } from '../../lib/channels'
import { paletteSlots } from '../../lib/collections'
import { BRIEF_FIELD_SPECS, BriefFieldControl, BriefFieldRow } from './BriefFields'
import type { CommitProfile, DraftProfile } from './ChannelEditor'
import { SlotRowsEditor } from './SlotFields'

const SLOTS_HELP =
  'Custom {{name}} values any description can use. A collection’s slots add to these, and win on a clash.'

interface ChannelProfileSectionProps {
  platform: Platform
  profile: ChannelProfile
  onDraft: DraftProfile
  onCommit: CommitProfile
}

export function ChannelProfileSection({
  platform,
  profile,
  onDraft,
  onCommit,
}: ChannelProfileSectionProps) {
  const palette = paletteSlots(profile.slots)
  return (
    <details className="flex flex-col gap-4">
      <summary
        className="cursor-pointer select-none text-sm"
        style={{ color: 'var(--color-text)' }}
      >
        Pasted into posts
      </summary>
      <div className="mt-3 flex flex-col gap-5">
        <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
          What the upload package pastes as-is around every video’s own text. Claude never copies it
          into a video’s text.
        </p>
        {profileFieldsFor(platform).map((field) => (
          <ProfileField
            key={field}
            field={field}
            profile={profile}
            palette={palette}
            onDraft={onDraft}
            onCommit={onCommit}
          />
        ))}
      </div>
    </details>
  )
}

interface ProfileFieldProps {
  field: ChannelProfileField
  profile: ChannelProfile
  palette: readonly string[]
  onDraft: DraftProfile
  onCommit: CommitProfile
}

function ProfileField({ field, profile, palette, onDraft, onCommit }: ProfileFieldProps) {
  if (field === 'slots') {
    return (
      <BriefFieldRow label="Template slots" htmlFor="channel-slot-0" help={SLOTS_HELP}>
        <SlotRowsEditor
          key={JSON.stringify(profile.slots)}
          idPrefix="channel"
          slots={profile.slots}
          onCommit={(slots) => onCommit('slots', slots)}
        />
      </BriefFieldRow>
    )
  }
  const spec = BRIEF_FIELD_SPECS[field]
  const id = `channel-profile-${field}`
  return (
    <BriefFieldRow label={spec.label} htmlFor={id} help={spec.help}>
      <BriefFieldControl
        field={field}
        id={id}
        value={profile[field]}
        slotNames={palette}
        onDraft={(value) => onDraft(field, value)}
        onCommit={(value) => onCommit(field, value)}
      />
    </BriefFieldRow>
  )
}
