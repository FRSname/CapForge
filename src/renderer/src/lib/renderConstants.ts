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
