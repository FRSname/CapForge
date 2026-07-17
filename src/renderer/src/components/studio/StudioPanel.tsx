/**
 * Right-side "Custom Settings" panel — complete port.
 * Includes: Typography, Colors, Layout, Fine-tune, Animation, Export.
 */

import { useMemo, useState } from 'react'
import { ExportPanel } from './ExportPanel'
import { ExportFooter } from './ExportFooter'
import { CustomRenderPanel } from './CustomRenderPanel'
import { HyperFramesPanel } from './HyperFramesPanel'
import { PresetPicker } from './PresetPicker'
import { RenderProgressModal } from './RenderProgressModal'
import { TypographyCard } from './sections/TypographyCard'
import { ColorsCard } from './sections/ColorsCard'
import { LayoutCard } from './sections/LayoutCard'
import { BackgroundCard } from './sections/BackgroundCard'
import { AnimationCard } from './sections/AnimationCard'
import { DirtyMeta, type StudioCardProps } from './sections/StudioSectionShared'
import { useRender } from '../../hooks/useRender'
import {
  CARD_SETTINGS,
  countCardDirty,
  filterSettings,
  type CardId,
} from '../../lib/settingsSearch'
import type { Segment } from '../../types/app'
import type { VideoInfo } from '../../lib/api'

// ── Settings shape ────────────────────────────────────────────
export interface StudioSettings {
  // Typography
  fontName: string
  fontPath: string
  fontSize: number
  fontWeight: number
  tracking: number // letter spacing in px (0 = normal)
  // Colors
  textColor: string
  outlineColor: string
  bgColor: string
  activeColor: string
  outlineWidth: number
  // Layout
  posX: number
  posY: number
  marginH: number
  marginV: number
  maxWidth: number
  /**
   * Preview-only platform safe-zone guides (TikTok/Reels/Shorts UI chrome).
   * EXCEPTION to the three-place rule: deliberately NOT mapped in
   * buildRenderBody() (lib/render.ts) — guides must never reach the backend
   * or rendered output. See lib/safeZones.ts + SafeZoneOverlay.tsx.
   */
  safeZone: 'off' | 'tiktok' | 'reels' | 'shorts'
  wordsPerGroup: number
  /** 'classic' = CapForge's built-in caption track; else a HyperFrames registry
   *  caption-style name (HyperFrames render path only). */
  captionStyle: string
  lines: number
  bgOpacity: number
  bgRadius: number
  bgWidthExtra: number
  bgHeightExtra: number
  // Text fine-tune within bg
  textOffsetX: number
  textOffsetY: number
  textAlignH: 'left' | 'center' | 'right'
  textAlignV: 'top' | 'middle' | 'bottom'
  // Line spacing
  lineHeight: number // multiplier (1.0 = no gap, 1.2 = 20% gap between rows)
  // Animation
  animationType: string
  animDuration: number
  wordStyle: string
  // Per-effect options
  highlightRadius: number
  highlightPadX: number
  highlightPadY: number
  highlightOpacity: number
  highlightAnim: string // 'jump' | 'slide'
  highlightTextColor: string // hex, '' = use bgColor (legacy behaviour)
  highlightOffsetX: number
  highlightOffsetY: number
  underlineThickness: number
  underlineColor: string // hex, '' = use activeColor
  underlineOffsetY: number // vertical offset from text baseline in px
  underlineWidth: number // 0 = match word width, >0 = fixed width in px
  bounceStrength: number // 0-1 fraction of fontSize
  scaleFactor: number // 1-2.5
  // Drop shadow
  shadowEnabled: boolean
  shadowColor: string
  shadowOpacity: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  // Render (auto-filled from source video; user can override)
  resolution: [number, number] // [width, height]
  fps: number
  format: 'webm' | 'mov' | 'mp4'
  renderMode: 'overlay' | 'baked'
  bitrate: string // e.g. "8M", "15M"
  /** True while a source resolution is pinned at the top of the picker. */
  resolutionIsSource: boolean
}

const FPS_PRESETS = [24, 25, 30, 48, 50, 60]

const DEFAULTS: StudioSettings = {
  fontName: '',
  fontPath: '',
  fontSize: 150,
  fontWeight: 100,
  tracking: 0,
  textColor: '#FFFFFF',
  outlineColor: '#000000',
  bgColor: '#D4952A',
  activeColor: '#F5C842',
  outlineWidth: 0,
  posX: 50,
  posY: 82,
  marginH: 8,
  marginV: 8,
  maxWidth: 90,
  safeZone: 'off',
  wordsPerGroup: 3,
  captionStyle: 'classic',
  lines: 1,
  bgOpacity: 0,
  bgRadius: 16,
  bgWidthExtra: 0,
  bgHeightExtra: 0,
  textOffsetX: 0,
  textOffsetY: 0,
  textAlignH: 'center',
  textAlignV: 'middle',
  lineHeight: 1.2,
  animationType: 'fade',
  animDuration: 12,
  wordStyle: 'highlight',
  highlightRadius: 16,
  highlightPadX: 17,
  highlightPadY: 17,
  highlightOpacity: 0.85,
  highlightAnim: 'jump',
  highlightTextColor: '#FFFFFF',
  highlightOffsetX: 0,
  highlightOffsetY: 0,
  underlineThickness: 4,
  underlineColor: '',
  underlineOffsetY: 2,
  underlineWidth: 0,
  bounceStrength: 0.18,
  scaleFactor: 1.25,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowOpacity: 0.8,
  shadowBlur: 8,
  shadowOffsetX: 3,
  shadowOffsetY: 3,
  resolution: [1920, 1080],
  fps: 30,
  format: 'webm',
  renderMode: 'overlay',
  bitrate: '8M',
  resolutionIsSource: false,
}

interface StudioPanelProps {
  settings?: StudioSettings
  onChange?: (s: StudioSettings) => void
  /** Current display groups — forwarded to ExportPanel for custom_groups payload. */
  groups?: Segment[]
  /** True once the user has manually edited groups (merge/split/reorder/overrides). */
  groupsEdited?: boolean
  /** Source media path — used for "Same as source" output dir + quick-render metadata. */
  audioPath?: string
  /** Probed source video info — drives quick-render resolution/fps. */
  sourceVideoInfo?: VideoInfo | null
}

export { DEFAULTS as STUDIO_DEFAULTS }

/**
 * Snap a source FPS value to the closest preset option (so 29.97 → 30).
 * Mirrors applyVideoInfo()'s "bestOpt" logic from app.js:802-808.
 */
export function snapFps(sourceFps: number): number {
  let best = FPS_PRESETS[0]
  let bestDiff = Infinity
  for (const f of FPS_PRESETS) {
    const d = Math.abs(f - sourceFps)
    if (d < bestDiff) {
      bestDiff = d
      best = f
    }
  }
  return best
}

export function StudioPanel({
  settings: externalSettings,
  onChange,
  groups = [],
  groupsEdited = false,
  audioPath = '',
  sourceVideoInfo = null,
}: StudioPanelProps) {
  const [internalS, setInternalS] = useState<StudioSettings>({ ...DEFAULTS })
  const [outputDir, setOutputDir] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  // Merge with defaults so older saved projects that lack new fields don't produce undefined/NaN
  const s: StudioSettings = externalSettings ? { ...DEFAULTS, ...externalSettings } : internalS

  function set<K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) {
    const next = { ...s, [key]: val }
    if (onChange) onChange(next)
    else setInternalS(next)
  }

  const onChangeMerged = (next: StudioSettings) => {
    if (onChange) onChange(next)
    else setInternalS(next)
  }

  /** Multi-field update in one settings-change call (e.g. font name + path together). */
  function setMany(patch: Partial<StudioSettings>) {
    onChangeMerged({ ...s, ...patch })
  }

  const render = useRender({ settings: s, groups, groupsEdited })

  // ── Settings search ─────────────────────────────────────────
  const filter = useMemo(() => filterSettings(searchQuery), [searchQuery])
  const cardVisible = (id: CardId) => !filter || filter.matchedCards.has(id)

  // ── Per-card dirty count + section reset ────────────────────
  function resetCard(id: CardId) {
    const patch: Partial<StudioSettings> = {}
    for (const key of CARD_SETTINGS[id]) {
      ;(patch as Record<keyof StudioSettings, unknown>)[key] = DEFAULTS[key]
    }
    // CRITICAL: single settings-update call so useSettingsUndo (App.tsx)
    // captures the whole section reset as one undo step.
    onChangeMerged({ ...s, ...patch })
  }

  /** forceOpen/meta/onReset for a StudioCard header. */
  function cardProps(id: CardId): StudioCardProps {
    const dirty = countCardDirty(s, DEFAULTS, id)
    return {
      // hide (not unmount) filtered-out cards so their open state survives the search
      hidden: !cardVisible(id),
      forceOpen: filter && cardVisible(id) ? true : undefined,
      meta: dirty > 0 ? <DirtyMeta count={dirty} /> : undefined,
      onReset: dirty > 0 ? () => resetCard(id) : undefined,
    }
  }

  // Shared props threaded into every extracted section card.
  const sectionProps = { s, defaults: DEFAULTS, filter, set, setMany, cardProps }

  return (
    <aside className="w-[380px] shrink-0 flex flex-col min-h-0 overflow-hidden border-l border-[var(--color-border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-[var(--color-border)]">
        <span className="label-xs">Custom Settings</span>
        <PresetPicker
          settings={s}
          onChange={(next) => {
            if (onChange) onChange(next)
            else setInternalS(next)
          }}
        />
      </div>

      {/* Settings search — pinned above the scroll area */}
      <div className="px-2.5 pt-2.5 shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Search settings…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchQuery('')
            }}
            aria-label="Search settings"
            className="placeholder-subtle w-full text-xs pl-2.5 pr-7 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
            style={{ color: 'var(--color-text)' }}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => setSearchQuery('')}
              className="icon-btn w-5 h-5 text-[11px] absolute right-1 top-1/2 -translate-y-1/2"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2 [&>*]:shrink-0 ${filter ? 'is-searching' : ''}`}
      >
        {filter && filter.matchedCards.size === 0 && (
          <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-3)' }}>
            No settings match “{searchQuery.trim()}”.
          </p>
        )}

        {/* ── Typography ──────────────────────────────────────── */}
        <TypographyCard {...sectionProps} />

        {/* ── Colors ──────────────────────────────────────────── */}
        <ColorsCard {...sectionProps} />

        {/* ── Layout ──────────────────────────────────────────── */}
        <LayoutCard {...sectionProps} />

        {/* ── Background ──────────────────────────────────────── */}
        <BackgroundCard {...sectionProps} />

        {/* ── Animation ───────────────────────────────────────── */}
        <AnimationCard {...sectionProps} />

        {/* Export + Custom Render never match settings search — hide while filtering. */}
        {!filter && (
          <>
            {/* ── Export (subtitle files + output dir) ──────────── */}
            <ExportPanel
              audioPath={audioPath}
              render={render}
              outputDir={outputDir}
              onOutputDir={setOutputDir}
            />

            {/* ── Custom Render ─────────────────────────────────── */}
            <CustomRenderPanel
              settings={s}
              onChange={onChangeMerged}
              audioPath={audioPath}
              outputDir={outputDir}
              render={render}
            />

            {/* ── HyperFrames ✦ — Open Studio + Render ────────────── */}
            <HyperFramesPanel
              captionStyle={s.captionStyle}
              onCaptionStyleChange={(v) => set('captionStyle', v)}
              audioPath={audioPath}
              outputDir={outputDir}
              onOutputDir={setOutputDir}
              render={render}
            />
          </>
        )}
      </div>

      {/* Pinned export actions — always reachable regardless of scroll. */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
        <ExportFooter
          audioPath={audioPath}
          sourceVideoInfo={sourceVideoInfo}
          render={render}
          outputDir={outputDir}
        />
      </div>

      {/* Blocking modal — shown while a render is in flight. */}
      <RenderProgressModal render={render} />
    </aside>
  )
}
