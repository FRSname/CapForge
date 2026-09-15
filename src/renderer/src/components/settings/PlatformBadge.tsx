/**
 * The small platform monogram drawn beside a channel (YT, TT, IG, in, X).
 * There are no brand icon assets in the app; the full label rides `title` and
 * is always printed next to it, so the monogram is decoration.
 */

import type { Platform } from '../../lib/channelTypes'
import { platformGlyph } from '../../lib/channels'

interface PlatformBadgeProps {
  platform: Platform
  label: string
}

export function PlatformBadge({ platform, label }: PlatformBadgeProps) {
  return (
    <span
      aria-hidden="true"
      title={label}
      className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-2xs"
      style={{
        fontFamily: 'var(--cf-font-mono)',
        color: 'var(--color-text-2)',
        background: 'var(--color-surface-3)',
      }}
    >
      {platformGlyph(platform)}
    </span>
  )
}
