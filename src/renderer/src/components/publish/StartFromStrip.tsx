/**
 * "Start from…" — offered above an empty channel tab's cards.
 *
 * Picking a source fetches the adapted text (`POST …/posts/{id}/draft?from=`,
 * which stores nothing) — or, for the legacy Shorts caption, takes what the
 * record already holds — and writes it through the tab's own post writer, so it
 * lands as an ordinary draft the user can edit or undo before the debounced
 * save. A refusal is toasted through the channels' `notify`, never swallowed.
 *
 * Shown only while this tab's body is empty and there is something to start
 * from; the cards themselves are untouched.
 */

import { useState } from 'react'
import type { Channel, Platform, PlatformSpec } from '../../lib/channelTypes'
import type { ChannelTab } from '../../lib/channelPublishView'
import { draftPostFrom } from '../../lib/postsApi'
import type { PostDraft } from '../../lib/publishPosts'
import type { StartFromOption, StartFromRecord } from '../../lib/publishStartFrom'
import {
  shortsDraftFields,
  startFromFailedMessage,
  startFromLabel,
  startFromOptions,
  startFromPatch,
} from '../../lib/publishStartFrom'

export const START_FROM_TITLE = 'Start from…'

export const START_FROM_HINT =
  'Fill this tab from text you already have. Nothing is saved until you edit it.'

interface StartFromStripProps {
  videoId: string
  tab: ChannelTab
  /** This tab's platform — the strip is only rendered for a known one. */
  platform: Platform
  /** The record the sources are read from (the other posts, and `shorts.caption`). */
  record: StartFromRecord
  /** This tab's body text as shown, drafts included: any text at all hides the strip. */
  body: string
  channels: readonly Channel[] | null
  platforms: readonly PlatformSpec[] | null
  /** Write the drafted fields onto this tab. */
  onDraft: (patch: PostDraft) => void
  notify: (message: string) => void
}

export function StartFromStrip(props: StartFromStripProps) {
  const { videoId, tab, platform, record, body, channels, platforms, onDraft, notify } = props
  const [busy, setBusy] = useState<string | null>(null)
  const options = startFromOptions(record, tab, channels)

  if (body.trim() !== '' || options.length === 0) return null

  function pick(option: StartFromOption) {
    if (option.kind === 'shorts') {
      onDraft(startFromPatch(shortsDraftFields(record.shorts.caption), platform))
      return
    }
    setBusy(option.id)
    draftPostFrom(videoId, tab.id, option.id)
      .then((answer) => onDraft(startFromPatch(answer.fields, platform)))
      .catch((err: unknown) =>
        notify(
          startFromFailedMessage(option.name, err instanceof Error ? err.message : String(err))
        )
      )
      .finally(() => setBusy(null))
  }

  return (
    <section aria-label="Start from" className="flex flex-col gap-1.5 px-1 pb-1">
      <span className="label-xs">{START_FROM_TITLE}</span>
      <p className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {START_FROM_HINT}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs-plus transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            style={{ color: 'var(--color-text-2)' }}
            disabled={busy !== null}
            aria-busy={busy === option.id || undefined}
            onClick={() => pick(option)}
          >
            {busy === option.id ? 'Drafting…' : startFromLabel(option, platforms)}
          </button>
        ))}
      </div>
    </section>
  )
}
