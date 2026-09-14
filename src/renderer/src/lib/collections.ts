/**
 * Collections: every pure decision the Settings editor, the Publish card and
 * the library filter make about one (docs/plans/library-collections.md).
 *
 * The backend is the authority on all of it — slot names, ids, the template
 * and what a package violates. What lives here are **hints** that must never
 * contradict it: `BUILTIN_SLOTS` is pinned to the fixture the backend reads
 * (`backend/tests/fixtures/builtin_slots.json`), and a slot name this module
 * accepts is one `SLOT_NAME_RE` accepts.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { BriefOverrideField, BriefOverrides, CollectionSummary } from './collectionTypes'
import { BRIEF_OVERRIDE_FIELDS } from './collectionTypes'
import type { Brief, Violation } from './publishTypes'

/**
 * The built-in template slots, in the fixture's order. One of two copies
 * (backend `collection_store.py`), both pinned to `builtin_slots.json`.
 */
export const BUILTIN_SLOTS = [
  'description',
  'title',
  'short_description',
  'recorded_at',
  'highlights',
  'chapters',
  'links',
  'speakers',
  'footer',
  'hashtags',
  'channel',
  'collection',
] as const

/** Mirrors the backend's `SLOT_NAME_RE`: a letter, then up to 31 of `[a-z0-9_]`. */
export const SLOT_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/

/** Mirrors the backend's `COLLECTION_ID_RE` length: 64 characters. */
export const COLLECTION_ID_MAX_LENGTH = 64

/** The package finding field for the assembled DESCRIPTION body. */
export const PACKAGE_DESCRIPTION_FIELD = 'package.description'

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_SLOTS)

export const SLOT_NAME_SHAPE_MESSAGE =
  'Slot names start with a lowercase letter and use only a–z, 0–9 and _ (32 characters at most).'

/** How long a one-line summary of an inherited value may get before it is cut. */
const SUMMARY_MAX_CHARS = 80

/** "1 video" / "3 videos". */
export function videoCount(n: number): string {
  return `${n} video${n === 1 ? '' : 's'}`
}

function cut(line: string, more: boolean): string {
  if (line.length > SUMMARY_MAX_CHARS) return `${line.slice(0, SUMMARY_MAX_CHARS)}…`
  return more ? `${line}…` : line
}

/** One short line saying what an inherited brief field holds. */
export function briefValueSummary(value: Brief[BriefOverrideField]): string {
  if (typeof value === 'string') {
    const lines = value.trim().split('\n')
    return lines[0] === '' ? 'empty' : cut(lines[0], lines.length > 1)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty'
    if (value.every((v) => typeof v === 'string')) return cut(value.join(' '), false)
    return `${value.length} link row${value.length === 1 ? '' : 's'}`
  }
  return 'the channel’s house rules'
}

/** `{{name}}` — what a palette chip inserts. */
export function slotToken(name: string): string {
  return `{{${name}}}`
}

/**
 * Why a custom slot name will be refused, or null when it looks fine. `others`
 * is the names of the *other* rows, so a duplicate is caught before saving.
 */
export function slotNameProblem(name: string, others: readonly string[] = []): string | null {
  if (name === '') return 'A slot needs a name.'
  if (!SLOT_NAME_RE.test(name)) return SLOT_NAME_SHAPE_MESSAGE
  if (BUILTIN_SET.has(name)) return `${slotToken(name)} is a built-in slot — pick another name.`
  if (others.includes(name)) return `${slotToken(name)} is named twice.`
  return null
}

/**
 * The id a new collection will probably get. Display only: the backend
 * slugifies (and suffixes `-2` on a clash), so the created id is whatever the
 * `POST` answers.
 */
export function slugPreview(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, COLLECTION_ID_MAX_LENGTH)
    .replace(/-+$/, '')
}

/** The fields a collection sets itself (anything not null), in editor order. */
export function overriddenFields(overrides: BriefOverrides): BriefOverrideField[] {
  return BRIEF_OVERRIDE_FIELDS.filter((field) => overrides[field] !== null)
}

/** "Uses 3 overrides from UCK 26". */
export function overridesSummary(count: number, collectionName: string): string {
  if (count === 0) return `${collectionName} inherits the channel brief`
  return `Uses ${count} override${count === 1 ? '' : 's'} from ${collectionName}`
}

/** Replace the `[start, end)` selection with `{{name}}`; the caret lands after it. */
export function insertSlotToken(
  text: string,
  name: string,
  start: number,
  end: number
): { text: string; caret: number } {
  const from = Math.min(Math.max(0, start), text.length)
  const to = Math.min(Math.max(from, end), text.length)
  const token = slotToken(name)
  return { text: text.slice(0, from) + token + text.slice(to), caret: from + token.length }
}

/** The palette: built-ins first, then each custom name once (a built-in never twice). */
export function paletteSlots(...slotMaps: ReadonlyArray<Record<string, string>>): string[] {
  const custom = slotMaps.flatMap((slots) => Object.keys(slots))
  const unique = [...new Set(custom)].filter((name) => !BUILTIN_SET.has(name))
  return [...BUILTIN_SLOTS, ...unique]
}

/** One editable `name = value` row. */
export interface SlotRow {
  key: string
  value: string
}

export function slotRows(slots: Record<string, string>): SlotRow[] {
  return Object.entries(slots).map(([key, value]) => ({ key, value }))
}

/** Rows back into a slot map: names trimmed, nameless rows dropped, the last duplicate wins. */
export function slotsFromRows(rows: readonly SlotRow[]): Record<string, string> {
  const named = rows
    .map((row) => [row.key.trim(), row.value] as const)
    .filter(([key]) => key !== '')
  return Object.fromEntries(named)
}

/** The name to show for a record's `collection_id`: the collection's, else the bare id. */
export function collectionLabel(
  collections: ReadonlyArray<Pick<CollectionSummary, 'id' | 'name'>>,
  id: string | null
): string | null {
  if (!id) return null
  return collections.find((c) => c.id === id)?.name ?? id
}

/** A `409` the Collections UI acts on. */
export type CollectionRefusal =
  | { kind: 'collection_exists' }
  | { kind: 'collection_in_use'; members: number }

const HTTP_CONFLICT = 409

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Read a refusal wherever FastAPI put it: top level, or under `detail`. */
export function collectionRefusal(status: number, body: unknown): CollectionRefusal | null {
  if (status !== HTTP_CONFLICT) return null
  const top = objectOf(body)
  const detail = objectOf(top.detail)
  const reason = top.reason ?? detail.reason
  if (reason === 'collection_exists') return { kind: 'collection_exists' }
  if (reason !== 'collection_in_use') return null
  const members = top.members ?? detail.members
  return {
    kind: 'collection_in_use',
    members: typeof members === 'number' && members > 0 ? Math.floor(members) : 0,
  }
}

export function collectionRefusalMessage(refusal: CollectionRefusal): string {
  if (refusal.kind === 'collection_exists') {
    return 'A collection with that id already exists — pick another name or id.'
  }
  const n = refusal.members
  return `${n} video${n === 1 ? '' : 's'} still belong${n === 1 ? 's' : ''} to this collection — set their collection to None in the Publish workspace first.`
}

/** The findings on the assembled description — what the Collections preview draws. */
export function packageDescriptionViolations(violations: readonly Violation[]): Violation[] {
  return violations.filter((v) => v.field === PACKAGE_DESCRIPTION_FIELD)
}
