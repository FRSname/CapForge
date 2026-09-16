/**
 * The channel wire types (docs/plans/multi-channel-pr1-contract.md) and the
 * boundary guards that turn `GET|POST|PATCH /api/library/channels[/{id}]`,
 * `POST …/{id}/primary` and `GET /api/library/platforms` bodies into them.
 *
 * A channel is where a video is published: a platform, a name, `context` the
 * agent reads before it writes for that channel, and a `profile` the package
 * renderer pastes. Same contract as `lib/collectionTypes.ts`: a channel with no
 * id **or an unknown platform** throws, since it cannot be shown as anything;
 * a field the backend has not grown degrades to a defined empty value. The
 * profile is read by the brief's own readers, so it can never drift from how
 * the brief reads the same field.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Brief } from './publishTypes'
import { BRIEF_FIELD_READERS } from './publishTypes'
import { bool, num, obj, rows, str, strings } from './wireReaders'

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin' | 'x'

/** Every platform, in the backend's table order. */
export const PLATFORMS: readonly Platform[] = ['youtube', 'tiktok', 'instagram', 'linkedin', 'x']

/** What a platform is called before `GET /platforms` has answered (or when it never does). */
export const FALLBACK_PLATFORM_LABELS: { readonly [P in Platform]: string } = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
}

export interface ChannelContext {
  about: string
  audience: string
  voice: string
  title_style: string
  example_titles: string[]
  naming: string
  example_slugs: string[]
  keywords: string[]
  notes: string
}

export type ChannelProfile = Pick<
  Brief,
  | 'footer'
  | 'recorded_at_line'
  | 'speaker_block'
  | 'default_hashtags'
  | 'link_rows'
  | 'house_rules'
  | 'description_template'
  | 'slots'
>

export interface Channel {
  id: string
  platform: Platform
  name: string
  handle: string
  url: string
  language: string
  context: ChannelContext
  profile: ChannelProfile
  createdAt: string
  updatedAt: string
  primary: boolean
}

export interface ChannelsList {
  primary_id: string
  channels: Channel[]
}

/** `POST /api/library/channels`. Without `id` the backend slugifies `name`. */
export interface ChannelCreate {
  id?: string
  platform: Platform
  name: string
  handle?: string
  url?: string
  language?: string
  context?: Partial<ChannelContext>
  profile?: Partial<ChannelProfile>
}

/**
 * `PATCH /api/library/channels/{id}`. `context` and `profile` merge per field
 * on the backend; `platform` is not patchable.
 */
export interface ChannelPatch {
  name?: string
  handle?: string
  url?: string
  language?: string
  context?: Partial<ChannelContext>
  profile?: Partial<ChannelProfile>
}

export type PlatformLimitUnit = 'chars' | 'bytes' | 'utf16' | 'weighted' | 'items'

export interface PlatformLimit {
  field: string
  max: number
  min?: number
  unit: PlatformLimitUnit
  severity: 'hard' | 'style'
}

export interface PlatformSpec {
  id: Platform
  label: string
  fields: string[]
  limits: PlatformLimit[]
}

export const CHANNEL_SHAPE_MESSAGE =
  'A channel came back in an unexpected shape — the backend may be out of date.'

export const CHANNELS_LIST_SHAPE_MESSAGE =
  'The channels list came back in an unexpected shape — the backend may be out of date.'

export const PLATFORMS_SHAPE_MESSAGE =
  'The platform list came back in an unexpected shape — the backend may be out of date.'

const CONTEXT_TEXT_FIELDS = [
  'about',
  'audience',
  'voice',
  'title_style',
  'naming',
  'notes',
] as const
const CONTEXT_LIST_FIELDS = ['example_titles', 'example_slugs', 'keywords'] as const

/** Every profile field, in the brief's reading order. */
export const CHANNEL_PROFILE_FIELDS: ReadonlyArray<keyof ChannelProfile> = [
  'recorded_at_line',
  'speaker_block',
  'footer',
  'description_template',
  'slots',
  'default_hashtags',
  'link_rows',
  'house_rules',
]

const UNITS: readonly PlatformLimitUnit[] = ['chars', 'bytes', 'utf16', 'weighted', 'items']

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
}

export function parseChannelContext(value: unknown): ChannelContext {
  const row = obj(value) ?? {}
  const out: Record<string, unknown> = {}
  for (const field of CONTEXT_TEXT_FIELDS) out[field] = str(row[field])
  for (const field of CONTEXT_LIST_FIELDS) out[field] = strings(row[field])
  return out as unknown as ChannelContext
}

export function parseChannelProfile(value: unknown): ChannelProfile {
  const row = obj(value) ?? {}
  const out: Record<string, unknown> = {}
  for (const field of CHANNEL_PROFILE_FIELDS) {
    out[field] = (BRIEF_FIELD_READERS[field] as (v: unknown) => unknown)(row[field])
  }
  return out as unknown as ChannelProfile
}

/** A channel row. Throws when there is no id to address it by, or no platform to show it as. */
export function parseChannel(value: unknown): Channel {
  const row = obj(value)
  const id = str(row?.id).trim()
  if (!row || !id || !isPlatform(row.platform)) throw new Error(CHANNEL_SHAPE_MESSAGE)
  return {
    id,
    platform: row.platform,
    name: str(row.name).trim() || id,
    handle: str(row.handle),
    url: str(row.url),
    language: str(row.language),
    context: parseChannelContext(row.context),
    profile: parseChannelProfile(row.profile),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    primary: bool(row.primary),
  }
}

/**
 * `GET /channels` and `POST …/{id}/primary`. `primary_id` is the one truth for
 * which row is primary; a body without it keeps each row's own flag.
 */
export function parseChannelsList(value: unknown): ChannelsList {
  const body = obj(value)
  if (!body || !Array.isArray(body.channels)) throw new Error(CHANNELS_LIST_SHAPE_MESSAGE)
  const primaryId = str(body.primary_id)
  const channels = body.channels.map(parseChannel)
  return {
    primary_id: primaryId,
    channels: primaryId
      ? channels.map((channel) => ({ ...channel, primary: channel.id === primaryId }))
      : channels,
  }
}

function parseLimit(row: Record<string, unknown>): PlatformLimit | null {
  const max = num(row.max, Number.NaN)
  const unit = row.unit
  if (Number.isNaN(max) || !(UNITS as readonly unknown[]).includes(unit)) return null
  const limit: PlatformLimit = {
    field: str(row.field),
    max,
    unit: unit as PlatformLimitUnit,
    severity: row.severity === 'style' ? 'style' : 'hard',
  }
  const min = num(row.min, Number.NaN)
  return Number.isNaN(min) ? limit : { ...limit, min }
}

function parseSpec(row: Record<string, unknown>): PlatformSpec | null {
  if (!isPlatform(row.id)) return null
  return {
    id: row.id,
    label: str(row.label).trim() || FALLBACK_PLATFORM_LABELS[row.id],
    fields: strings(row.fields),
    limits: rows(row.limits, parseLimit).filter((l): l is PlatformLimit => l !== null),
  }
}

/**
 * `GET /api/library/platforms` → the served table. A platform this renderer
 * does not know is dropped rather than thrown: it simply cannot be picked for
 * a new channel, and every platform it does know stays usable.
 */
export function parsePlatformSpecs(value: unknown): PlatformSpec[] {
  const body = obj(value)
  if (!body || !Array.isArray(body.platforms)) throw new Error(PLATFORMS_SHAPE_MESSAGE)
  return rows(body.platforms, parseSpec).filter((s): s is PlatformSpec => s !== null)
}
