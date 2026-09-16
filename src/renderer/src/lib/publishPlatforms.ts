/**
 * Copy for a channel tab — the words around the footer's package button.
 *
 * The text itself is rendered by the backend (`backend/library/platform_posts.py`)
 * and every length/hashtag rule is judged there; this module only labels the
 * button and phrases the toast after a copy.
 *
 * The old per-platform copy (`?platform=`) went with that route in PR 4: a
 * channel names its platform, so there is nothing left to choose.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Platform } from './channelTypes'
import { FALLBACK_PLATFORM_LABELS } from './channelTypes'
import type { Violation } from './publishTypes'

export interface PackageToast {
  message: string
  type: 'success' | 'info'
}

/**
 * The one toast after a package copy. A hard finding means the text will not
 * paste as-is, so the count and the first message are shown, and the copied
 * text's own finding leads, ahead of the record's. Style findings alone are
 * still a clean copy — they are drawn under the fields.
 */
function copiedToast(
  violations: readonly Violation[],
  what: string,
  isOwn: (field: string) => boolean
): PackageToast {
  const hard = violations.filter((v) => v.severity === 'hard')
  if (hard.length === 0) return { message: `Copied ${what}`, type: 'success' }
  const first = hard.find((v) => isOwn(v.field)) ?? hard[0]
  const issues = hard.length === 1 ? '1 issue' : `${hard.length} issues`
  return { message: `Copied — ${issues}: ${first.message}`, type: 'info' }
}

// ── Per channel tab (multi-channel PR 3) ───────────────────────────

/** What a channel's copy button calls the text it copies. */
const CHANNEL_COPY_NOUNS: { readonly [P in Platform]: string } = {
  youtube: 'package',
  tiktok: 'caption',
  instagram: 'caption',
  linkedin: 'post',
  x: 'post',
}

/** "Copy YouTube package", "Copy Instagram caption", "Copy X post", … */
export function channelCopyText(platform: Platform): string {
  return `Copy ${FALLBACK_PLATFORM_LABELS[platform]} ${CHANNEL_COPY_NOUNS[platform]}`
}

export function channelCopyTitle(platform: Platform): string {
  const label = FALLBACK_PLATFORM_LABELS[platform]
  return platform === 'youtube'
    ? 'The whole YouTube Studio paste, rendered from this channel’s post and profile'
    : `This channel’s ${label} ${CHANNEL_COPY_NOUNS[platform]} — clipboard text only, nothing is posted`
}

/** What the success toast says was copied; `languageLabel` is null for the source. */
export function channelCopiedWhat(platform: Platform, languageLabel: string | null): string {
  const language = languageLabel ? `${languageLabel} ` : ''
  return `the ${language}${FALLBACK_PLATFORM_LABELS[platform]} ${CHANNEL_COPY_NOUNS[platform]}`
}

/** The toast after a channel's package copy: that channel's own findings lead. */
export function channelPackageCopiedToast(
  channelId: string,
  violations: readonly Violation[],
  what: string
): PackageToast {
  const own = `posts.${channelId}`
  return copiedToast(violations, what, (field) => field === own || field.startsWith(`${own}.`))
}
