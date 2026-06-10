/**
 * Safe-zone specs for short-form video platforms.
 *
 * Each zone marks where platform UI chrome (action bars, icon rails, captions,
 * progress UI) typically overlaps the video frame. Values are FRACTIONS of the
 * frame so they scale with any resolution/aspect ratio.
 *
 * NOTE: These are practical approximations of platform UI chrome distilled
 * from published creator safe-area templates — not official specs. Platforms
 * shift their UI between app versions; treat the boundary as guidance.
 *
 * Preview-only: these guides are drawn in a separate overlay layer and never
 * reach the render config or the backend.
 */

export type SafeZonePlatform = 'off' | 'tiktok' | 'reels' | 'shorts'

export interface SafeZoneSpec {
  /** Human-readable platform name for UI labels. */
  label:  string
  /** Fraction of frame height obscured at the top (username, search, tabs). */
  top:    number
  /** Fraction of frame height obscured at the bottom (caption, action bar). */
  bottom: number
  /** Fraction of frame width obscured on the right (like/comment/share rail). */
  right:  number
}

export const SAFE_ZONES: Record<Exclude<SafeZonePlatform, 'off'>, SafeZoneSpec> = {
  tiktok: { label: 'TikTok', top: 0.10, bottom: 0.25, right: 0.125 },
  reels:  { label: 'Reels',  top: 0.08, bottom: 0.22, right: 0.12  },
  shorts: { label: 'Shorts', top: 0.08, bottom: 0.20, right: 0.10  },
}
