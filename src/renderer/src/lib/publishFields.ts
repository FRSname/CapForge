/**
 * The Publish panel's field inventory and every pure decision it makes:
 * which field lives on which card, who last wrote it, what Revert restores,
 * and how the flat text a user types maps onto the record's lists.
 *
 * Kept React-free so all of it is testable in the node environment — the cards
 * only bind these functions to inputs (the same split `lib/settingsSearch.ts`
 * has against `StudioPanel`).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { HistoryEntry, PublishAuthored, PublishRecord } from './publishTypes'
import type { Segment } from '../types/app'
import { HOOK_CHARS } from './youtubeRules'
import { composeThumbnailPatch } from './publishThumbnail'

export { violationsForField } from './publishViolations'

/** Every authored field the panel can write. Keys of `PublishAuthored`. */
export type PublishFieldId = keyof PublishAuthored

/** The cards the panel stacks, top to bottom. */
export type PublishCardId =
  | 'title'
  | 'description'
  | 'localized'
  | 'collection'
  | 'chapters'
  | 'shorts'
  | 'thumbnail'
  | 'tags'
  | 'speakers'
  | 'summary'
  | 'publish'

export interface PublishFieldSpec {
  id: PublishFieldId
  label: string
  card: PublishCardId
}

/**
 * The inventory. Order is the order the panel renders, and the card grouping
 * is what puts a violation under the right control — the backend names a
 * `field`, and this is the only map from that name to a place on screen.
 */
export const PUBLISH_FIELDS: ReadonlyArray<PublishFieldSpec> = [
  { id: 'title_options', label: 'Title options', card: 'title' },
  { id: 'title', label: 'Title', card: 'title' },
  { id: 'description', label: 'Description', card: 'description' },
  { id: 'localized', label: 'Localized', card: 'localized' },
  { id: 'collection_id', label: 'Folder', card: 'collection' },
  { id: 'chapters', label: 'Chapters', card: 'chapters' },
  { id: 'shorts', label: 'Shorts', card: 'shorts' },
  { id: 'thumbnail', label: 'Thumbnail', card: 'thumbnail' },
  { id: 'tags', label: 'Tags', card: 'tags' },
  { id: 'keywords', label: 'Keywords', card: 'tags' },
  { id: 'hashtags', label: 'Hashtags', card: 'tags' },
  { id: 'speakers', label: 'Speakers', card: 'speakers' },
  { id: 'summary_md', label: 'Summary', card: 'summary' },
  { id: 'publish', label: 'Publish state', card: 'publish' },
]

/** `posts` is on no card of its own: each channel tab draws its fields. */
const POSTS_LABEL = 'Channel posts'

const FIELD_LABELS: ReadonlyMap<string, string> = new Map([
  ...PUBLISH_FIELDS.map((f): [string, string] => [f.id, f.label]),
  ['posts', POSTS_LABEL],
])

/** The human label for a field id — falls back to the id the backend used. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS.get(field) ?? field
}

/**
 * Just the authored half of a record — what `POST /api/library/validate` is
 * asked about. The system fields (`rev`, `history`, `status`, …) are not
 * validated and have no business riding along on every debounce.
 */
/**
 * Fields the validator and the debounced patch may carry. `publish` is not one:
 * no rule reads it, its wire shape is an always-present youtube object (the
 * renderer keeps a nullable one), and a channel tab writes it as
 * `posts.<id>.published` instead. Nor is `posts`, which is not in the
 * inventory at all: a channel's post is judged by `POST /validate` with
 * `channel` (`hooks/usePublishChannels.ts`). Nor is `collection_id`: a select, written at once
 * (`setCollection`), and the validator reads the record's own collection when
 * it is given a `video_id`.
 */
export const WIRE_EXCLUDED_FIELDS: ReadonlySet<PublishFieldId> = new Set<PublishFieldId>([
  'publish',
  'collection_id',
])

export function authoredFields(source: PublishAuthored): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of PUBLISH_FIELDS) {
    if (WIRE_EXCLUDED_FIELDS.has(spec.id)) continue
    out[spec.id] = source[spec.id]
  }
  return out
}

/** Who last wrote a field, and when. */
export interface Provenance {
  by: string
  at: string
}

/**
 * The newest `history[]` entry for a field, or null when nobody has written it.
 *
 * Newest is decided by `at` (ISO-8601, so lexicographic order is chronological)
 * with a later array position winning a tie — the backend appends, but this way
 * the chip is right whichever end it appends to.
 */
export function provenanceOf(record: PublishRecord, field: PublishFieldId): Provenance | null {
  let newest: HistoryEntry | null = null
  for (const entry of record.history) {
    if (entry.field !== field) continue
    if (!newest || entry.at >= newest.at) newest = entry
  }
  return newest ? { by: newest.by, at: newest.at } : null
}

/**
 * The patch that undoes the newest write to a field, or null when there is
 * nothing recorded to go back to. Tier 1 of the confirmation model: an agent
 * write applies immediately, and this is the one click that takes it back.
 */
export function revertPatchFor(
  record: PublishRecord,
  field: PublishFieldId
): Record<string, unknown> | null {
  let newest: HistoryEntry | null = null
  for (const entry of record.history) {
    if (entry.field !== field) continue
    if (!newest || entry.at >= newest.at) newest = entry
  }
  // `prev: undefined` means the entry recorded no previous value (a first
  // write), which is not something the panel can restore.
  if (!newest || newest.prev === undefined) return null
  return { [field]: newest.prev }
}

const encoder = new TextEncoder()

/** UTF-8 byte length — YouTube's description limit counts bytes, not characters. */
export function byteLength(s: string): number {
  return encoder.encode(s).length
}

/** The "above the fold" slice of a description: what a viewer sees before "…more". */
export function first150(description: string): string {
  return description.slice(0, HOOK_CHARS)
}

/** The tags as one editable line — also exactly what the 500-char limit counts. */
export function tagsLine(tags: readonly string[]): string {
  return tags.join(', ')
}

/** That line back into tags: comma separated, trimmed, empties dropped. */
export function parseTagsLine(line: string): string[] {
  return line
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** The hashtags as one editable line, every entry carrying its `#`. */
export function hashtagsLine(hashtags: readonly string[]): string {
  return hashtags.map(ensureHash).filter(Boolean).join(' ')
}

function ensureHash(tag: string): string {
  const bare = tag.trim().replace(/^#+/, '')
  return bare ? `#${bare}` : ''
}

/** That line back into hashtags: split on whitespace or commas, `#` ensured. */
export function parseHashtags(line: string): string[] {
  return line
    .split(/[\s,]+/)
    .map(ensureHash)
    .filter(Boolean)
}

/** The local record with the drafts spread over it; its `posts` is a draft delta, never read. */
export type MergeLocal = Omit<PublishRecord, 'posts'> & { posts?: unknown }

/**
 * The soft lock (vision §3.5 tier 2). An agent write arrived while the user was
 * typing: take the agent's record wholesale, except for the one field under the
 * cursor, which stays as the user left it until they choose.
 *
 * A locked `thumbnail` keeps the user's ideas and cover but takes the remote
 * frames: `candidates` belongs to the frames routes, and a record holding a
 * stale list would make the next write a `candidates_managed` refusal.
 *
 * A locked `localized` takes the remote languages whole: the user's side of it
 * is a delta that stays a draft (`survivingDrafts`), and the record under it
 * must be the backend's, or the send would compare the delta with itself.
 *
 * A locked `posts` does the same, for the same reason: its draft is a delta.
 *
 * Never mutates either side — the result is a fresh record.
 */
export function mergeAgentUpdate(
  local: MergeLocal,
  remote: PublishRecord,
  editingField: PublishFieldId | null
): PublishRecord {
  if (!editingField) return remote
  if (editingField === 'localized' || editingField === 'posts') return remote
  if (editingField === 'thumbnail') {
    return { ...remote, thumbnail: composeThumbnailPatch(local.thumbnail, remote) }
  }
  return { ...remote, [editingField]: local[editingField] }
}

/**
 * The diarized speaker ids in order of first appearance — the rows the
 * Speakers card offers to name. Diarization yields `SPEAKER_00/01`; nothing
 * else in the app maps them to people.
 */
export function speakersFromTranscript(segments: readonly Segment[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const segment of segments) {
    const speaker = segment.speaker?.trim()
    if (!speaker || seen.has(speaker)) continue
    seen.add(speaker)
    order.push(speaker)
  }
  return order
}

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/**
 * "just now" / "3 m ago" / "2 h ago" / "5 d ago" — the provenance chip's
 * second half. Deliberately coarse: it says *how recently* somebody touched the
 * field, not when.
 */
export function relativeTime(at: string, now: number = Date.now()): string {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((now - then) / MS_PER_SECOND))
  if (seconds < SECONDS_PER_MINUTE) return 'just now'
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes} m ago`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours} h ago`
  return `${Math.floor(hours / HOURS_PER_DAY)} d ago`
}
