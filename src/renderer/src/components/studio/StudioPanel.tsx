/**
 * Right-side "Custom Settings" panel — complete port.
 * Includes: Typography, Colors, Layout, Fine-tune, Animation, Export.
 */

import { useMemo, useState } from 'react'
import { StudioCard } from './StudioCard'
import { StudioRow } from '../ui/StudioRow'
import { ColorSwatch } from '../ui/ColorSwatch'
import { FontPicker } from '../ui/FontPicker'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { ExportPanel } from './ExportPanel'
import { ExportFooter } from './ExportFooter'
import { CustomRenderPanel } from './CustomRenderPanel'
import { EffectsPanel } from './EffectsPanel'
import { PresetPicker } from './PresetPicker'
import { RenderProgressModal } from './RenderProgressModal'
import { useRender } from '../../hooks/useRender'
import {
  CARD_SETTINGS,
  countCardDirty,
  filterSettings,
  type CardId,
  type SearchFilter,
} from '../../lib/settingsSearch'
import type { EffectClip, Segment } from '../../types/app'
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

const SAFE_ZONE_OPTIONS: Array<{ value: StudioSettings['safeZone']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'reels', label: 'Reels' },
  { value: 'shorts', label: 'Shorts' },
]

// Labels are pre-capitalized — the original markup rendered lowercase values
// through CSS `capitalize`, which produces identical glyphs.
const ALIGN_H_OPTIONS: Array<{ value: StudioSettings['textAlignH']; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const ALIGN_V_OPTIONS: Array<{ value: StudioSettings['textAlignV']; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]

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

// ── Search/dirty helpers ──────────────────────────────────────

/** Hides its row when a search filter is active and the label doesn't match. */
function Row({
  label,
  filter,
  children,
}: {
  label: string
  filter: SearchFilter | null
  children: React.ReactNode
}) {
  if (filter && !filter.matchedLabels.has(label)) return null
  return <>{children}</>
}

/** Brand-orange dot + "n changed" badge shown in a dirty card's header. */
function DirtyMeta({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
      <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
        {count} changed
      </span>
    </span>
  )
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
  // Effects timeline (logos, etc.) — local to the panel for now; persistence +
  // agent mirroring come later. Sent in the render body for HyperFrames renders.
  const [effects, setEffects] = useState<EffectClip[]>([])
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

  const render = useRender({ settings: s, groups, groupsEdited, effects })

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
  function cardProps(id: CardId) {
    const dirty = countCardDirty(s, DEFAULTS, id)
    return {
      // hide (not unmount) filtered-out cards so their open state survives the search
      hidden: !cardVisible(id),
      forceOpen: filter && cardVisible(id) ? true : undefined,
      meta: dirty > 0 ? <DirtyMeta count={dirty} /> : undefined,
      onReset: dirty > 0 ? () => resetCard(id) : undefined,
    }
  }

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
            className="w-full text-xs pl-2.5 pr-7 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-subtle)]"
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
        <StudioCard title="Typography" {...cardProps('typography')}>
          <Row label="Font" filter={filter}>
            <FontPicker
              value={s.fontName}
              onChange={(n, p) => {
                const next = { ...s, fontName: n, fontPath: p }
                if (onChange) onChange(next)
                else setInternalS(next)
              }}
            />
            <div className="divider" />
          </Row>
          <Row label="Size" filter={filter}>
            <StudioRow
              label="Size"
              value={s.fontSize}
              min={50}
              max={220}
              step={1}
              unit="px"
              def={DEFAULTS.fontSize}
              onChange={(v) => set('fontSize', v)}
            />
          </Row>
          <Row label="Tracking" filter={filter}>
            <StudioRow
              label="Tracking"
              value={s.tracking}
              min={-5}
              max={20}
              step={0.5}
              unit="px"
              def={DEFAULTS.tracking}
              onChange={(v) => set('tracking', v)}
            />
          </Row>
        </StudioCard>

        {/* ── Colors ──────────────────────────────────────────── */}
        <StudioCard title="Colors" {...cardProps('colors')}>
          <Row label="Text" filter={filter}>
            <ColorSwatch label="Text" value={s.textColor} onChange={(v) => set('textColor', v)} />
          </Row>
          <Row label="Outline" filter={filter}>
            <ColorSwatch
              label="Outline"
              value={s.outlineColor}
              onChange={(v) => set('outlineColor', v)}
            />
          </Row>
          <Row label="BG" filter={filter}>
            <ColorSwatch label="BG" value={s.bgColor} onChange={(v) => set('bgColor', v)} />
          </Row>
          <Row label="Active" filter={filter}>
            <ColorSwatch
              label="Active"
              value={s.activeColor}
              onChange={(v) => set('activeColor', v)}
            />
          </Row>
          <div className="divider" />
          <Row label="Outline W" filter={filter}>
            <StudioRow
              label="Outline W"
              value={s.outlineWidth}
              min={0}
              max={20}
              unit="px"
              def={DEFAULTS.outlineWidth}
              onChange={(v) => set('outlineWidth', v)}
            />
          </Row>
          <div className="divider" />
          <Row label="Shadow" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Shadow</span>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-2)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.shadowEnabled}
                  onChange={(e) => set('shadowEnabled', e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                {s.shadowEnabled ? 'On' : 'Off'}
              </label>
            </div>
          </Row>
          {s.shadowEnabled && (
            <>
              <Row label="Shadow" filter={filter}>
                <ColorSwatch
                  label="Shadow"
                  value={s.shadowColor}
                  onChange={(v) => set('shadowColor', v)}
                />
              </Row>
              <Row label="Opacity" filter={filter}>
                <StudioRow
                  label="Opacity"
                  value={Math.round(s.shadowOpacity * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  def={80}
                  onChange={(v) => set('shadowOpacity', v / 100)}
                />
              </Row>
              <Row label="Blur" filter={filter}>
                <StudioRow
                  label="Blur"
                  value={s.shadowBlur}
                  min={0}
                  max={60}
                  unit="px"
                  def={DEFAULTS.shadowBlur}
                  onChange={(v) => set('shadowBlur', v)}
                />
              </Row>
              <Row label="Offset X" filter={filter}>
                <StudioRow
                  label="Offset X"
                  value={s.shadowOffsetX}
                  min={-50}
                  max={50}
                  unit="px"
                  def={DEFAULTS.shadowOffsetX}
                  onChange={(v) => set('shadowOffsetX', v)}
                />
              </Row>
              <Row label="Offset Y" filter={filter}>
                <StudioRow
                  label="Offset Y"
                  value={s.shadowOffsetY}
                  min={-50}
                  max={50}
                  unit="px"
                  def={DEFAULTS.shadowOffsetY}
                  onChange={(v) => set('shadowOffsetY', v)}
                />
              </Row>
            </>
          )}
        </StudioCard>

        {/* ── Layout ──────────────────────────────────────────── */}
        <StudioCard title="Layout" {...cardProps('layout')}>
          <Row label="Words/Grp" filter={filter}>
            <StudioRow
              label="Words/Grp"
              value={s.wordsPerGroup}
              min={1}
              max={8}
              unit=""
              def={DEFAULTS.wordsPerGroup}
              onChange={(v) => set('wordsPerGroup', v)}
            />
          </Row>
          <Row label="Lines" filter={filter}>
            <StudioRow
              label="Lines"
              value={s.lines}
              min={1}
              max={4}
              unit=""
              def={DEFAULTS.lines}
              onChange={(v) => set('lines', v)}
            />
          </Row>
          <div className="divider" />
          <Row label="X Pos" filter={filter}>
            <StudioRow
              label="X Pos"
              value={s.posX}
              min={0}
              max={100}
              unit="%"
              def={DEFAULTS.posX}
              onChange={(v) => set('posX', v)}
            />
          </Row>
          <Row label="Y Pos" filter={filter}>
            <StudioRow
              label="Y Pos"
              value={s.posY}
              min={10}
              max={95}
              unit="%"
              def={DEFAULTS.posY}
              onChange={(v) => set('posY', v)}
            />
          </Row>
          <Row label="Max width" filter={filter}>
            <StudioRow
              label="Max width"
              value={s.maxWidth}
              min={20}
              max={100}
              unit="%"
              def={DEFAULTS.maxWidth}
              onChange={(v) => set('maxWidth', v)}
            />
          </Row>
          <div className="divider" />
          {/* Preview-only platform guides — never rendered to video (see safeZone field doc). */}
          <Row label="Safe zones" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">
                Safe zones
              </span>
              <SegmentedControl
                ariaLabel="Safe zones"
                className="flex-1 min-w-0"
                options={SAFE_ZONE_OPTIONS}
                value={s.safeZone}
                onChange={(v) => set('safeZone', v)}
              />
            </div>
          </Row>
        </StudioCard>

        {/* ── Background ──────────────────────────────────────── */}
        <StudioCard title="Background" defaultOpen={false} {...cardProps('background')}>
          <Row label="BG opacity" filter={filter}>
            <StudioRow
              label="BG opacity"
              value={s.bgOpacity}
              min={0}
              max={100}
              unit="%"
              def={DEFAULTS.bgOpacity}
              onChange={(v) => set('bgOpacity', v)}
            />
          </Row>
          <Row label="BG radius" filter={filter}>
            <StudioRow
              label="BG radius"
              value={s.bgRadius}
              min={0}
              max={80}
              unit="px"
              def={DEFAULTS.bgRadius}
              onChange={(v) => set('bgRadius', v)}
            />
          </Row>
          <Row label="BG width +" filter={filter}>
            <StudioRow
              label="BG width +"
              value={s.bgWidthExtra}
              min={-50}
              max={200}
              unit="px"
              def={DEFAULTS.bgWidthExtra}
              onChange={(v) => set('bgWidthExtra', v)}
            />
          </Row>
          <Row label="BG height +" filter={filter}>
            <StudioRow
              label="BG height +"
              value={s.bgHeightExtra}
              min={-50}
              max={200}
              unit="px"
              def={DEFAULTS.bgHeightExtra}
              onChange={(v) => set('bgHeightExtra', v)}
            />
          </Row>
          <Row label="Margin H" filter={filter}>
            <StudioRow
              label="Margin H"
              value={s.marginH}
              min={0}
              max={25}
              unit="%"
              def={DEFAULTS.marginH}
              onChange={(v) => set('marginH', v)}
            />
          </Row>
          <Row label="Margin V" filter={filter}>
            <StudioRow
              label="Margin V"
              value={s.marginV}
              min={0}
              max={50}
              unit="px"
              def={DEFAULTS.marginV}
              onChange={(v) => set('marginV', v)}
            />
          </Row>

          {!filter && (
            <>
              <div className="divider" />
              <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">
                Text in BG box
              </span>
            </>
          )}

          <Row label="Align H" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Align H</span>
              <SegmentedControl
                ariaLabel="Align horizontal"
                className="flex-1 min-w-0"
                options={ALIGN_H_OPTIONS}
                value={s.textAlignH}
                onChange={(v) => set('textAlignH', v)}
              />
            </div>
          </Row>

          <Row label="Align V" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Align V</span>
              <SegmentedControl
                ariaLabel="Align vertical"
                className="flex-1 min-w-0"
                options={ALIGN_V_OPTIONS}
                value={s.textAlignV}
                onChange={(v) => set('textAlignV', v)}
              />
            </div>
          </Row>

          <Row label="Offset X" filter={filter}>
            <StudioRow
              label="Offset X"
              value={s.textOffsetX}
              min={-100}
              max={100}
              unit="px"
              def={DEFAULTS.textOffsetX}
              onChange={(v) => set('textOffsetX', v)}
            />
          </Row>
          <Row label="Offset Y" filter={filter}>
            <StudioRow
              label="Offset Y"
              value={s.textOffsetY}
              min={-50}
              max={50}
              unit="px"
              def={DEFAULTS.textOffsetY}
              onChange={(v) => set('textOffsetY', v)}
            />
          </Row>
        </StudioCard>

        {/* ── Animation ───────────────────────────────────────── */}
        <StudioCard title="Animation" defaultOpen={false} {...cardProps('animation')}>
          <Row label="Entry/Exit" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">
                Entry/Exit
              </span>
              <Select
                className="flex-1 min-w-0 text-xs"
                value={s.animationType}
                onChange={(e) => set('animationType', e.target.value)}
              >
                <option value="none">None</option>
                <option value="fade">Fade</option>
                <option value="slide">Slide Up</option>
                <option value="pop">Pop</option>
              </Select>
            </div>
          </Row>
          {s.animationType !== 'none' && (
            <Row label="Duration" filter={filter}>
              <StudioRow
                label="Duration"
                value={s.animDuration}
                min={0}
                max={50}
                unit="f"
                def={DEFAULTS.animDuration}
                onChange={(v) => set('animDuration', v)}
              />
            </Row>
          )}
          <div className="divider" />
          <Row label="Word style" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">
                Word style
              </span>
              <Select
                className="flex-1 min-w-0 text-xs"
                value={s.wordStyle}
                onChange={(e) => set('wordStyle', e.target.value)}
              >
                <option value="instant">Instant</option>
                <option value="crossfade">Crossfade</option>
                <option value="highlight">Highlight</option>
                <option value="underline">Underline</option>
                <option value="bounce">Bounce</option>
                <option value="scale">Scale Up</option>
                <option value="karaoke">Karaoke Fill</option>
                <option value="reveal">Reveal</option>
              </Select>
            </div>
          </Row>

          {/* ── Per-effect options ─────────────────────────────── */}
          {s.wordStyle === 'highlight' && (
            <>
              {!filter && (
                <>
                  <div className="divider" />
                  <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">
                    Highlight Options
                  </span>
                </>
              )}
              <Row label="Text" filter={filter}>
                <ColorSwatch
                  label="Text"
                  value={s.highlightTextColor || s.bgColor}
                  onChange={(v) => set('highlightTextColor', v)}
                />
              </Row>
              <Row label="Radius" filter={filter}>
                <StudioRow
                  label="Radius"
                  value={s.highlightRadius}
                  min={0}
                  max={80}
                  unit="px"
                  def={DEFAULTS.highlightRadius}
                  onChange={(v) => set('highlightRadius', v)}
                />
              </Row>
              <Row label="Width" filter={filter}>
                <StudioRow
                  label="Width"
                  value={s.highlightPadX}
                  min={0}
                  max={40}
                  unit="px"
                  def={DEFAULTS.highlightPadX}
                  onChange={(v) => set('highlightPadX', v)}
                />
              </Row>
              <Row label="Height" filter={filter}>
                <StudioRow
                  label="Height"
                  value={s.highlightPadY}
                  min={0}
                  max={40}
                  unit="px"
                  def={DEFAULTS.highlightPadY}
                  onChange={(v) => set('highlightPadY', v)}
                />
              </Row>
              <Row label="Opacity" filter={filter}>
                <StudioRow
                  label="Opacity"
                  value={Math.round(s.highlightOpacity * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  def={Math.round(DEFAULTS.highlightOpacity * 100)}
                  onChange={(v) => set('highlightOpacity', v / 100)}
                />
              </Row>
              <Row label="Movement" filter={filter}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">
                    Movement
                  </span>
                  <Select
                    className="flex-1 min-w-0 text-xs"
                    value={s.highlightAnim}
                    onChange={(e) => set('highlightAnim', e.target.value)}
                  >
                    <option value="jump">Jump</option>
                    <option value="slide">Slide</option>
                  </Select>
                </div>
              </Row>
            </>
          )}

          {s.wordStyle === 'underline' && (
            <>
              {!filter && (
                <>
                  <div className="divider" />
                  <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">
                    Underline Options
                  </span>
                </>
              )}
              <Row label="Thickness" filter={filter}>
                <StudioRow
                  label="Thickness"
                  value={s.underlineThickness}
                  min={1}
                  max={30}
                  unit="px"
                  def={DEFAULTS.underlineThickness}
                  onChange={(v) => set('underlineThickness', v)}
                />
              </Row>
              <Row label="Offset Y" filter={filter}>
                <StudioRow
                  label="Offset Y"
                  value={s.underlineOffsetY}
                  min={-20}
                  max={30}
                  unit="px"
                  def={DEFAULTS.underlineOffsetY}
                  onChange={(v) => set('underlineOffsetY', v)}
                />
              </Row>
              <Row label="Width" filter={filter}>
                <StudioRow
                  label="Width"
                  value={s.underlineWidth}
                  min={0}
                  max={100}
                  unit="px"
                  def={DEFAULTS.underlineWidth}
                  onChange={(v) => set('underlineWidth', v)}
                />
              </Row>
              <Row label="Color" filter={filter}>
                <ColorSwatch
                  label="Color"
                  value={s.underlineColor || s.activeColor}
                  onChange={(v) => set('underlineColor', v)}
                />
              </Row>
            </>
          )}

          {s.wordStyle === 'bounce' && (
            <>
              {!filter && (
                <>
                  <div className="divider" />
                  <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">
                    Bounce Options
                  </span>
                </>
              )}
              <Row label="Strength" filter={filter}>
                <StudioRow
                  label="Strength"
                  value={Math.round(s.bounceStrength * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  def={Math.round(DEFAULTS.bounceStrength * 100)}
                  onChange={(v) => set('bounceStrength', v / 100)}
                />
              </Row>
            </>
          )}

          {s.wordStyle === 'scale' && (
            <>
              {!filter && (
                <>
                  <div className="divider" />
                  <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">
                    Scale Options
                  </span>
                </>
              )}
              <Row label="Factor" filter={filter}>
                <StudioRow
                  label="Factor"
                  value={Math.round(s.scaleFactor * 100)}
                  min={100}
                  max={250}
                  unit="%"
                  def={Math.round(DEFAULTS.scaleFactor * 100)}
                  onChange={(v) => set('scaleFactor', v / 100)}
                />
              </Row>
            </>
          )}
        </StudioCard>

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

            {/* ── Effects (logos, etc.) — composited by HyperFrames ─ */}
            <EffectsPanel effects={effects} onChange={setEffects} audioPath={audioPath} />
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
