/**
 * Collections ("folders" in the UI): every pure decision the Settings editor,
 * the Publish card and the library make about one (docs/plans/library-collections.md).
 *
 * The backend is the authority on all of it — slot names, ids, the template
 * and what a package violates. What lives here are **hints** that must never
 * contradict it: `BUILTIN_SLOTS` is pinned to the fixture the backend reads
 * (`backend/tests/fixtures/builtin_slots.json`), and a slot name this module
 * accepts is one `SLOT_NAME_RE` accepts.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type {
  BriefOverrideField,
  BriefOverrides,
  Collection,
  CollectionSummary,
} from './collectionTypes'
import { BRIEF_OVERRIDE_FIELDS } from './collectionTypes'
import { MAX_COLLECTION_DEPTH, PATH_SEPARATOR } from './collectionTree'
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

/** Mirrors the backend's `COLLECTION_NAME_MAX_CHARS`. */
export const COLLECTION_NAME_MAX_LENGTH = 120

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

/**
 * Where an inheriting field's value comes from: the path of the deepest folder
 * above that sets it (`Events › UCK 2026`), or null when it is the channel's.
 * `ancestors` are the folders above, top level first (`ancestorsOf`).
 */
export function inheritedFrom(
  ancestors: ReadonlyArray<Pick<Collection, 'name' | 'overrides'>>,
  field: BriefOverrideField
): string | null {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    if (ancestors[i].overrides[field] !== null) {
      return ancestors
        .slice(0, i + 1)
        .map((folder) => folder.name)
        .join(PATH_SEPARATOR)
    }
  }
  return null
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

/** A nesting `422`: a `parent_id` the tree cannot take. */
export type CollectionNestingReason = 'unknown_parent' | 'collection_cycle' | 'collection_too_deep'

/** A refusal the Collections UI acts on: a `409`, or a nesting `422`. */
export type CollectionRefusal =
  | { kind: 'collection_exists' }
  | { kind: 'collection_in_use'; members: number }
  | { kind: 'collection_has_children'; children: number }
  | { kind: CollectionNestingReason }

const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422

const NESTING_REASONS: ReadonlySet<string> = new Set<CollectionNestingReason>([
  'unknown_parent',
  'collection_cycle',
  'collection_too_deep',
])

/** Folder copy for the nesting refusals (Settings → Folders is where they happen). */
const NESTING_MESSAGES: Record<CollectionNestingReason, string> = {
  unknown_parent: 'That folder no longer exists — pick another location.',
  collection_cycle: 'A folder can’t move inside itself or one of its subfolders.',
  collection_too_deep: `Folders nest at most ${MAX_COLLECTION_DEPTH} levels deep — pick a location higher up.`,
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function wholeCount(value: unknown): number {
  return typeof value === 'number' && value > 0 ? Math.floor(value) : 0
}

/** Read a refusal wherever FastAPI put it: top level, or under `detail`. */
export function collectionRefusal(status: number, body: unknown): CollectionRefusal | null {
  const top = objectOf(body)
  const detail = objectOf(top.detail)
  const reason = top.reason ?? detail.reason
  if (status === HTTP_UNPROCESSABLE) {
    return typeof reason === 'string' && NESTING_REASONS.has(reason)
      ? { kind: reason as CollectionNestingReason }
      : null
  }
  if (status !== HTTP_CONFLICT) return null
  if (reason === 'collection_exists') return { kind: 'collection_exists' }
  if (reason === 'collection_in_use') {
    return { kind: 'collection_in_use', members: wholeCount(top.members ?? detail.members) }
  }
  if (reason === 'collection_has_children') {
    return {
      kind: 'collection_has_children',
      children: wholeCount(top.children ?? detail.children),
    }
  }
  return null
}

/** "1 subfolder" / "3 subfolders". */
export function subfolderCount(n: number): string {
  return `${n} subfolder${n === 1 ? '' : 's'}`
}

export function collectionRefusalMessage(refusal: CollectionRefusal): string {
  switch (refusal.kind) {
    case 'collection_exists':
      return 'A folder with that id already exists — pick another name or id.'
    case 'collection_in_use': {
      const n = refusal.members
      return `${videoCount(n)} ${n === 1 ? 'is' : 'are'} still in this folder — move ${n === 1 ? 'it' : 'them'} out first.`
    }
    case 'collection_has_children': {
      const n = refusal.children
      return `${subfolderCount(n)} ${n === 1 ? 'is' : 'are'} still inside this folder — move or delete ${n === 1 ? 'it' : 'them'} first.`
    }
    default:
      return NESTING_MESSAGES[refusal.kind]
  }
}

/**
 * Why a folder cannot be deleted yet, or null. Videos first: the backend
 * refuses them first too. `members` are its own videos, `subfolders` its
 * direct subfolders. Shared by Settings → Folders and the library's folder menu.
 */
export function deleteBlocker(members: number, subfolders: number): string | null {
  if (members > 0) {
    const verb = members === 1 ? 'belongs' : 'belong'
    const them = members === 1 ? 'it' : 'them'
    return `${videoCount(members)} ${verb} to this folder — move ${them} to another folder before deleting it.`
  }
  if (subfolders > 0) {
    const verb = subfolders === 1 ? 'is' : 'are'
    const them = subfolders === 1 ? 'it' : 'them'
    return `${subfolderCount(subfolders)} ${verb} inside this folder — move or delete ${them} before deleting it.`
  }
  return null
}

/** The findings on the assembled description — what the Collections preview draws. */
export function packageDescriptionViolations(violations: readonly Violation[]): Violation[] {
  return violations.filter((v) => v.field === PACKAGE_DESCRIPTION_FIELD)
}
