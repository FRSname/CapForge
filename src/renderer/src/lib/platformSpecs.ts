/**
 * Metering a post against the served platform table (`GET /api/library/platforms`,
 * `lib/channelTypes.ts` `PlatformSpec`) — counts only, never rulings.
 *
 * The limits themselves live in `backend/library/platforms.py`, and every
 * finding comes from the backend's validators. This module only draws the
 * counter beside a field, counting the way the backend counts
 * (`platforms.count`) and over the same text it measures (`pastedText`, the
 * twin of `validate_posts.pasted_text`).
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Platform, PlatformLimit, PlatformLimitUnit, PlatformSpec } from './channelTypes'

/** What X's link shortener makes every URL count (`platforms.X_URL_WEIGHT`). */
export const X_URL_WEIGHT = 23

/** A URL as X's shortener sees one (`platforms.URL_RE`). */
const URL_PATTERN = /https?:\/\/\S+/g

/** Between the body and the hashtag line (`validate_posts.PASTE_SEPARATOR`). */
export const PASTE_SEPARATOR = '\n\n'
const HASHTAG_SEPARATOR = ' '

export type PostBodyField = 'description' | 'caption' | 'text'

const BODY_FIELDS: { readonly [P in Platform]: PostBodyField } = {
  youtube: 'description',
  tiktok: 'caption',
  instagram: 'caption',
  linkedin: 'text',
  x: 'text',
}

/** The platforms a post has no cover on, before the served table has loaded. */
const NO_COVER_FALLBACK: readonly Platform[] = ['x']

const encoder = new TextEncoder()

function codePoints(text: string): number {
  return [...text].length
}

function weighted(text: string): number {
  const urls = text.match(URL_PATTERN) ?? []
  const urlPoints = urls.reduce((sum, url) => sum + codePoints(url), 0)
  return codePoints(text) - urlPoints + X_URL_WEIGHT * urls.length
}

/**
 * How long `value` is in `unit`: `chars` are code points, `bytes` UTF-8,
 * `utf16` code units (`.length`), `weighted` code points with every URL at
 * `X_URL_WEIGHT`, and `items` a list's length. A list is counted by its length
 * whatever the unit; text under `items` counts nothing.
 */
export function countUnits(unit: PlatformLimitUnit, value: string | readonly unknown[]): number {
  if (typeof value !== 'string') return value.length
  switch (unit) {
    case 'chars':
      return codePoints(value)
    case 'bytes':
      return encoder.encode(value).length
    case 'utf16':
      return value.length
    case 'weighted':
      return weighted(value)
    case 'items':
      return 0
  }
}

export function limitFor(
  specs: readonly PlatformSpec[] | null,
  platform: Platform,
  field: string
): PlatformLimit | null {
  const spec = specs?.find((s) => s.id === platform)
  return spec?.limits.find((limit) => limit.field === field) ?? null
}

/** The field a platform's post body lives in. */
export function bodyFieldFor(platform: Platform): PostBodyField {
  return BODY_FIELDS[platform]
}

/** Whether a platform's post carries a cover (the served field list, else the built-in answer). */
export function hasCoverField(specs: readonly PlatformSpec[] | null, platform: Platform): boolean {
  const spec = specs?.find((s) => s.id === platform)
  return spec ? spec.fields.includes('cover') : !NO_COVER_FALLBACK.includes(platform)
}

function bareTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').trim()
}

/** The channel's default hashtags first, then the post's: `#`-prefixed, deduped case-insensitively. */
export function mergedHashtags(
  defaults: readonly string[],
  authored: readonly string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...defaults, ...authored]) {
    const tag = bareTag(raw)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(`#${tag}`)
  }
  return out
}

/** What gets pasted, and so what a limit measures: the body, then the hashtag line. */
export function pastedText(
  body: string,
  hashtags: readonly string[],
  defaultHashtags: readonly string[]
): string {
  const line = mergedHashtags(defaultHashtags, hashtags).join(HASHTAG_SEPARATOR)
  return [body, line].filter(Boolean).join(PASTE_SEPARATOR)
}
