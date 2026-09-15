/**
 * Editing the dossier's `localized` block — the Localized card's transforms,
 * and the composition every `localized` write goes through
 * (docs/plans/publish-editors.md, Part B).
 *
 * **A `PATCH` merges `localized` per language**: an omitted language is kept,
 * `{lang: null}` removes it, an object replaces that language. So a write must
 * name only what the user changed. Sending a whole dict taken before an agent
 * wrote `de` would put the old `de` back (or, with removals, erase it).
 *
 * That is why the `localized` **draft is a delta**, never a snapshot:
 * `localizedDraft(record, next)` keeps only the languages that differ from the
 * record the user was looking at, with `null` for a language they removed.
 * `applyLocalizedDraft` lays it over a record for display,
 * `survivingLocalized` drops the languages an agent wrote over, and
 * `composeLocalizedPatch` turns it into the wire value against the **latest**
 * record at send time (`withLocalizedDraft`, beside `withManagedCandidates`).
 *
 * Nothing here validates — the per-language limits are Python's.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Chapter } from './publishTypes'
import type { LocalizedFields, LocalizedMap } from './publishMediaTypes'
import { EMPTY_LOCALIZED, parseLocalized, parseLocalizedFields } from './publishMediaTypes'
import { LANGUAGES, languageLabel } from './languages'
import type { LanguageInfo } from './languages'
import { obj } from './wireReaders'

export type LocalizedFieldId = keyof LocalizedFields

/** The optional strings the backend stores as `null` when unwritten. */
const NULLABLE_TEXT_FIELDS = [
  'title',
  'description',
  'short_description',
  'shorts_caption',
] as const

/** One language as it goes on the wire: an unwritten string is `null`, as the schema has it. */
export type WireLocalizedFields = Omit<LocalizedFields, (typeof NULLABLE_TEXT_FIELDS)[number]> &
  Record<(typeof NULLABLE_TEXT_FIELDS)[number], string | null>

/** The parts of a record the language list reads. */
export interface LanguageSource {
  /** The source language (`''` when unknown). */
  language: string
  /** The backend's derived list: source, project tracks, localized keys. */
  languages: readonly string[]
  localized: LocalizedMap
}

function sameCode(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The languages that hold fields (a draft's `null` removals are not languages). */
export function storedLanguages(map: LocalizedMap): string[] {
  return Object.keys(map).filter((lang) => map[lang] !== null && map[lang] !== undefined)
}

/**
 * The chips: every language the record knows (its derived `languages`, then
 * its localized keys, then any language only the unsaved `localized` holds),
 * de-duplicated in that order, without the source language — the root fields
 * already are that language.
 */
export function editableLanguages(
  record: LanguageSource,
  localized: LocalizedMap = record.localized
): string[] {
  const out: string[] = []
  const all = [
    ...record.languages,
    ...storedLanguages(record.localized),
    ...storedLanguages(localized),
  ]
  for (const lang of all) {
    if (!lang || out.includes(lang)) continue
    if (record.language && sameCode(lang, record.language)) continue
    out.push(lang)
  }
  return out
}

/** A language with localized fields; one without (a translated track only) is "not started". */
export function isStarted(localized: LocalizedMap, lang: string): boolean {
  return Boolean(localized[lang])
}

/** The table languages the "Add language" choice still offers. */
export function addableLanguages(record: LanguageSource, localized: LocalizedMap): LanguageInfo[] {
  const taken = editableLanguages(record, localized)
  return LANGUAGES.filter(
    (l) =>
      !taken.some((lang) => sameCode(lang, l.code)) &&
      !(record.language && sameCode(record.language, l.code))
  )
}

export function setLocalizedField<K extends LocalizedFieldId>(
  map: LocalizedMap,
  lang: string,
  field: K,
  value: LocalizedFields[K]
): LocalizedMap {
  return { ...map, [lang]: { ...(map[lang] ?? EMPTY_LOCALIZED), [field]: value } }
}

/** Start a language with nothing written. A language that already has fields keeps them. */
export function addLanguage(map: LocalizedMap, lang: string): LocalizedMap {
  return map[lang] ? map : { ...map, [lang]: EMPTY_LOCALIZED }
}

export function removeLanguage(map: LocalizedMap, lang: string): LocalizedMap {
  const next = { ...map }
  delete next[lang]
  return next
}

/** One root chapter with its translated title beside it. */
export interface AlignedChapterTitle {
  start_s: number
  /** The root title — the input's placeholder and the package's fallback. */
  sourceTitle: string
  title: string
}

/** `chapter_titles` is by index against the root chapters; a row per root chapter. */
export function alignedChapterTitles(
  chapters: readonly Chapter[],
  titles: readonly string[]
): AlignedChapterTitle[] {
  return chapters.map((chapter, i) => ({
    start_s: chapter.start_s,
    sourceTitle: chapter.title,
    title: titles[i] ?? '',
  }))
}

/** Titles past the last root chapter — the package ignores them. */
export function extraChapterTitles(
  chapters: readonly Chapter[],
  titles: readonly string[]
): number {
  return Math.max(0, titles.length - chapters.length)
}

/**
 * Set the title at `index`, padding with empty entries (an empty entry falls
 * back to the source title) and trimming trailing empties, so clearing the
 * last title returns the list to what it was.
 */
export function setChapterTitle(titles: readonly string[], index: number, title: string): string[] {
  const next = Array.from({ length: Math.max(titles.length, index + 1) }, (_, i) => titles[i] ?? '')
  next[index] = title
  let end = next.length
  while (end > 0 && next[end - 1] === '') end -= 1
  return next.slice(0, end)
}

// ── The draft and the send ─────────────────────────────────────────

function sameFields(a: LocalizedFields | null | undefined, b: LocalizedFields | null | undefined) {
  if (!a || !b) return !a && !b
  return (
    JSON.stringify(parseLocalizedFields({ ...a })) ===
    JSON.stringify(parseLocalizedFields({ ...b }))
  )
}

/**
 * The delta from `base` (the record the user was looking at) to `next` (what
 * the card now shows): the languages whose fields differ, and `null` for a
 * stored language `next` no longer has.
 */
export function localizedDraft(base: LocalizedMap, next: LocalizedMap): LocalizedMap {
  const draft: LocalizedMap = {}
  for (const lang of storedLanguages(next)) {
    if (!sameFields(base[lang], next[lang])) draft[lang] = next[lang]
  }
  for (const lang of storedLanguages(base)) {
    if (!next[lang]) draft[lang] = null
  }
  return draft
}

/** What the card shows: `base` with the delta laid over it (`null` removes). */
export function applyLocalizedDraft(
  base: LocalizedMap,
  draft: LocalizedMap | undefined
): LocalizedMap {
  if (!draft) return base
  const out: LocalizedMap = { ...base }
  for (const [lang, fields] of Object.entries(draft)) {
    if (fields) out[lang] = fields
    else delete out[lang]
  }
  return out
}

/** A delta read from an untyped patch value: objects through the guard, `null` kept. */
function readDelta(value: unknown): LocalizedMap {
  const raw = obj(value)
  if (!raw) return {}
  const delta: LocalizedMap = parseLocalized(raw)
  for (const [lang, fields] of Object.entries(raw)) {
    if (fields === null) delta[lang] = null
  }
  return delta
}

function toWire(fields: LocalizedFields): WireLocalizedFields {
  const wire = { ...fields } as WireLocalizedFields
  for (const key of NULLABLE_TEXT_FIELDS) wire[key] = fields[key] === '' ? null : fields[key]
  return wire
}

/**
 * The `localized` a `PATCH` carries: each language in the delta whose fields
 * differ from the **latest** record's, and `null` for each removal the latest
 * record still holds. Languages the delta does not name are never sent, so the
 * backend keeps them — whoever wrote them.
 */
export function composeLocalizedPatch(
  draft: LocalizedMap,
  latest: { localized: LocalizedMap }
): Record<string, WireLocalizedFields | null> {
  const out: Record<string, WireLocalizedFields | null> = {}
  for (const [lang, fields] of Object.entries(draft)) {
    if (fields === null) {
      if (latest.localized[lang]) out[lang] = null
    } else if (!sameFields(fields, latest.localized[lang])) {
      out[lang] = toWire(fields)
    }
  }
  return out
}

function withComposed(
  patch: Record<string, unknown>,
  composed: Record<string, WireLocalizedFields | null>
): Record<string, unknown> {
  const { localized: _dropped, ...rest } = patch
  return Object.keys(composed).length > 0 ? { ...rest, localized: composed } : rest
}

/** `patch` ready for the wire when its `localized` is a draft delta (the debounced send). */
export function withLocalizedDraft(
  patch: Record<string, unknown>,
  latest: { localized: LocalizedMap }
): Record<string, unknown> {
  if (!('localized' in patch)) return patch
  return withComposed(patch, composeLocalizedPatch(readDelta(patch.localized), latest))
}

/**
 * `patch` ready for the wire when its `localized` is a **whole** earlier value
 * (Revert sends a history `prev`): the delta that turns the latest record back
 * into it, so a language absent from `prev` is removed and nothing else is sent.
 */
export function withLocalizedRestore(
  patch: Record<string, unknown>,
  latest: { localized: LocalizedMap }
): Record<string, unknown> {
  if (!('localized' in patch)) return patch
  const delta = localizedDraft(latest.localized, parseLocalized(patch.localized))
  return withComposed(patch, composeLocalizedPatch(delta, latest))
}

/**
 * The drafted languages that outlive an agent write: a language the agent left
 * alone stays the user's; one it wrote over (or removed) is the agent's now.
 * Null when nothing is left.
 */
export function survivingLocalized(
  draft: LocalizedMap,
  local: LocalizedMap,
  remote: LocalizedMap
): LocalizedMap | null {
  const keep: LocalizedMap = {}
  for (const [lang, fields] of Object.entries(draft)) {
    if (sameFields(local[lang], remote[lang])) keep[lang] = fields
  }
  return Object.keys(keep).length > 0 ? keep : null
}

/** One entry of the upload package's language choice. `lang: null` is the source package. */
export interface PackageLanguage {
  lang: string | null
  label: string
}

/** Source first, then each **stored** localized language (the package 404s for any other). */
export function packageLanguages(
  record: Pick<LanguageSource, 'language' | 'localized'>
): PackageLanguage[] {
  const source = record.language ? `${languageLabel(record.language)} (source)` : 'Source language'
  return [
    { lang: null, label: source },
    ...storedLanguages(record.localized).map((lang) => ({ lang, label: languageLabel(lang) })),
  ]
}
