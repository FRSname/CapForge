/**
 * Copy for platform — the words around the footer's package button.
 *
 * The text itself is rendered by the backend (`backend/library/platform_posts.py`)
 * and every length/hashtag rule is judged there; this module only names the
 * platforms, labels the button and phrases the toast after a copy.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { PublishPlatform, Violation } from './publishTypes'

/** The footer's select order: the upload package first, then the posts. */
export const PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  'youtube',
  'linkedin',
  'x',
  'instagram',
]

/** The platform the footer starts on each session. */
export const DEFAULT_PUBLISH_PLATFORM: PublishPlatform = 'youtube'

const PLATFORM_LABELS: { readonly [P in PublishPlatform]: string } = {
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
}

/** The prefix the backend files a platform post's own findings under. */
const PACKAGE_FIELD_PREFIX = 'package.'

export function isPublishPlatform(value: string): value is PublishPlatform {
  return (PUBLISH_PLATFORMS as readonly string[]).includes(value)
}

export function platformLabel(platform: PublishPlatform): string {
  return PLATFORM_LABELS[platform]
}

export function copyButtonText(platform: PublishPlatform): string {
  return platform === 'youtube' ? 'Copy upload package' : `Copy for ${platformLabel(platform)}`
}

export function copyButtonTitle(platform: PublishPlatform): string {
  return platform === 'youtube'
    ? 'The whole YouTube Studio paste, rendered from this record and your brief'
    : `A ${platformLabel(platform)} post from this record and your brief — clipboard text only, nothing is posted`
}

/** What the success toast says was copied; `languageLabel` is null for the source. */
export function copiedWhat(platform: PublishPlatform, languageLabel: string | null): string {
  const language = languageLabel ? `${languageLabel} ` : ''
  return platform === 'youtube'
    ? `the ${language}upload package`
    : `the ${language}${platformLabel(platform)} post`
}

export interface PackageToast {
  message: string
  type: 'success' | 'info'
}

/**
 * The one toast after a package copy. A hard finding means the text will not
 * paste as-is, so the count and the first message are shown; the platform's
 * own finding (`package.<platform>`) leads, ahead of the record's. Style
 * findings alone are still a clean copy — they are drawn under the fields.
 */
export function packageCopiedToast(
  platform: PublishPlatform,
  violations: readonly Violation[],
  what: string
): PackageToast {
  const hard = violations.filter((v) => v.severity === 'hard')
  if (hard.length === 0) return { message: `Copied ${what}`, type: 'success' }
  const ownField = `${PACKAGE_FIELD_PREFIX}${platform}`
  const first = hard.find((v) => v.field === ownField) ?? hard[0]
  const issues = hard.length === 1 ? '1 issue' : `${hard.length} issues`
  return { message: `Copied — ${issues}: ${first.message}`, type: 'info' }
}
