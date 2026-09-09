/**
 * Build the backend render config from React StudioSettings + current groups.
 * Ports the config assembly in renderSubtitleVideo() from app.js:3644-3720.
 *
 * The Python backend expects snake_case keys — this module is the one and only
 * place where the casing bridge happens.
 */

import type { Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { DEFAULT_PAD_V, CROSSFADE_DUR } from './renderConstants'

/**
 * Convert a 0–100 UI percentage to the 0–1 fraction the backend expects.
 *
 * The guard is load-bearing, not defensive noise. A project saved by an older
 * build lacks fields added since, and `undefined / 100` is `NaN`, which
 * `JSON.stringify` serializes as `null` — which Pydantic rejects on a
 * non-Optional float, surfacing as an opaque HTTP 422 "Unprocessable Entity"
 * at render time. A plain missing field is harmless by comparison (JSON omits
 * it, so the backend default applies); only arithmetic turns it fatal.
 */
function pct(value: number | undefined, fallback: number): number {
  return (Number.isFinite(value) ? (value as number) : fallback) / 100
}

/** Cross-platform dirname — strips the last path segment (handles \ and /). */
export function dirname(filePath: string): string {
  if (!filePath) return ''
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return i >= 0 ? filePath.slice(0, i) : filePath
}

export interface RenderOverrides {
  /** Quick-render flag — forces "baked" mode regardless of current settings. */
  renderMode?: 'overlay' | 'baked'
  /** Quick-render flag — forces the output container/codec. */
  format?: 'webm' | 'mov' | 'mp4'
  /** Quick-render flag — forces resolution. */
  resolution?: [number, number]
  /** Quick-render flag — forces frame rate. */
  fps?: number
  /** Quick-render flag — forces bitrate (e.g. "40M"). */
  bitrate?: string
}

export interface RenderBody {
  config: Record<string, unknown>
  output_dir?: string
  /** Filename suffix for the rendered/exported file — `".pl"` gives
   *  `video.pl.mp4`. Lives on the *request* body, never on `VideoRenderConfig`:
   *  which caption track this is is not a style, and adding it to the config
   *  would drag in the seven-file settings pipeline and
   *  `test_caption_cfg_contract.py`. Omitted entirely when empty, so a
   *  single-track project sends exactly the body it always did. */
  output_name_suffix?: string
  custom_groups?: Array<{
    /** Renderer-side group id, so an agent can address a group it read from the
     *  mirror. The backend's `CustomGroup` ignores unknown keys. */
    id: string
    text: string
    start: number
    end: number
    words: Array<Record<string, unknown>>
    /** Per-group position override (0–1 fractions) — omitted when the group
     *  follows the global position. */
    position_x?: number
    position_y?: number
  }>
}

/**
 * @param settings      Current studio settings (typography, colors, layout, animation).
 * @param groups        Current display groups — sent as `custom_groups` when `groupsEdited` is
 *                      true or any drawable group has a `positionOverride`. Word-less groups (a
 *                      caption track's untranslated placeholders) are dropped from the payload;
 *                      if that empties the list the key is still sent, as `[]`, so the backend
 *                      never falls back to re-chunking the source transcript. Only a caller that
 *                      passes no groups at all gets no key.
 * @param groupsEdited  True once the user has manually merged/split/reordered groups. Always true
 *                      on a translated caption track.
 * @param overrides     Quick-render toggles (renderMode/format/resolution).
 * @param outputDir     Directory the backend should write the rendered file to.
 * @param nameSuffix    Filename suffix for a non-source caption track (`".pl"`).
 *                      Empty (the default, and always so on the source track)
 *                      emits no key at all.
 */
export function buildRenderBody(
  settings: StudioSettings,
  groups: Segment[],
  groupsEdited: boolean,
  overrides: RenderOverrides = {},
  outputDir?: string,
  nameSuffix = ''
): RenderBody {
  const renderMode = overrides.renderMode ?? settings.renderMode
  // Destructure defensively: an older project may have no `resolution` at all,
  // and destructuring `undefined` throws before the request is ever sent.
  const [resW, resH] = overrides.resolution ?? settings.resolution ?? STUDIO_DEFAULTS.resolution
  const fps = overrides.fps ?? settings.fps
  const bitrate = overrides.bitrate ?? settings.bitrate
  // Baked quick-render defaults to MP4; overlay defaults to whatever the user picked.
  const format = overrides.format ?? (renderMode === 'baked' ? 'mp4' : settings.format)

  const config: Record<string, unknown> = {
    font_family: settings.fontName,
    custom_font_path: settings.fontPath || null,
    font_size: settings.fontSize,
    // Bold is no longer a separate toggle — the user picks the font variant
    // (e.g. "Inter Bold") directly. The renderer always loads the chosen
    // font file as-is so what you select is what you get.
    bold: false,
    tracking: settings.tracking ?? 0,
    word_spacing: 0,

    stroke_width: settings.outlineWidth,
    stroke_color: settings.outlineColor,

    text_color: settings.textColor,
    active_word_color: settings.activeColor,

    bg_color: settings.bgColor,
    bg_opacity: pct(settings.bgOpacity, STUDIO_DEFAULTS.bgOpacity),
    bg_padding_h: settings.marginH,
    bg_padding_v: settings.marginV ?? DEFAULT_PAD_V,
    bg_corner_radius: settings.bgRadius,
    bg_width_extra: settings.bgWidthExtra,
    bg_height_extra: settings.bgHeightExtra,

    text_offset_x: settings.textOffsetX,
    text_offset_y: settings.textOffsetY,
    text_align_h: settings.textAlignH,
    text_align_v: settings.textAlignV,

    words_per_group: settings.wordsPerGroup,
    // Plain seconds — deliberately NOT run through pct(). These are the only
    // time-valued settings in StudioSettings and they carry the same unit on
    // both sides of the bridge.
    gap_close_threshold: settings.gapCloseThreshold,
    last_group_hold: settings.lastGroupHold,
    caption_style: settings.captionStyle ?? 'classic',
    lines: settings.lines,
    max_width: pct(settings.maxWidth, STUDIO_DEFAULTS.maxWidth),
    line_height: settings.lineHeight,

    position_x: pct(settings.posX, STUDIO_DEFAULTS.posX),
    position_y: pct(settings.posY, STUDIO_DEFAULTS.posY),

    resolution_w: resW,
    resolution_h: resH,
    fps: fps,

    output_format: format,
    render_mode: renderMode,
    video_bitrate: bitrate,

    animation: settings.animationType,
    animation_duration: pct(settings.animDuration, STUDIO_DEFAULTS.animDuration),
    word_transition: settings.wordStyle,
    // Pinned crossfade ramp, shared with the HTML caption renderer (HyperFrames)
    // so the three renderers don't drift. Canvas/Pillow read CROSSFADE_DUR directly.
    crossfade_duration: CROSSFADE_DUR,

    // RSVP reading mode — a layout axis, NOT a word_transition value.
    reading_mode: settings.readingMode ?? STUDIO_DEFAULTS.readingMode,
    rsvp_pivot_x: pct(settings.rsvpPivotX, STUDIO_DEFAULTS.rsvpPivotX),
    rsvp_focus_color: settings.rsvpFocusColor ?? STUDIO_DEFAULTS.rsvpFocusColor,
    // Already a 0–1 fraction on both sides of the bridge (like shadow_opacity)
    // — running it through pct() would send 0.0075.
    rsvp_context_opacity: settings.rsvpContextOpacity,
    // Plain seconds — deliberately NOT run through pct(), same unit contract as
    // gap_close_threshold / last_group_hold above.
    rsvp_slide_duration: settings.rsvpSlideDuration,
    rsvp_edge_fade: pct(settings.rsvpEdgeFade, STUDIO_DEFAULTS.rsvpEdgeFade),
    rsvp_reticle: settings.rsvpReticle,

    // Per-effect options
    highlight_radius: settings.highlightRadius,
    highlight_padding_x: settings.highlightPadX,
    highlight_padding_y: settings.highlightPadY,
    highlight_opacity: settings.highlightOpacity,
    highlight_animation: settings.highlightAnim,
    highlight_text_color: settings.highlightTextColor ?? '',
    highlight_offset_x: settings.highlightOffsetX ?? 0,
    highlight_offset_y: settings.highlightOffsetY ?? 0,
    underline_thickness: settings.underlineThickness,
    underline_color: settings.underlineColor,
    underline_offset_y: settings.underlineOffsetY ?? 2,
    underline_width: settings.underlineWidth ?? 0,
    bounce_strength: settings.bounceStrength,
    scale_factor: settings.scaleFactor,

    // Drop shadow
    shadow_enabled: settings.shadowEnabled,
    shadow_color: settings.shadowColor,
    shadow_opacity: settings.shadowOpacity,
    shadow_blur: settings.shadowBlur,
    shadow_offset_x: settings.shadowOffsetX,
    shadow_offset_y: settings.shadowOffsetY,
  }

  const body: RenderBody = { config }
  if (outputDir) body.output_dir = outputDir
  if (nameSuffix) body.output_name_suffix = nameSuffix

  // A word-less group is a translated track's untranslated placeholder: it holds
  // a span and the source words behind it, but there is nothing to draw. No
  // renderer may see one (they all read `words`), so drop them here — the one
  // place every render path funnels through.
  const drawable = groups.filter((g) => g.words.length > 0)

  // Only send custom_groups if the user edited them manually OR any group
  // carries a position override (which lives on the group, so the backend
  // must receive the groups verbatim). Otherwise the backend re-chunks from
  // the stored transcription, which is cheaper and guarantees timing integrity.
  //
  // The gate is `groups`, NOT `drawable`: when the caller has groups but every
  // one of them was just filtered out as word-less (a translated track that is
  // still all placeholders), an absent `custom_groups` would send the backend
  // down that same re-chunking path and render the **source** captions. An
  // explicit `[]` says "draw nothing" instead. A caller with no groups at all
  // keeps the historical fallback.
  const hasGroupOverrides = drawable.some((g) => g.positionOverride)
  if ((groupsEdited || hasGroupOverrides) && groups.length > 0) {
    body.custom_groups = drawable.map((g) => ({
      // Renderer-side identity, so an agent's `set_track_text` and a rendered
      // group refer to the same thing. Unlike `wid` this is not per-word
      // bookkeeping — it is the address the mirror publishes.
      id: g.id,
      text: g.text,
      start: g.start,
      end: g.end,
      // Pass words through as-is so per-word `overrides` (text_color, bold,
      // font_family, word_transition, etc.) reach the backend verbatim. `wid` is
      // renderer-only bookkeeping (lib/wordIds.ts) — CustomGroup.words is an
      // untyped dict list, so it would otherwise ride all the way into the
      // HyperFrames caption payload for nothing.
      words: g.words.map(({ wid: _wid, ...w }) => w),
      // Sparse per-group position override — 0–1 fractions, same units as
      // config.position_x/position_y
      ...(g.positionOverride?.position_x != null && { position_x: g.positionOverride.position_x }),
      ...(g.positionOverride?.position_y != null && { position_y: g.positionOverride.position_y }),
    }))
  }

  return body
}
