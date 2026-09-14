/**
 * The publish wire types — and the boundary checks that turn the untyped
 * bodies of `GET/PATCH /api/library/{id}`, `/api/library/brief`,
 * `/api/library/validate`, `…/package` and `…/moments` into them.
 *
 * Same contract as `lib/libraryTypes.ts`: the backend owns the dossier, the
 * renderer only reads it, so the shape is validated **once**, here, instead of
 * being trusted field by field in seven cards. Anything the backend has not
 * grown yet degrades to a defined empty value (a record with no `chapters` is
 * a record with no chapters); only a body that could not address anything at
 * all — no `id` — throws, with a message a user can act on.
 *
 * Pure module: no React, no `window`, no I/O.
 */

/** One authored chapter. Seconds, not a formatted string (`lib/youtubeRules.ts` formats). */
export interface Chapter {
  start_s: number
  title: string
}

/** A description link row: `{label, url}`, same shape in the record and the brief. */
export interface LinkRow {
  label: string
  url: string
}

/** A diarized speaker, named. Every field is optional — an unnamed speaker is a placeholder. */
export interface SpeakerInfo {
  name: string
  handle: string
  url: string
}

/** Where the video ended up. Absent until the user pastes the URL. */
export interface YoutubePublish {
  videoId: string
  url: string
  publishedAt: string
}

export interface PublishBlock {
  youtube: YoutubePublish | null
}

/** One `history[]` entry: who last wrote a field, when, and what it said before. */
export interface HistoryEntry {
  field: string
  /** The value the field held before this write — what Revert restores. */
  prev: unknown
  /** `'agent'`, `'user'`, or whatever else the backend attributes a write to. */
  by: string
  /** ISO-8601. */
  at: string
}

/** Hard/style finding from `backend/library/validate.py` — the one implementation. */
export interface Violation {
  field: string
  rule: string
  message: string
  severity: 'hard' | 'style'
}

/** The authored half of the dossier — exactly what the Publish panel writes. */
export interface PublishAuthored {
  title_options: string[]
  title: string
  description: string
  chapters: Chapter[]
  tags: string[]
  keywords: string[]
  hashtags: string[]
  speakers: Record<string, SpeakerInfo>
  summary_md: string
  publish: PublishBlock
}

/** The record view: the authored fields plus the system ones the panel reads. */
export interface PublishRecord extends PublishAuthored {
  id: string
  rev: number
  duration: number | null
  status: string
  hasProject: boolean
  links: LinkRow[]
  history: HistoryEntry[]
}

/** House-style rules — only enforced when the brief asks for them. */
export interface HouseRules {
  no_em_dashes: boolean
  /** `[min, max]` characters, or null when the channel has no window. */
  description_chars: [number, number] | null
  /** `[min, max]` terms on the keywords line, or null. */
  keywords_terms: [number, number] | null
  hook_first_150: boolean
}

/** `GET /api/library/brief` — the global channel brief. */
export interface Brief {
  channel: string
  audience: string
  voice: string
  /** Empty means "the transcript's language". */
  language: string
  footer: string
  recorded_at_line: string
  speaker_block: string
  default_hashtags: string[]
  link_rows: LinkRow[]
  house_rules: HouseRules
}

/** One `find_video_moments` hit — a candidate chapter boundary. */
export interface Moment {
  text: string
  start: number
  end: number
  word_id: string
  /** `kind=pause`: the silence, in seconds. */
  gap?: number
  /** `kind=speaker_change`: the speaker starting here. */
  speaker?: string
}

/** `GET /api/library/{id}/package` — rendered text plus whatever it violates. */
export interface UploadPackage {
  platform: string
  text: string
  violations: Violation[]
}

/** The body was not a usable record. */
export const PUBLISH_RECORD_SHAPE_MESSAGE =
  'The video record came back in an unexpected shape — the backend may be out of date.'

export const BRIEF_SHAPE_MESSAGE =
  'The channel brief came back in an unexpected shape — the backend may be out of date.'

export const PACKAGE_SHAPE_MESSAGE =
  'The upload package came back in an unexpected shape — the backend may be out of date.'

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function linkRows(value: unknown): LinkRow[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({ label: str(row.label), url: str(row.url) }))
}

function chapters(value: unknown): Chapter[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({ start_s: num(row.start_s), title: str(row.title) }))
}

function speakers(value: unknown): Record<string, SpeakerInfo> {
  const raw = obj(value)
  if (!raw) return {}
  const out: Record<string, SpeakerInfo> = {}
  for (const [id, info] of Object.entries(raw)) {
    const row = obj(info)
    out[id] = {
      name: str(row?.name),
      handle: str(row?.handle),
      url: str(row?.url),
    }
  }
  return out
}

function publishBlock(value: unknown): PublishBlock {
  const raw = obj(value)
  const yt = obj(raw?.youtube)
  // A block with neither an id nor a URL is "not published yet", not a half-state.
  if (!yt || (!str(yt.videoId) && !str(yt.url))) return { youtube: null }
  return {
    youtube: {
      videoId: str(yt.videoId),
      url: str(yt.url),
      publishedAt: str(yt.publishedAt),
    },
  }
}

function history(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .filter((row) => typeof row.field === 'string')
    .map((row) => ({
      field: row.field as string,
      prev: row.prev,
      by: str(row.by),
      at: str(row.at),
    }))
}

function severity(value: unknown): Violation['severity'] {
  return value === 'style' ? 'style' : 'hard'
}

/** `{violations: [...]}` from any of the three routes that can carry findings. */
export function parseViolations(value: unknown): Violation[] {
  const list = Array.isArray(value) ? value : obj(value)?.violations
  if (!Array.isArray(list)) return []
  return list
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({
      field: str(row.field),
      rule: str(row.rule),
      message: str(row.message),
      severity: severity(row.severity),
    }))
}

/**
 * `GET/PATCH /api/library/{id}` → the dossier the Publish panel edits.
 * Throws only when the body cannot be addressed (no `id`): everything a card
 * draws has a defined empty value, so a backend that has not grown a field yet
 * renders as "nothing written" rather than blanking the workspace.
 */
export function parsePublishRecord(value: unknown): PublishRecord {
  const row = obj(value)
  if (!row) throw new Error(PUBLISH_RECORD_SHAPE_MESSAGE)
  const id = str(row.id).trim()
  if (!id) throw new Error(PUBLISH_RECORD_SHAPE_MESSAGE)

  return {
    id,
    rev: num(row.rev, 1),
    duration: nullableNumber(row.duration),
    status: str(row.status),
    hasProject: row.hasProject === true,
    title_options: strings(row.title_options),
    title: str(row.title),
    description: str(row.description),
    chapters: chapters(row.chapters),
    tags: strings(row.tags),
    keywords: strings(row.keywords),
    hashtags: strings(row.hashtags),
    speakers: speakers(row.speakers),
    summary_md: str(row.summary_md),
    links: linkRows(row.links),
    publish: publishBlock(row.publish),
    history: history(row.history),
  }
}

function houseRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [lo, hi] = value
  if (typeof lo !== 'number' || typeof hi !== 'number') return null
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return [lo, hi]
}

/** `GET/PATCH /api/library/brief`. A missing file answers with defaults, so
 *  every field here has one — an unreachable brief is not an empty channel. */
export function parseBrief(value: unknown): Brief {
  const row = obj(value)
  if (!row) throw new Error(BRIEF_SHAPE_MESSAGE)
  const rules = obj(row.house_rules)
  return {
    channel: str(row.channel),
    audience: str(row.audience),
    voice: str(row.voice),
    language: str(row.language),
    footer: str(row.footer),
    recorded_at_line: str(row.recorded_at_line),
    speaker_block: str(row.speaker_block),
    default_hashtags: strings(row.default_hashtags),
    link_rows: linkRows(row.link_rows),
    house_rules: {
      no_em_dashes: bool(rules?.no_em_dashes),
      description_chars: houseRange(rules?.description_chars),
      keywords_terms: houseRange(rules?.keywords_terms),
      hook_first_150: bool(rules?.hook_first_150, true),
    },
  }
}

/** `GET /api/library/{id}/package` — the text is the whole point, so it must exist. */
export function parseUploadPackage(value: unknown): UploadPackage {
  const row = obj(value)
  if (!row || typeof row.text !== 'string') throw new Error(PACKAGE_SHAPE_MESSAGE)
  return {
    platform: str(row.platform, 'youtube'),
    text: row.text,
    violations: parseViolations(row.violations),
  }
}

/** `GET /api/library/{id}/moments` → `{matches: [...]}`. Unusable rows are dropped:
 *  a moment is a *suggestion*, and half a list of candidates still suggests. */
export function parseMoments(value: unknown): Moment[] {
  const list = obj(value)?.matches
  if (!Array.isArray(list)) return []
  return list
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .filter((row) => typeof row.start === 'number' && Number.isFinite(row.start))
    .map((row) => ({
      text: str(row.text),
      start: num(row.start),
      end: num(row.end),
      word_id: str(row.word_id),
      ...(typeof row.gap === 'number' ? { gap: row.gap } : {}),
      ...(typeof row.speaker === 'string' ? { speaker: row.speaker } : {}),
    }))
}
