/**
 * The dossier's `shorts`, `thumbnail` and `localized` blocks — wire types and
 * their boundary guards (docs/plans/publish-editors.md, Parts A and B).
 *
 * Split from `lib/publishTypes.ts`, which is at its size ceiling, and read the
 * same way: a block the backend has not written degrades to a defined empty
 * value, and a row that is not an object is dropped.
 *
 * `candidates` is kept **verbatim**. It is the one list the renderer must send
 * back byte-for-byte (only the frames routes may change it), so the guard
 * never filters it beyond "is a string".
 *
 * Pure module: no React, no `window`, no I/O.
 */

import { bool, nonEmptyString, num, obj, rows, str, strings } from './wireReaders'

/** One suggested Short, as a span of the source video. Timestamps only (vision §4). */
export interface ClipSuggestion {
  start_s: number
  end_s: number
  why: string
}

export interface Shorts {
  caption: string
  clip_suggestions: ClipSuggestion[]
}

/** The idea types the brief knows. An agent may still write another word; it is kept. */
export const THUMBNAIL_IDEA_TYPES = ['face', 'text', 'diagram', 'screen', 'object'] as const

export type ThumbnailIdeaType = (typeof THUMBNAIL_IDEA_TYPES)[number]

/** A text brief for a thumbnail — not a rendered board (vision §4 "Deferred"). */
export interface ThumbnailIdea {
  label: string
  /** One of `THUMBNAIL_IDEA_TYPES`, or whatever else the agent wrote. */
  type: string
  headline: string
  subtext?: string
  visual_suggestion?: string
  recommended: boolean
}

export interface Thumbnail {
  ideas: ThumbnailIdea[]
  /** Frame file names under the record's `thumbnails/`. Managed by the frames routes only. */
  candidates: string[]
  /** One of `candidates`, or null. */
  cover: string | null
}

/**
 * The authored set for one language (vision §2.4). The backend's optional
 * strings arrive as `null` when unwritten; here they read as `''`, and
 * `lib/publishLocalized.ts` turns `''` back into `null` on the wire.
 */
export interface LocalizedFields {
  title: string
  description: string
  short_description: string
  tags: string[]
  hashtags: string[]
  /** By index against the root `chapters`; an empty entry falls back to the source title. */
  chapter_titles: string[]
  shorts_caption: string
}

/**
 * `localized`, keyed by language code (`pl`, `pt-BR`).
 *
 * On a **record** every value is an object — the guard drops anything else.
 * As a **draft** the map is a delta: only the languages the user changed, and
 * `null` for a language the user removed (`lib/publishLocalized.ts`). That is
 * what lets a send name only those languages, never erasing one an agent wrote
 * meanwhile.
 */
export type LocalizedMap = Record<string, LocalizedFields | null>

export const EMPTY_LOCALIZED: LocalizedFields = {
  title: '',
  description: '',
  short_description: '',
  tags: [],
  hashtags: [],
  chapter_titles: [],
  shorts_caption: '',
}

export const EMPTY_SHORTS: Shorts = { caption: '', clip_suggestions: [] }

export const EMPTY_THUMBNAIL: Thumbnail = { ideas: [], candidates: [], cover: null }

function clip(row: Record<string, unknown>): ClipSuggestion {
  return { start_s: num(row.start_s), end_s: num(row.end_s), why: str(row.why) }
}

function idea(row: Record<string, unknown>): ThumbnailIdea {
  return {
    label: str(row.label),
    type: str(row.type, THUMBNAIL_IDEA_TYPES[0]),
    headline: str(row.headline),
    ...(typeof row.subtext === 'string' ? { subtext: row.subtext } : {}),
    ...(typeof row.visual_suggestion === 'string'
      ? { visual_suggestion: row.visual_suggestion }
      : {}),
    recommended: bool(row.recommended),
  }
}

export function parseShorts(value: unknown): Shorts {
  const raw = obj(value)
  if (!raw) return EMPTY_SHORTS
  return { caption: str(raw.caption), clip_suggestions: rows(raw.clip_suggestions, clip) }
}

export function parseThumbnail(value: unknown): Thumbnail {
  const raw = obj(value)
  if (!raw) return EMPTY_THUMBNAIL
  return {
    ideas: rows(raw.ideas, idea),
    candidates: strings(raw.candidates),
    cover: nonEmptyString(raw.cover),
  }
}

export function parseLocalizedFields(row: Record<string, unknown>): LocalizedFields {
  return {
    title: str(row.title),
    description: str(row.description),
    short_description: str(row.short_description),
    tags: strings(row.tags),
    hashtags: strings(row.hashtags),
    chapter_titles: strings(row.chapter_titles),
    shorts_caption: str(row.shorts_caption),
  }
}

/** The stored languages. A value that is not an object (a `null` removal included) is dropped. */
export function parseLocalized(value: unknown): LocalizedMap {
  const raw = obj(value)
  if (!raw) return {}
  const out: LocalizedMap = {}
  for (const [lang, fields] of Object.entries(raw)) {
    const row = obj(fields)
    if (row) out[lang] = parseLocalizedFields(row)
  }
  return out
}
