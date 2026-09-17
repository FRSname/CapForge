/**
 * The import "Publish to:" choice (docs/plans/multi-channel-pr4-contract.md
 * §Part C): what is remembered between imports, what each outcome sends, and
 * what the sheet calls the batch it is asking about.
 *
 * The one rule the request bodies depend on: **an empty choice sends no
 * `channels` key at all**, so an import with no channel picked is byte-identical
 * to the request CapForge sent before this existed. Every client builds that
 * key through `channelsBody` rather than spelling it out.
 *
 * Nothing here validates a channel id — an id Settings no longer has is simply
 * dropped at read time, and the backend refuses an unknown one with `422
 * unknown_channel` before importing anything.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Channel } from './channelTypes'
import type { ImportPlan } from './libraryImport'
import { plural } from './libraryImport'

/** `app-state` key holding the channels the last import published to. */
export const LAST_PUBLISH_CHANNELS_KEY = 'lastPublishChannels'

/** What the sheet came to. `cancelled` imports nothing at all. */
export type ImportChannelsOutcome =
  | { kind: 'import'; channelIds: string[] }
  | { kind: 'cancelled' }

/** Import with nothing ticked — the "Skip" button. */
export const SKIPPED: Extract<ImportChannelsOutcome, { kind: 'import' }> = {
  kind: 'import',
  channelIds: [],
}

/** Said in the sheet when nothing is ticked yet, and by the Skip button's title. */
export const SKIP_TITLE = 'Import these videos without putting them on a channel.'

/** Said by Cancel (and by Escape / a click on the scrim). */
export const CANCEL_TITLE = 'Import nothing — close this and leave the library as it is.'

/** Said instead of the sheet when Settings has no channel to tick. */
export const NO_CHANNELS_LINE =
  'No channels yet — add one in Settings → Channels and an import can publish straight to it.'

/** Said in the sheet when the channels could not be read; the import can still go ahead. */
export function channelsUnreadableMessage(reason: string): string {
  return `Could not read the channels: ${reason}. You can still import without one.`
}

/** Said when Settings could not be opened for us. */
export const MANAGE_CHANNELS_FALLBACK = 'Open Settings (⌘,) → Channels to add a channel.'

/**
 * The remembered choice, kept only where Settings still has the channel: a
 * deleted channel must never be silently re-imported into. `channels` is null
 * while the list is loading, which remembers nothing rather than everything.
 */
export function rememberedChannels(
  stored: unknown,
  channels: readonly Pick<Channel, 'id'>[] | null
): string[] {
  if (!Array.isArray(stored) || !channels) return []
  const known = new Set(channels.map((channel) => channel.id))
  return stored.filter((id): id is string => typeof id === 'string' && known.has(id))
}

/** True when there is anything to tick — otherwise the sheet is skipped entirely. */
export function hasChannelsToPick(channels: readonly Pick<Channel, 'id'>[] | null): boolean {
  return (channels?.length ?? 0) > 0
}

/**
 * The `channels` key an import request carries. An empty (or absent) choice
 * adds **no key**, which is what keeps the request identical to today's.
 */
export function channelsBody(ids?: readonly string[]): { channels?: string[] } {
  return ids && ids.length > 0 ? { channels: [...ids] } : {}
}

/** One ticked id toggled, keeping the list in Settings order-independent insertion order. */
export function toggleChannel(ticked: readonly string[], channelId: string): string[] {
  return ticked.includes(channelId)
    ? ticked.filter((id) => id !== channelId)
    : [...ticked, channelId]
}

/** What the sheet says is about to be imported: "2 folders + 3 videos". */
export function importWhatLabel(plan: ImportPlan): string {
  const parts: string[] = []
  if (plan.folders.length > 0) parts.push(plural(plan.folders.length, 'folder'))
  if (plan.media.length > 0) parts.push(plural(plan.media.length, 'video'))
  if (plan.projects.length > 0) parts.push(plural(plan.projects.length, 'project'))
  return parts.length > 0 ? parts.join(' + ') : 'this import'
}

/**
 * The sentence above the sheet's list. It says what the choice is (which
 * channels the video is for) and what it is not (an upload), because a first
 * launch reads "Publish to" + "Import" as "send this somewhere now". The
 * subject follows `importWhatLabel`: one video is "this video", anything else
 * "these videos".
 */
export function sheetIntro(what: string): string {
  const subject = what === '1 video' ? 'this video' : 'these videos'
  return `Choose which channels ${subject} ${subject === 'this video' ? 'is' : 'are'} for. Nothing is uploaded — CapForge only drafts the text you'll paste later.`
}

/** The Import button's text: it names how many channels are ticked. */
export function importButtonText(ticked: readonly string[]): string {
  if (ticked.length === 0) return 'Import'
  return `Import to ${plural(ticked.length, 'channel')}`
}
