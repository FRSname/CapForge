/**
 * Style preset library — ports BUILTIN_TEMPLATES and the vanilla preset schema
 * from renderer/js/app.js:1945-2013.
 *
 * Vanilla stored presets as a flat object of strings; we translate to/from
 * StudioSettings so saved .json preset files stay cross-compatible.
 */

import type { StudioSettings } from '../components/studio/StudioPanel'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'

// Vanilla preset shape — fields are strings/booleans as stored on disk.
export interface VanillaPreset {
  font?:            string
  fontSize?:        string | number
  bold?:            boolean
  tracking?:        string | number
  wordSpacing?:     string | number
  strokeWidth?:     string | number
  strokeColor?:     string
  textColor?:       string
  activeColor?:     string
  bgColor?:         string
  bgOpacity?:       string | number
  padH?:            string | number
  padV?:            string | number
  radius?:          string | number
  wpg?:             string | number
  lines?:           string | number
  posX?:            string | number
  posY?:            string | number
  bgWidthExtra?:    string | number
  bgHeightExtra?:   string | number
  textOffsetX?:     string | number
  textOffsetY?:     string | number
  textAlignH?:      string
  textAlignV?:      string
  wordTransition?:  string
  animation?:       string
  animDur?:         string | number
  resolution?:      string           // "1920x1080"
  fps?:             string | number
  format?:          string
  renderMode?:      string
  bitrate?:         string
  customFontPath?:  string
  shadowEnabled?:   boolean
}

const num = (v: string | number | undefined, fallback: number): number => {
  if (v == null) return fallback
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** Convert a vanilla-schema preset into a partial StudioSettings. */
export function vanillaToStudio(p: VanillaPreset): Partial<StudioSettings> {
  const out: Partial<StudioSettings> = {}

  if (p.font != null)           out.fontName      = p.font
  if (p.customFontPath != null) out.fontPath      = p.customFontPath
  if (p.fontSize != null)       out.fontSize      = num(p.fontSize,      STUDIO_DEFAULTS.fontSize)
  if (p.bold != null)           out.fontWeight    = p.bold ? 700 : 400
  if (p.tracking != null)       out.letterSpacing = num(p.tracking,      STUDIO_DEFAULTS.letterSpacing)

  if (p.strokeWidth != null)    out.outlineWidth  = num(p.strokeWidth,   STUDIO_DEFAULTS.outlineWidth)
  if (p.strokeColor != null)    out.outlineColor  = p.strokeColor
  if (p.textColor != null)      out.textColor     = p.textColor
  if (p.activeColor != null)    out.activeColor   = p.activeColor
  if (p.bgColor != null)        out.bgColor       = p.bgColor
  if (p.bgOpacity != null)      out.bgOpacity     = num(p.bgOpacity,     STUDIO_DEFAULTS.bgOpacity)
  if (p.radius != null)         out.bgRadius      = num(p.radius,        STUDIO_DEFAULTS.bgRadius)
  if (p.bgWidthExtra != null)   out.bgWidthExtra  = num(p.bgWidthExtra,  STUDIO_DEFAULTS.bgWidthExtra)
  if (p.bgHeightExtra != null)  out.bgHeightExtra = num(p.bgHeightExtra, STUDIO_DEFAULTS.bgHeightExtra)
  if (p.textOffsetX != null)    out.textOffsetX   = num(p.textOffsetX,   STUDIO_DEFAULTS.textOffsetX)
  if (p.textOffsetY != null)    out.textOffsetY   = num(p.textOffsetY,   STUDIO_DEFAULTS.textOffsetY)
  if (p.textAlignH === 'left' || p.textAlignH === 'center' || p.textAlignH === 'right') {
    out.textAlignH = p.textAlignH
  }
  if (p.textAlignV === 'top' || p.textAlignV === 'middle' || p.textAlignV === 'bottom') {
    out.textAlignV = p.textAlignV
  }

  if (p.wpg != null)            out.wordsPerGroup = num(p.wpg,           STUDIO_DEFAULTS.wordsPerGroup)
  if (p.lines != null)          out.lines         = num(p.lines,         STUDIO_DEFAULTS.lines)
  if (p.posX != null)           out.posX          = num(p.posX,          STUDIO_DEFAULTS.posX)
  if (p.posY != null)           out.posY          = num(p.posY,          STUDIO_DEFAULTS.posY)

  if (p.animation != null)      out.animationType = p.animation
  if (p.animDur != null)        out.animDuration  = num(p.animDur,       STUDIO_DEFAULTS.animDuration)
  if (p.wordTransition != null) out.wordStyle     = p.wordTransition

  if (typeof p.resolution === 'string' && /^\d+x\d+$/.test(p.resolution)) {
    const [w, h] = p.resolution.split('x').map(Number)
    out.resolution = [w, h]
    out.resolutionIsSource = false
  }
  if (p.fps != null)            out.fps        = num(p.fps, STUDIO_DEFAULTS.fps)
  if (p.format === 'webm' || p.format === 'mov' || p.format === 'mp4') {
    out.format = p.format
  }
  if (p.renderMode === 'overlay' || p.renderMode === 'baked') {
    out.renderMode = p.renderMode
  }
  if (p.bitrate != null)        out.bitrate    = String(p.bitrate)

  return out
}

/** Convert StudioSettings → vanilla preset shape (for savePreset()). */
export function studioToVanilla(s: StudioSettings): VanillaPreset {
  return {
    font:           s.fontName || 'Arial',
    customFontPath: s.fontPath || undefined,
    fontSize:       String(s.fontSize),
    bold:           s.fontWeight >= 700,
    tracking:       String(s.letterSpacing),
    strokeWidth:    String(s.outlineWidth),
    strokeColor:    s.outlineColor,
    textColor:      s.textColor,
    activeColor:    s.activeColor,
    bgColor:        s.bgColor,
    bgOpacity:      String(s.bgOpacity),
    radius:         String(s.bgRadius),
    wpg:            String(s.wordsPerGroup),
    lines:          String(s.lines),
    posX:           String(s.posX),
    posY:           String(s.posY),
    bgWidthExtra:   String(s.bgWidthExtra),
    bgHeightExtra:  String(s.bgHeightExtra),
    textOffsetX:    String(s.textOffsetX),
    textOffsetY:    String(s.textOffsetY),
    textAlignH:     s.textAlignH,
    textAlignV:     s.textAlignV,
    animation:      s.animationType,
    animDur:        String(s.animDuration),
    wordTransition: s.wordStyle,
    resolution:     `${s.resolution[0]}x${s.resolution[1]}`,
    fps:            String(s.fps),
    format:         s.format,
    renderMode:     s.renderMode,
    bitrate:        s.bitrate,
  }
}

export interface BuiltinPreset {
  name:     string
  settings: VanillaPreset
}

// Verbatim port of BUILTIN_TEMPLATES from app.js:1946-2013.
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    name: 'YouTube Bold',
    settings: {
      font: 'Arial', fontSize: '72', bold: true, tracking: '0', wordSpacing: '0',
      strokeWidth: '0', strokeColor: '#000000', textColor: '#FFFFFF', activeColor: '#FFD700',
      bgColor: '#000000', bgOpacity: '85', padH: '32', padV: '14', radius: '10',
      wpg: '4', lines: '1', posX: '50', posY: '88', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'instant', animation: 'none', animDur: '12',
    },
  },
  {
    name: 'TikTok Pop',
    settings: {
      font: 'Arial', fontSize: '80', bold: true, tracking: '2', wordSpacing: '2',
      strokeWidth: '3', strokeColor: '#000000', textColor: '#FFFFFF', activeColor: '#FF2D55',
      bgColor: '#000000', bgOpacity: '0', padH: '24', padV: '10', radius: '8',
      wpg: '3', lines: '1', posX: '50', posY: '82', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'bounce', animation: 'pop', animDur: '12',
    },
  },
  {
    name: 'Minimal White',
    settings: {
      font: 'Arial', fontSize: '56', bold: false, tracking: '1', wordSpacing: '0',
      strokeWidth: '0', strokeColor: '#000000', textColor: '#FFFFFF', activeColor: '#FFFFFF',
      bgColor: '#000000', bgOpacity: '0', padH: '16', padV: '8', radius: '6',
      wpg: '5', lines: '2', posX: '50', posY: '90', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'crossfade', animation: 'fade', animDur: '10',
    },
  },
  {
    name: 'Highlight Pill',
    settings: {
      font: 'Arial', fontSize: '64', bold: true, tracking: '0', wordSpacing: '0',
      strokeWidth: '0', strokeColor: '#000000', textColor: '#FFFFFF', activeColor: '#FFFFFF',
      bgColor: '#1A1A2E', bgOpacity: '90', padH: '36', padV: '16', radius: '20',
      wpg: '4', lines: '1', posX: '50', posY: '84', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'highlight', animation: 'slide', animDur: '12',
    },
  },
  {
    name: 'Karaoke Neon',
    settings: {
      font: 'Arial', fontSize: '68', bold: true, tracking: '1', wordSpacing: '2',
      strokeWidth: '2', strokeColor: '#7B2FFF', textColor: '#DDDDFF', activeColor: '#7B2FFF',
      bgColor: '#0A0010', bgOpacity: '88', padH: '40', padV: '18', radius: '14',
      wpg: '4', lines: '1', posX: '50', posY: '86', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'karaoke', animation: 'fade', animDur: '8',
    },
  },
  {
    name: 'Subtitles (Clean)',
    settings: {
      font: 'Arial', fontSize: '48', bold: false, tracking: '0', wordSpacing: '0',
      strokeWidth: '0', strokeColor: '#000000', textColor: '#FFFFFF', activeColor: '#FFD700',
      bgColor: '#000000', bgOpacity: '70', padH: '20', padV: '8', radius: '4',
      wpg: '6', lines: '2', posX: '50', posY: '92', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'instant', animation: 'none', animDur: '12',
    },
  },
  {
    name: 'Reveal Dark',
    settings: {
      font: 'Arial', fontSize: '64', bold: true, tracking: '0', wordSpacing: '0',
      strokeWidth: '0', strokeColor: '#000000', textColor: '#CCCCCC', activeColor: '#FFFFFF',
      bgColor: '#111111', bgOpacity: '92', padH: '32', padV: '14', radius: '12',
      wpg: '4', lines: '1', posX: '50', posY: '84', bgWidthExtra: '0', bgHeightExtra: '0',
      wordTransition: 'reveal', animation: 'fade', animDur: '10',
    },
  },
]

/**
 * Apply a vanilla-schema preset onto StudioSettings, keeping render settings
 * (resolution/fps/format/renderMode/bitrate) from the current session when the
 * preset doesn't specify them — so loading a styling preset doesn't clobber
 * the auto-detected source resolution.
 */
export function applyPreset(current: StudioSettings, preset: VanillaPreset): StudioSettings {
  const patch = vanillaToStudio(preset)
  return { ...current, ...patch }
}
