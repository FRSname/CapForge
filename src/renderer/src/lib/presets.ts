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
// Presets are STYLE-ONLY: render/export settings (resolution/fps/format/
// renderMode/bitrate) are declared below purely so old JSON still parses,
// but they are never applied or written — applying a 9:16 preset must not
// silently repoint a 16:9 session's Custom Render config.
export interface VanillaPreset {
  font?: string
  fontSize?: string | number
  /** Legacy (vanilla-era) — still read (→ fontWeight) but no longer written.
   *  Render-inert: bold is a font-variant choice now, not a style flag. */
  bold?: boolean
  tracking?: string | number
  /** Legacy (vanilla-era) — no StudioSettings equivalent; parsed but ignored. */
  wordSpacing?: string | number
  strokeWidth?: string | number
  strokeColor?: string
  textColor?: string
  activeColor?: string
  bgColor?: string
  bgOpacity?: string | number
  /** Legacy (vanilla-era) — no StudioSettings equivalent; parsed but ignored. */
  padH?: string | number
  /** Legacy (vanilla-era) — no StudioSettings equivalent; parsed but ignored. */
  padV?: string | number
  radius?: string | number
  wpg?: string | number
  lines?: string | number
  posX?: string | number
  posY?: string | number
  marginH?: string | number
  marginV?: string | number
  maxWidth?: string | number
  lineHeight?: string | number
  captionStyle?: string
  bgWidthExtra?: string | number
  bgHeightExtra?: string | number
  textOffsetX?: string | number
  textOffsetY?: string | number
  textAlignH?: string
  textAlignV?: string
  wordTransition?: string
  animation?: string
  animDur?: string | number
  highlightRadius?: string | number
  highlightPadX?: string | number
  highlightPadY?: string | number
  highlightOpacity?: string | number
  highlightAnim?: string
  highlightTextColor?: string
  underlineThickness?: string | number
  underlineColor?: string
  underlineOffsetY?: string | number
  underlineWidth?: string | number
  bounceStrength?: string | number
  scaleFactor?: string | number
  shadowEnabled?: boolean
  shadowColor?: string
  shadowOpacity?: string | number
  shadowBlur?: string | number
  shadowOffsetX?: string | number
  shadowOffsetY?: string | number
  /** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */
  resolution?: string // "1920x1080"
  /** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */
  fps?: string | number
  /** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */
  format?: string
  /** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */
  renderMode?: string
  /** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */
  bitrate?: string
  customFontPath?: string
  /** Preview-only safe-zone guide ('off' | 'tiktok' | 'reels' | 'shorts'). */
  safeZone?: string
}

const num = (v: string | number | undefined, fallback: number): number => {
  if (v == null) return fallback
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** Convert a vanilla-schema preset into a partial StudioSettings. */
export function vanillaToStudio(p: VanillaPreset): Partial<StudioSettings> {
  const out: Partial<StudioSettings> = {}

  if (p.font != null) out.fontName = p.font
  if (p.customFontPath != null) out.fontPath = p.customFontPath
  if (p.fontSize != null) out.fontSize = num(p.fontSize, STUDIO_DEFAULTS.fontSize)
  if (p.bold != null) out.fontWeight = p.bold ? 700 : 400
  if (p.tracking != null) out.tracking = num(p.tracking, STUDIO_DEFAULTS.tracking)
  if (p.lineHeight != null) out.lineHeight = num(p.lineHeight, STUDIO_DEFAULTS.lineHeight)

  if (p.strokeWidth != null) out.outlineWidth = num(p.strokeWidth, STUDIO_DEFAULTS.outlineWidth)
  if (p.strokeColor != null) out.outlineColor = p.strokeColor
  if (p.textColor != null) out.textColor = p.textColor
  if (p.activeColor != null) out.activeColor = p.activeColor
  if (p.bgColor != null) out.bgColor = p.bgColor
  if (p.bgOpacity != null) out.bgOpacity = num(p.bgOpacity, STUDIO_DEFAULTS.bgOpacity)
  if (p.radius != null) out.bgRadius = num(p.radius, STUDIO_DEFAULTS.bgRadius)
  if (p.bgWidthExtra != null) out.bgWidthExtra = num(p.bgWidthExtra, STUDIO_DEFAULTS.bgWidthExtra)
  if (p.bgHeightExtra != null)
    out.bgHeightExtra = num(p.bgHeightExtra, STUDIO_DEFAULTS.bgHeightExtra)
  if (p.textOffsetX != null) out.textOffsetX = num(p.textOffsetX, STUDIO_DEFAULTS.textOffsetX)
  if (p.textOffsetY != null) out.textOffsetY = num(p.textOffsetY, STUDIO_DEFAULTS.textOffsetY)
  if (p.textAlignH === 'left' || p.textAlignH === 'center' || p.textAlignH === 'right') {
    out.textAlignH = p.textAlignH
  }
  if (p.textAlignV === 'top' || p.textAlignV === 'middle' || p.textAlignV === 'bottom') {
    out.textAlignV = p.textAlignV
  }

  if (p.wpg != null) out.wordsPerGroup = num(p.wpg, STUDIO_DEFAULTS.wordsPerGroup)
  if (p.lines != null) out.lines = num(p.lines, STUDIO_DEFAULTS.lines)
  if (p.posX != null) out.posX = num(p.posX, STUDIO_DEFAULTS.posX)
  if (p.posY != null) out.posY = num(p.posY, STUDIO_DEFAULTS.posY)
  if (p.marginH != null) out.marginH = num(p.marginH, STUDIO_DEFAULTS.marginH)
  if (p.marginV != null) out.marginV = num(p.marginV, STUDIO_DEFAULTS.marginV)
  if (p.maxWidth != null) out.maxWidth = num(p.maxWidth, STUDIO_DEFAULTS.maxWidth)
  if (p.captionStyle != null) out.captionStyle = p.captionStyle

  if (p.animation != null) out.animationType = p.animation
  if (p.animDur != null) out.animDuration = num(p.animDur, STUDIO_DEFAULTS.animDuration)
  if (p.wordTransition != null) out.wordStyle = p.wordTransition

  if (p.highlightRadius != null)
    out.highlightRadius = num(p.highlightRadius, STUDIO_DEFAULTS.highlightRadius)
  if (p.highlightPadX != null)
    out.highlightPadX = num(p.highlightPadX, STUDIO_DEFAULTS.highlightPadX)
  if (p.highlightPadY != null)
    out.highlightPadY = num(p.highlightPadY, STUDIO_DEFAULTS.highlightPadY)
  if (p.highlightOpacity != null)
    out.highlightOpacity = num(p.highlightOpacity, STUDIO_DEFAULTS.highlightOpacity)
  if (p.highlightAnim === 'jump' || p.highlightAnim === 'slide') {
    out.highlightAnim = p.highlightAnim
  }
  if (p.highlightTextColor != null) out.highlightTextColor = p.highlightTextColor
  if (p.underlineThickness != null)
    out.underlineThickness = num(p.underlineThickness, STUDIO_DEFAULTS.underlineThickness)
  if (p.underlineColor != null) out.underlineColor = p.underlineColor
  if (p.underlineOffsetY != null)
    out.underlineOffsetY = num(p.underlineOffsetY, STUDIO_DEFAULTS.underlineOffsetY)
  if (p.underlineWidth != null)
    out.underlineWidth = num(p.underlineWidth, STUDIO_DEFAULTS.underlineWidth)
  if (p.bounceStrength != null)
    out.bounceStrength = num(p.bounceStrength, STUDIO_DEFAULTS.bounceStrength)
  if (p.scaleFactor != null) out.scaleFactor = num(p.scaleFactor, STUDIO_DEFAULTS.scaleFactor)

  if (p.shadowEnabled != null) out.shadowEnabled = Boolean(p.shadowEnabled)
  if (p.shadowColor != null) out.shadowColor = p.shadowColor
  if (p.shadowOpacity != null)
    out.shadowOpacity = num(p.shadowOpacity, STUDIO_DEFAULTS.shadowOpacity)
  if (p.shadowBlur != null) out.shadowBlur = num(p.shadowBlur, STUDIO_DEFAULTS.shadowBlur)
  if (p.shadowOffsetX != null)
    out.shadowOffsetX = num(p.shadowOffsetX, STUDIO_DEFAULTS.shadowOffsetX)
  if (p.shadowOffsetY != null)
    out.shadowOffsetY = num(p.shadowOffsetY, STUDIO_DEFAULTS.shadowOffsetY)

  // Render/export keys (resolution/fps/format/renderMode/bitrate) are
  // deliberately NOT read — see the VanillaPreset doc comment.

  if (
    p.safeZone === 'off' ||
    p.safeZone === 'tiktok' ||
    p.safeZone === 'reels' ||
    p.safeZone === 'shorts'
  ) {
    out.safeZone = p.safeZone
  }

  return out
}

/**
 * Convert StudioSettings → vanilla preset shape (for savePreset()).
 * Style-only by design: render/export settings and legacy `bold` are never
 * written (bold = pick a bold font variant; there is no synthetic bold).
 */
export function studioToVanilla(s: StudioSettings): VanillaPreset {
  return {
    font: s.fontName || 'Arial',
    customFontPath: s.fontPath || undefined,
    fontSize: String(s.fontSize),
    tracking: String(s.tracking),
    lineHeight: String(s.lineHeight),
    strokeWidth: String(s.outlineWidth),
    strokeColor: s.outlineColor,
    textColor: s.textColor,
    activeColor: s.activeColor,
    bgColor: s.bgColor,
    bgOpacity: String(s.bgOpacity),
    radius: String(s.bgRadius),
    wpg: String(s.wordsPerGroup),
    lines: String(s.lines),
    posX: String(s.posX),
    posY: String(s.posY),
    marginH: String(s.marginH),
    marginV: String(s.marginV),
    maxWidth: String(s.maxWidth),
    captionStyle: s.captionStyle,
    bgWidthExtra: String(s.bgWidthExtra),
    bgHeightExtra: String(s.bgHeightExtra),
    textOffsetX: String(s.textOffsetX),
    textOffsetY: String(s.textOffsetY),
    textAlignH: s.textAlignH,
    textAlignV: s.textAlignV,
    animation: s.animationType,
    animDur: String(s.animDuration),
    wordTransition: s.wordStyle,
    highlightRadius: String(s.highlightRadius),
    highlightPadX: String(s.highlightPadX),
    highlightPadY: String(s.highlightPadY),
    highlightOpacity: String(s.highlightOpacity),
    highlightAnim: s.highlightAnim,
    highlightTextColor: s.highlightTextColor,
    underlineThickness: String(s.underlineThickness),
    underlineColor: s.underlineColor,
    underlineOffsetY: String(s.underlineOffsetY),
    underlineWidth: String(s.underlineWidth),
    bounceStrength: String(s.bounceStrength),
    scaleFactor: String(s.scaleFactor),
    shadowEnabled: s.shadowEnabled,
    shadowColor: s.shadowColor,
    shadowOpacity: String(s.shadowOpacity),
    shadowBlur: String(s.shadowBlur),
    shadowOffsetX: String(s.shadowOffsetX),
    shadowOffsetY: String(s.shadowOffsetY),
    safeZone: s.safeZone,
  }
}

export interface BuiltinPreset {
  name: string
  settings: VanillaPreset
}

// Ported from vanilla BUILTIN_TEMPLATES (app.js:1946-2013), then pruned of
// legacy keys the converters no longer map (bold/wordSpacing/padH/padV) —
// every key below must be one vanillaToStudio() consumes (pinned by test).
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    name: 'YouTube Bold',
    settings: {
      font: 'Arial',
      fontSize: '72',      tracking: '0',      strokeWidth: '0',
      strokeColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#FFD700',
      bgColor: '#000000',
      bgOpacity: '85',      radius: '10',
      wpg: '4',
      lines: '1',
      posX: '50',
      posY: '88',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'instant',
      animation: 'none',
      animDur: '12',
    },
  },
  {
    name: 'TikTok Pop',
    settings: {
      font: 'Arial',
      fontSize: '80',      tracking: '2',      strokeWidth: '3',
      strokeColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#FF2D55',
      bgColor: '#000000',
      bgOpacity: '0',      radius: '8',
      wpg: '3',
      lines: '1',
      posX: '50',
      posY: '82',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'bounce',
      animation: 'pop',
      animDur: '12',
    },
  },
  {
    name: 'Minimal White',
    settings: {
      font: 'Arial',
      fontSize: '56',      tracking: '1',      strokeWidth: '0',
      strokeColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#FFFFFF',
      bgColor: '#000000',
      bgOpacity: '0',      radius: '6',
      wpg: '5',
      lines: '2',
      posX: '50',
      posY: '90',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'crossfade',
      animation: 'fade',
      animDur: '10',
    },
  },
  {
    name: 'Highlight Pill',
    settings: {
      font: 'Arial',
      fontSize: '64',      tracking: '0',      strokeWidth: '0',
      strokeColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#FFFFFF',
      bgColor: '#1A1A2E',
      bgOpacity: '90',      radius: '20',
      wpg: '4',
      lines: '1',
      posX: '50',
      posY: '84',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'highlight',
      highlightRadius: '20',
      highlightPadX: '20',
      highlightPadY: '10',
      highlightOpacity: '0.9',
      animation: 'slide',
      animDur: '12',
    },
  },
  {
    name: 'Karaoke Neon',
    settings: {
      font: 'Arial',
      fontSize: '68',      tracking: '1',      strokeWidth: '2',
      strokeColor: '#7B2FFF',
      textColor: '#DDDDFF',
      activeColor: '#7B2FFF',
      bgColor: '#0A0010',
      bgOpacity: '88',      radius: '14',
      wpg: '4',
      lines: '1',
      posX: '50',
      posY: '86',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'karaoke',
      animation: 'fade',
      animDur: '8',
    },
  },
  {
    name: 'Subtitles (Clean)',
    settings: {
      font: 'Arial',
      fontSize: '48',      tracking: '0',      strokeWidth: '0',
      strokeColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#FFD700',
      bgColor: '#000000',
      bgOpacity: '70',      radius: '4',
      wpg: '6',
      lines: '2',
      posX: '50',
      posY: '92',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'instant',
      animation: 'none',
      animDur: '12',
    },
  },
  {
    name: 'Reveal Dark',
    settings: {
      font: 'Arial',
      fontSize: '64',      tracking: '0',      strokeWidth: '0',
      strokeColor: '#000000',
      textColor: '#CCCCCC',
      activeColor: '#FFFFFF',
      bgColor: '#111111',
      bgOpacity: '92',      radius: '12',
      wpg: '4',
      lines: '1',
      posX: '50',
      posY: '84',
      bgWidthExtra: '0',
      bgHeightExtra: '0',
      wordTransition: 'reveal',
      animation: 'fade',
      animDur: '10',
    },
  },
]

/**
 * Apply a vanilla-schema preset onto StudioSettings. Presets are style-only:
 * render settings (resolution/fps/format/renderMode/bitrate) are ALWAYS kept
 * from the current session — even when a legacy preset carries them — so
 * loading a preset never clobbers the auto-detected source resolution.
 * Style keys the preset doesn't specify are also left untouched (sparse apply).
 */
export function applyPreset(current: StudioSettings, preset: VanillaPreset): StudioSettings {
  const patch = vanillaToStudio(preset)
  return { ...current, ...patch }
}
