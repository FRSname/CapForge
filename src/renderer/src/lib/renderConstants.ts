/**
 * Shared rendering constants — single source of truth for both the Canvas
 * preview (useSubtitleOverlay.ts) and the Python backend (video_render.py).
 *
 * The backend receives these values via the render config that render.ts
 * assembles, so it stays in sync automatically. Any magic number that appears
 * in both renderers belongs here.
 */

/** Default vertical padding inside the subtitle background box (px). */
export const DEFAULT_PAD_V = 8

/** Crossfade word-transition duration (seconds). */
export const CROSSFADE_DUR = 0.06

/** Default line-height multiplier (1.0 = no gap, 1.2 = 20% gap). */
export const DEFAULT_LINE_HEIGHT = 1.2

/** Gaps at or below this (seconds) are closed so captions don't flicker off
 *  between groups. 0 disables the pass. Travels to the backend as
 *  `gap_close_threshold`. */
export const DEFAULT_GAP_CLOSE_THRESHOLD = 0.25

/** The last group holds this long (seconds) past its own `end` — the group
 *  bound, which is not the same thing as its last word's end once the bound has
 *  been stretched — so the final caption doesn't vanish the instant speech
 *  stops. Travels as `last_group_hold`. NOT idempotent — apply once per
 *  pipeline. */
export const DEFAULT_LAST_GROUP_HOLD = 1.0
