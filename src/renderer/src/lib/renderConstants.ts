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

/* ── RSVP ("speed reading") defaults ───────────────────────────────────────
 * The pivot column and the focus colour are MEASURED ground truth from the
 * reference clip (docs/plans/rsvp-speed-reading-mode.md → "Measurements taken
 * from the reference clip"): the orange focus glyph sits at 35% of the caption
 * band across all 156 sampled frames, in rgb(228,133,31). Do not re-derive or
 * "tidy" these two values.
 */

/** RSVP focus column, as a UI percentage of the caption band width (0–100). */
export const RSVP_DEFAULT_PIVOT_X = 35

/** RSVP focus-glyph colour — the one letter pinned to the pivot column. */
export const RSVP_DEFAULT_FOCUS_COLOR = '#E4851F'

/** Opacity of the non-active (context) words. 0–1 FRACTION, not a percentage. */
export const RSVP_DEFAULT_CONTEXT_OPACITY = 0.75

/** Line-slide duration in SECONDS (eased power1.out at each word boundary). */
export const RSVP_DEFAULT_SLIDE_DURATION = 0.06

/** Edge fade width, as a UI percentage of the caption band width (0–100). */
export const RSVP_DEFAULT_EDGE_FADE = 12
