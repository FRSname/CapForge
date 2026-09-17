/**
 * The language a channel's post is written in: the channel's language by
 * default, or the post's own override (`posts.<id>.language`, null = default).
 *
 * A chip that turns into a language choice when clicked, and back once a
 * language is picked (or focus leaves it).
 */

import { useState } from 'react'
import type { ChannelPublishController } from '../../lib/channelPublishView'
import { LANGUAGES, languageLabel } from '../../lib/languages'
import { FieldViolations } from './FieldViolations'

/** The `<select>` value standing for "the channel's language". */
const CHANNEL_DEFAULT = ''

interface ChannelLanguageChipProps {
  view: ChannelPublishController
}

export function ChannelLanguageChip({ view }: ChannelLanguageChipProps) {
  const [editing, setEditing] = useState(false)
  return <ChannelLanguageChipView view={view} editing={editing} onEditing={setEditing} />
}

export interface ChannelLanguageChipViewProps extends ChannelLanguageChipProps {
  editing: boolean
  onEditing: (editing: boolean) => void
}

function defaultLabel(channelLanguage: string): string {
  return channelLanguage ? `${languageLabel(channelLanguage)} (channel default)` : 'Channel default'
}

export function ChannelLanguageChipView({ view, editing, onEditing }: ChannelLanguageChipViewProps) {
  const override = view.post.language
  const value = override ?? CHANNEL_DEFAULT
  const listed = LANGUAGES.some((l) => l.code === value)
  const fallback = defaultLabel(view.channel.language)

  return (
    <div className="flex flex-col px-1">
      <div className="flex items-center gap-1.5">
        <span className="label-xs">Language</span>
        {editing ? (
          <select
            autoFocus
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs-plus"
            style={{ color: 'var(--color-text)' }}
            aria-label="Post language"
            value={value}
            onBlur={() => onEditing(false)}
            onChange={(e) => {
              view.setPostField('language', e.target.value || null)
              onEditing(false)
            }}
          >
            <option value={CHANNEL_DEFAULT}>{fallback}</option>
            {value && !listed && <option value={value}>{languageLabel(value)}</option>}
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs-plus transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: override ? 'var(--color-text)' : 'var(--color-text-2)' }}
            title="The language this channel’s post is written in — click to change"
            onClick={() => onEditing(true)}
          >
            {override ? `${languageLabel(override)} (this post)` : fallback}
          </button>
        )}
      </div>
      <FieldViolations violations={view.postViolations('language')} />
    </div>
  )
}
