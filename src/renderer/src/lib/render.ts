/**
 * Build the backend render config from React StudioSettings + current groups.
 * Ports the config assembly in renderSubtitleVideo() from app.js:3644-3720.
 *
 * The Python backend expects snake_case keys — this module is the one and only
 * place where the casing bridge happens.
 */

import type { Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import { DEFAULT_PAD_V } from './renderConstants'

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
  format?:     'webm' | 'mov' | 'mp4'
  /** Quick-render flag — forces resolution. */
  resolution?: [number, number]
  /** Quick-render flag — forces frame rate. */
  fps?:        number
  /** Quick-render flag — forces bitrate (e.g. "40M"). */
  bitrate?:    string
}

export interface RenderBody {
  config:        Record<string, unknown>
  output_dir?:   string
  custom_groups?: Array<{
    text:  string
    start: number
    end:   number
    words: Array<Record<string, unknown>>
  }>
}

/**
 * @param settings      Current studio settings (typography, colors, layout, animation).
 * @param groups        Current display groups — sent as `custom_groups` only if `groupsEdited` is true.
 * @param groupsEdited  True once the user has manually merged/split/reordered groups.
 * @param overrides     Quick-render toggles (renderMode/format/resolution).
 * @param outputDir     Directory the backend should write the rendered file to.
 */
export function buildRenderBody(
  settings:    StudioSettings,
  groups:      Segment[],
  groupsEdited: boolean,
  overrides:   RenderOverrides = {},
  outputDir?:  string,
): RenderBody {
  const renderMode = overrides.renderMode ?? settings.renderMode
  const [resW, resH] = overrides.resolution ?? settings.resolution
  const fps = overrides.fps ?? settings.fps
  const bitrate = overrides.bitrate ?? settings.bitrate
  // Baked quick-render defaults to MP4; overlay defaults to whatever the user picked.
  const format = overrides.format ?? (renderMode === 'baked' ? 'mp4' : settings.format)

  const config: Record<string, unknown> = {
    font_family:        settings.fontName,
    custom_font_path:   settings.fontPath || null,
    font_size:          settings.fontSize,
    // Match the preview's threshold (useSubtitleOverlay.ts) so the render
    // doesn't go bold at semi-bold weights when the preview shows them as
    // regular. Keep both at 700 — i.e. only "bold" or heavier triggers PIL bold.
    bold:               settings.fontWeight >= 700,
    tracking:           settings.tracking ?? 0,
    word_spacing:       0,

    stroke_width:       settings.outlineWidth,
    stroke_color:       settings.outlineColor,

    text_color:         settings.textColor,
    active_word_color:  settings.activeColor,

    bg_color:           settings.bgColor,
    bg_opacity:         settings.bgOpacity / 100,
    bg_padding_h:       settings.marginH,
    bg_padding_v:       settings.marginV ?? DEFAULT_PAD_V,
    bg_corner_radius:   settings.bgRadius,
    bg_width_extra:     settings.bgWidthExtra,
    bg_height_extra:    settings.bgHeightExtra,

    text_offset_x:      settings.textOffsetX,
    text_offset_y:      settings.textOffsetY,
    text_align_h:       settings.textAlignH,
    text_align_v:       settings.textAlignV,

    words_per_group:    settings.wordsPerGroup,
    lines:              settings.lines,
    max_width:          settings.maxWidth / 100,
    line_height:        settings.lineHeight,

    position_x:         settings.posX / 100,
    position_y:         settings.posY / 100,

    resolution_w:       resW,
    resolution_h:       resH,
    fps:                fps,

    output_format:      format,
    render_mode:        renderMode,
    video_bitrate:      bitrate,

    animation:          settings.animationType,
    animation_duration: settings.animDuration / 100,
    word_transition:    settings.wordStyle,

    // Per-effect options
    highlight_radius:     settings.highlightRadius,
    highlight_padding_x:  settings.highlightPadX,
    highlight_padding_y:  settings.highlightPadY,
    highlight_opacity:    settings.highlightOpacity,
    highlight_animation:  settings.highlightAnim,
    highlight_text_color: settings.highlightTextColor ?? '',
    underline_thickness:  settings.underlineThickness,
    underline_color:      settings.underlineColor,
    underline_offset_y:   settings.underlineOffsetY ?? 2,
    underline_width:      settings.underlineWidth ?? 0,
    bounce_strength:      settings.bounceStrength,
    scale_factor:         settings.scaleFactor,

    // Drop shadow
    shadow_enabled:   settings.shadowEnabled,
    shadow_color:     settings.shadowColor,
    shadow_opacity:   settings.shadowOpacity,
    shadow_blur:      settings.shadowBlur,
    shadow_offset_x:  settings.shadowOffsetX,
    shadow_offset_y:  settings.shadowOffsetY,
  }

  const body: RenderBody = { config }
  if (outputDir) body.output_dir = outputDir

  // Only send custom_groups if the user edited them manually. Otherwise the
  // backend re-chunks from the stored transcription, which is cheaper and
  // guarantees timing integrity.
  if (groupsEdited && groups.length > 0) {
    body.custom_groups = groups.map(g => ({
      text:  g.text,
      start: g.start,
      end:   g.end,
      // Pass words through as-is so per-word `overrides` (text_color, bold,
      // font_family, word_transition, etc.) reach the backend verbatim.
      words: g.words.map(w => ({ ...w })),
    }))
  }

  return body
}
