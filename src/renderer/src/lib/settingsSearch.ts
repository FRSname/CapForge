/**
 * Settings search + card→keys registry for StudioPanel.
 *
 * Single source of truth shared by:
 * - the settings search input (filterSettings → which cards/rows to show)
 * - per-card dirty indicators & section reset (CARD_SETTINGS + countCardDirty)
 *
 * Deliberately excluded from CARD_SETTINGS:
 * - resolution / fps / format / renderMode / bitrate / resolutionIsSource —
 *   render-output settings; they live in CustomRenderPanel, not a style card.
 * - safeZone — preview-only guide toggle (never rendered to video); resetting
 *   "Layout" should not silently switch the user's preview guides off. It IS
 *   searchable (see registry entry).
 * - fontWeight / lineHeight — no UI row in StudioPanel (lineHeight is set via
 *   presets; fontWeight only via a legacy vanilla preset's `bold` flag);
 *   counting them would show "n changed" with no visible row explaining it.
 * - fontPath — changes in lockstep with fontName; it is reset with Typography
 *   but not counted (one font pick should read as one change, not two).
 */

import type { StudioSettings } from '../components/studio/StudioPanel'

export type CardId = 'typography' | 'colors' | 'layout' | 'background' | 'animation'

export const CARD_TITLES: Record<CardId, string> = {
  typography: 'Typography',
  colors: 'Colors',
  layout: 'Layout',
  background: 'Background',
  animation: 'Animation',
}

/** Keys reset by each card's "reset section" button. */
export const CARD_SETTINGS: Record<CardId, Array<keyof StudioSettings>> = {
  typography: ['fontName', 'fontPath', 'fontSize', 'tracking'],
  colors: [
    'textColor',
    'outlineColor',
    'bgColor',
    'activeColor',
    'outlineWidth',
    'shadowEnabled',
    'shadowColor',
    'shadowOpacity',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
  ],
  layout: ['wordsPerGroup', 'lines', 'posX', 'posY', 'maxWidth'],
  background: [
    'bgOpacity',
    'bgRadius',
    'bgWidthExtra',
    'bgHeightExtra',
    'marginH',
    'marginV',
    'textAlignH',
    'textAlignV',
    'textOffsetX',
    'textOffsetY',
  ],
  animation: [
    'animationType',
    'animDuration',
    'wordStyle',
    'highlightTextColor',
    'highlightRadius',
    'highlightPadX',
    'highlightPadY',
    'highlightOpacity',
    'highlightAnim',
    'highlightOffsetX',
    'highlightOffsetY',
    'underlineThickness',
    'underlineColor',
    'underlineOffsetY',
    'underlineWidth',
    'bounceStrength',
    'scaleFactor',
  ],
}

/** Keys reset with their card but not counted toward "n changed". */
const UNCOUNTED_KEYS = new Set<keyof StudioSettings>(['fontPath'])

/** Same tolerance StudioRow uses for its per-row dirty accent. */
const NUMBER_TOLERANCE = 0.001

function isDirtyValue(value: unknown, def: unknown): boolean {
  if (typeof value === 'number' && typeof def === 'number') {
    return Math.abs(value - def) > NUMBER_TOLERANCE
  }
  return value !== def
}

/** Count how many of a card's settings differ from defaults. */
export function countCardDirty(
  settings: StudioSettings,
  defaults: StudioSettings,
  cardId: CardId
): number {
  let n = 0
  for (const key of CARD_SETTINGS[cardId]) {
    if (UNCOUNTED_KEYS.has(key)) continue
    if (isDirtyValue(settings[key], defaults[key])) n += 1
  }
  return n
}

// ── Search registry ─────────────────────────────────────────────

export interface SettingsRegistryEntry {
  /** Exact row label as rendered in StudioPanel (Row wrapper key). */
  label: string
  cardId: CardId
  keywords: string[]
}

export const SETTINGS_REGISTRY: SettingsRegistryEntry[] = [
  // Typography
  { label: 'Font', cardId: 'typography', keywords: ['typeface', 'family', 'upload'] },
  { label: 'Size', cardId: 'typography', keywords: ['font size', 'text size'] },
  { label: 'Tracking', cardId: 'typography', keywords: ['letter spacing', 'spacing', 'kerning'] },
  // Colors
  { label: 'Text', cardId: 'colors', keywords: ['color', 'text color', 'fill'] },
  { label: 'Outline', cardId: 'colors', keywords: ['color', 'stroke', 'border'] },
  { label: 'BG', cardId: 'colors', keywords: ['background', 'color', 'bg color'] },
  { label: 'Active', cardId: 'colors', keywords: ['color', 'highlight color', 'active word'] },
  { label: 'Outline W', cardId: 'colors', keywords: ['outline width', 'stroke width', 'border'] },
  {
    label: 'Shadow',
    cardId: 'colors',
    keywords: ['drop shadow', 'shadow color', 'blur', 'glow'],
  },
  { label: 'Opacity', cardId: 'colors', keywords: ['shadow opacity', 'transparency', 'alpha'] },
  { label: 'Blur', cardId: 'colors', keywords: ['shadow blur', 'soft', 'shadow'] },
  { label: 'Offset X', cardId: 'colors', keywords: ['shadow offset', 'shadow position'] },
  { label: 'Offset Y', cardId: 'colors', keywords: ['shadow offset', 'shadow position'] },
  // Layout
  { label: 'Words/Grp', cardId: 'layout', keywords: ['words per group', 'group', 'chunk'] },
  { label: 'Lines', cardId: 'layout', keywords: ['rows', 'line count', 'multiline'] },
  { label: 'X Pos', cardId: 'layout', keywords: ['position', 'horizontal'] },
  { label: 'Y Pos', cardId: 'layout', keywords: ['position', 'vertical'] },
  { label: 'Max width', cardId: 'layout', keywords: ['width', 'wrap', 'word wrap'] },
  {
    label: 'Safe zones',
    cardId: 'layout',
    keywords: ['tiktok', 'reels', 'shorts', 'guides', 'preview'],
  },
  // Background
  {
    label: 'BG opacity',
    cardId: 'background',
    keywords: ['background opacity', 'transparency', 'alpha'],
  },
  { label: 'BG radius', cardId: 'background', keywords: ['rounded', 'corner', 'border radius'] },
  { label: 'BG width +', cardId: 'background', keywords: ['background width', 'padding', 'box'] },
  { label: 'BG height +', cardId: 'background', keywords: ['background height', 'padding', 'box'] },
  { label: 'Margin H', cardId: 'background', keywords: ['margin', 'horizontal padding'] },
  { label: 'Margin V', cardId: 'background', keywords: ['margin', 'vertical padding'] },
  {
    label: 'Align H',
    cardId: 'background',
    keywords: ['alignment', 'text align', 'left', 'center', 'right'],
  },
  {
    label: 'Align V',
    cardId: 'background',
    keywords: ['alignment', 'vertical align', 'top', 'middle', 'bottom'],
  },
  { label: 'Offset X', cardId: 'background', keywords: ['text offset', 'nudge'] },
  { label: 'Offset Y', cardId: 'background', keywords: ['text offset', 'nudge'] },
  // Animation
  {
    label: 'Entry/Exit',
    cardId: 'animation',
    keywords: ['animation', 'fade', 'slide', 'pop', 'transition'],
  },
  { label: 'Duration', cardId: 'animation', keywords: ['animation duration', 'speed', 'frames'] },
  {
    label: 'Word style',
    cardId: 'animation',
    keywords: [
      'highlight',
      'underline',
      'bounce',
      'karaoke',
      'scale',
      'reveal',
      'crossfade',
      'none',
      'static',
      'word animation',
    ],
  },
  { label: 'Text', cardId: 'animation', keywords: ['highlight text color'] },
  { label: 'Radius', cardId: 'animation', keywords: ['highlight radius', 'rounded', 'corner'] },
  { label: 'Width', cardId: 'animation', keywords: ['highlight padding', 'pill'] },
  { label: 'Height', cardId: 'animation', keywords: ['highlight padding', 'pill'] },
  { label: 'Opacity', cardId: 'animation', keywords: ['highlight opacity', 'transparency'] },
  { label: 'Movement', cardId: 'animation', keywords: ['jump', 'slide', 'highlight movement'] },
  {
    label: 'Offset X',
    cardId: 'animation',
    keywords: ['highlight offset', 'pill position', 'nudge'],
  },
  {
    label: 'Offset Y',
    cardId: 'animation',
    keywords: ['highlight offset', 'pill position', 'nudge'],
  },
  { label: 'Thickness', cardId: 'animation', keywords: ['underline thickness'] },
  { label: 'Offset Y', cardId: 'animation', keywords: ['underline offset'] },
  { label: 'Width', cardId: 'animation', keywords: ['underline width'] },
  { label: 'Color', cardId: 'animation', keywords: ['underline color'] },
  { label: 'Strength', cardId: 'animation', keywords: ['bounce strength'] },
  { label: 'Factor', cardId: 'animation', keywords: ['scale factor', 'zoom'] },
]

export interface SearchFilter {
  matchedCards: Set<CardId>
  matchedLabels: Set<string>
}

/**
 * Case-insensitive substring filter over row labels + keywords + card titles.
 * Returns null for an empty/whitespace query (no filtering).
 * A card-title match includes every row of that card.
 */
export function filterSettings(query: string): SearchFilter | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  const matchedCards = new Set<CardId>()
  const matchedLabels = new Set<string>()

  // Card-title matches pull in the whole card.
  const titleMatchedCards = new Set<CardId>()
  for (const [cardId, title] of Object.entries(CARD_TITLES) as Array<[CardId, string]>) {
    if (title.toLowerCase().includes(q)) titleMatchedCards.add(cardId)
  }

  for (const entry of SETTINGS_REGISTRY) {
    const hit =
      titleMatchedCards.has(entry.cardId) ||
      entry.label.toLowerCase().includes(q) ||
      entry.keywords.some((k) => k.toLowerCase().includes(q))
    if (hit) {
      matchedCards.add(entry.cardId)
      matchedLabels.add(entry.label)
    }
  }

  return { matchedCards, matchedLabels }
}
