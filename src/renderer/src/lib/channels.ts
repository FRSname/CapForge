/**
 * Settings → Channels, the parts worth testing without React
 * (docs/plans/multi-channel-publish.md §4.1a, §7).
 *
 * Which profile fields a platform shows, the one-per-line list editors for
 * `example_titles` / `example_slugs` / `keywords`, platform labels with a
 * fallback before the served table loads, the primary/delete guards, the
 * refusals the REST client maps, and the immutable list updates the hook makes.
 * Every rule about what a channel *may* be stays in the backend.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Channel, ChannelPatch, ChannelProfile, Platform, PlatformSpec } from './channelTypes'
import { CHANNEL_PROFILE_FIELDS, FALLBACK_PLATFORM_LABELS, PLATFORMS } from './channelTypes'

export type ChannelProfileField = keyof ChannelProfile

/** What a non-YouTube post pastes: no description, so no template, footer, slots or house rules. */
const POST_PROFILE_FIELDS: readonly ChannelProfileField[] = ['default_hashtags', 'link_rows']

/** The profile fields a channel's "Pasted into posts" section shows, in order. */
export function profileFieldsFor(platform: Platform): readonly ChannelProfileField[] {
  return platform === 'youtube' ? CHANNEL_PROFILE_FIELDS : POST_PROFILE_FIELDS
}

/** One entry per line: trimmed, blank lines dropped. Commas stay inside an entry. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function listToLines(list: readonly string[]): string {
  return list.join('\n')
}

const PLATFORM_GLYPHS: { readonly [P in Platform]: string } = {
  youtube: 'YT',
  tiktok: 'TT',
  instagram: 'IG',
  linkedin: 'in',
  x: 'X',
}

/** The served label, else the built-in one. */
export function platformLabel(platform: Platform, specs: readonly PlatformSpec[] | null): string {
  return specs?.find((spec) => spec.id === platform)?.label ?? FALLBACK_PLATFORM_LABELS[platform]
}

/** The short monogram the list and the picker draw beside a channel. */
export function platformGlyph(platform: Platform): string {
  return PLATFORM_GLYPHS[platform]
}

export interface PlatformOption {
  id: Platform
  label: string
}

/** What "New channel…" offers: the served platforms, or every known one until they load. */
export function platformOptions(specs: readonly PlatformSpec[] | null): PlatformOption[] {
  if (specs && specs.length > 0) return specs.map((spec) => ({ id: spec.id, label: spec.label }))
  return PLATFORMS.map((id) => ({ id, label: FALLBACK_PLATFORM_LABELS[id] }))
}

/** The primary channel is always YouTube, so only a YouTube channel offers to become it. */
export function showsMakePrimary(channel: Pick<Channel, 'platform'>): boolean {
  return channel.platform === 'youtube'
}

export function canMakePrimary(channel: Pick<Channel, 'platform' | 'primary'>): boolean {
  return showsMakePrimary(channel) && !channel.primary
}

export function canDeleteChannel(channel: Pick<Channel, 'primary'>): boolean {
  return !channel.primary
}

export const BLANK_CHANNEL_NAME_MESSAGE = 'A channel needs a name.'

export const PRIMARY_NOTE =
  'The primary channel is what the brief and existing upload packages use.'

export const PRIMARY_DELETE_HINT =
  'This is the primary channel — make another YouTube channel primary before deleting it.'

export const PLATFORM_LOCKED_NOTE =
  'A channel’s platform can’t be changed — create a new channel for another platform.'

/** A refusal the Channels UI can phrase. */
export type ChannelRefusal =
  | { kind: 'channel_exists' }
  | { kind: 'channel_is_primary' }
  | { kind: 'primary_not_youtube' }

const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422

/** Which status each reason arrives with. */
const REFUSAL_STATUS: { readonly [K in ChannelRefusal['kind']]: number } = {
  channel_exists: HTTP_CONFLICT,
  channel_is_primary: HTTP_CONFLICT,
  primary_not_youtube: HTTP_UNPROCESSABLE,
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function isRefusalKind(value: unknown): value is ChannelRefusal['kind'] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_STATUS, value)
}

/** Read a refusal wherever FastAPI put its reason: top level, or under `detail`. */
export function channelRefusal(status: number, body: unknown): ChannelRefusal | null {
  const top = objectOf(body)
  const reason = top.reason ?? objectOf(top.detail).reason
  if (!isRefusalKind(reason) || REFUSAL_STATUS[reason] !== status) return null
  return { kind: reason }
}

export function channelRefusalMessage(refusal: ChannelRefusal): string {
  switch (refusal.kind) {
    case 'channel_exists':
      return 'A channel with that id already exists — pick another name.'
    case 'channel_is_primary':
      return 'That is the primary channel — make another YouTube channel primary before deleting it.'
    case 'primary_not_youtube':
      return 'Only a YouTube channel can be the primary channel.'
  }
}

/** The failure toast for one channel action. */
export function channelFailedMessage(action: string, reason: string): string {
  return `Could not ${action}: ${reason}`
}

export function replaceChannel(list: readonly Channel[], next: Channel): Channel[] {
  return list.map((channel) => (channel.id === next.id ? next : channel))
}

export function removeChannel(list: readonly Channel[], id: string): Channel[] {
  return list.filter((channel) => channel.id !== id)
}

type TopLevelPatchField = 'name' | 'handle' | 'url' | 'language'
const TOP_LEVEL_PATCH_FIELDS: readonly TopLevelPatchField[] = ['name', 'handle', 'url', 'language']

/**
 * Adopt a landed write into the editor's draft: only the fields that patch
 * sent come from the backend's answer (plus its `updatedAt` and `primary`),
 * so a field the user started typing in meanwhile is not overwritten.
 */
export function adoptPatched(draft: Channel, answer: Channel, patch: ChannelPatch): Channel {
  const top = Object.fromEntries(
    TOP_LEVEL_PATCH_FIELDS.filter((field) => field in patch).map((field) => [field, answer[field]])
  )
  const context = Object.fromEntries(
    Object.keys(patch.context ?? {}).map((field) => [
      field,
      answer.context[field as keyof Channel['context']],
    ])
  )
  const profile = Object.fromEntries(
    Object.keys(patch.profile ?? {}).map((field) => [
      field,
      answer.profile[field as ChannelProfileField],
    ])
  )
  return {
    ...draft,
    ...top,
    context: { ...draft.context, ...context },
    profile: { ...draft.profile, ...profile },
    updatedAt: answer.updatedAt,
    primary: answer.primary,
  }
}

/** Structural equality for the small JSON values a field holds — "did this blur change anything". */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
