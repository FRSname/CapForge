/**
 * The collection wire types (docs/plans/library-collections.md) and the
 * boundary guards that turn `GET|POST|PATCH /api/library/collections[/{cid}]`
 * bodies into them.
 *
 * A collection is a small backend-owned entity: a name, custom template slots
 * and **overrides** of the channel brief. An override is any brief field
 * except `slots`, or `null` for "inherit the channel". Same contract as
 * `lib/publishTypes.ts`: only a body with no `id` throws; anything the backend
 * has not grown degrades to a defined empty value.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Brief } from './publishTypes'
import { BRIEF_FIELD_READERS, parseBrief } from './publishTypes'

/** A brief field a collection may override — all of them except `slots`, which merge instead. */
export type BriefOverrideField = Exclude<keyof Brief, 'slots'>

/** Per field: the collection's own value, or null to inherit the channel's. */
export type BriefOverrides = { [K in BriefOverrideField]: Brief[K] | null }

/** Every overridable field, in the order the editor lists them. */
export const BRIEF_OVERRIDE_FIELDS: ReadonlyArray<BriefOverrideField> = [
  'channel',
  'audience',
  'voice',
  'language',
  'recorded_at_line',
  'speaker_block',
  'footer',
  'description_template',
  'default_hashtags',
  'link_rows',
  'house_rules',
]

export const EMPTY_OVERRIDES: BriefOverrides = Object.fromEntries(
  BRIEF_OVERRIDE_FIELDS.map((field) => [field, null])
) as BriefOverrides

export interface Collection {
  id: string
  name: string
  slots: Record<string, string>
  overrides: BriefOverrides
  createdAt: string
  updatedAt: string
}

/** A list row, and what `POST` answers: the collection plus how many videos carry its id. */
export interface CollectionSummary extends Collection {
  members: number
}

/** A `collection_id` records carry that names no collection — adoptable by creating it. */
export interface CollectionOrphan {
  id: string
  members: number
}

/** `GET /api/library/collections`. */
export interface CollectionsList {
  collections: CollectionSummary[]
  orphans: CollectionOrphan[]
}

/** `GET|PATCH /api/library/collections/{cid}`: the brief every member's package is rendered with. */
export interface CollectionDetail extends CollectionSummary {
  effective_brief: Brief
}

export const COLLECTION_SHAPE_MESSAGE =
  'A collection came back in an unexpected shape — the backend may be out of date.'

export const COLLECTIONS_LIST_SHAPE_MESSAGE =
  'The collections list came back in an unexpected shape — the backend may be out of date.'

export const COLLECTION_DETAIL_SHAPE_MESSAGE =
  'The collection came back without its effective brief — the backend may be out of date.'

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A non-negative whole count; anything else is zero. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Present and not null → read like the brief reads it; absent or null → inherit. */
export function parseBriefOverrides(value: unknown): BriefOverrides {
  const row = obj(value)
  if (!row) return { ...EMPTY_OVERRIDES }
  const out: Record<string, unknown> = {}
  for (const field of BRIEF_OVERRIDE_FIELDS) {
    const raw = row[field]
    out[field] = raw === null || raw === undefined ? null : BRIEF_FIELD_READERS[field](raw)
  }
  return out as BriefOverrides
}

/** A collection row. Throws only when there is no id to address it by. */
export function parseCollection(value: unknown): CollectionSummary {
  const row = obj(value)
  const id = str(row?.id).trim()
  if (!row || !id) throw new Error(COLLECTION_SHAPE_MESSAGE)
  return {
    id,
    name: str(row.name).trim() || id,
    slots: BRIEF_FIELD_READERS.slots(row.slots),
    overrides: parseBriefOverrides(row.overrides),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    members: count(row.members),
  }
}

function parseOrphans(value: unknown): CollectionOrphan[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => obj(item))
    .filter((row): row is Record<string, unknown> => row !== null && str(row.id) !== '')
    .map((row) => ({ id: str(row.id), members: count(row.members) }))
}

export function parseCollectionsList(value: unknown): CollectionsList {
  const body = obj(value)
  if (!body || !Array.isArray(body.collections)) throw new Error(COLLECTIONS_LIST_SHAPE_MESSAGE)
  return {
    collections: body.collections.map(parseCollection),
    orphans: parseOrphans(body.orphans),
  }
}

/**
 * One collection with its effective brief. That brief is required: defaults
 * in its place would show the editor a channel that is not the user's.
 */
export function parseCollectionDetail(value: unknown): CollectionDetail {
  const collection = parseCollection(value)
  const effective = obj(obj(value)?.effective_brief)
  if (!effective) throw new Error(COLLECTION_DETAIL_SHAPE_MESSAGE)
  return { ...collection, effective_brief: parseBrief(effective) }
}
