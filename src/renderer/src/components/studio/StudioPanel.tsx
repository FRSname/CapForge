/**
 * Right-side "Custom Settings" panel — complete port.
 * Includes: Typography, Colors, Layout, Fine-tune, Animation, Export.
 */

import { useState } from 'react'
import { StudioCard } from './StudioCard'
import { StudioRow } from './StudioRow'
import { ColorSwatch } from '../ui/ColorSwatch'
import { FontPicker } from '../ui/FontPicker'
import { ExportPanel } from './ExportPanel'
import { CustomRenderPanel } from './CustomRenderPanel'
import { PresetPicker } from './PresetPicker'
import { RenderProgressModal } from './RenderProgressModal'
import { useRender } from '../../hooks/useRender'
import type { Segment } from '../../types/app'
import type { VideoInfo } from '../../lib/api'

// ── Settings shape ────────────────────────────────────────────
export interface StudioSettings {
  // Typography
  fontName:      string
  fontPath:      string
  fontSize:      number
  fontWeight:    number
  tracking:      number  // letter spacing in px (0 = normal)
  // Colors
  textColor:     string
  outlineColor:  string
  bgColor:       string
  activeColor:   string
  outlineWidth:  number
  // Layout
  posX:          number
  posY:          number
  marginH:       number
  marginV:       number
  maxWidth:      number
  wordsPerGroup: number
  lines:         number
  bgOpacity:     number
  bgRadius:      number
  bgWidthExtra:  number
  bgHeightExtra: number
  // Text fine-tune within bg
  textOffsetX:   number
  textOffsetY:   number
  textAlignH:    'left' | 'center' | 'right'
  textAlignV:    'top'  | 'middle' | 'bottom'
  // Line spacing
  lineHeight:    number  // multiplier (1.0 = no gap, 1.2 = 20% gap between rows)
  // Animation
  animationType: string
  animDuration:  number
  wordStyle:     string
  // Per-effect options
  highlightRadius:   number
  highlightPadX:     number
  highlightPadY:     number
  highlightOpacity:  number
  highlightAnim:     string   // 'jump' | 'slide'
  highlightTextColor: string  // hex, '' = use bgColor (legacy behaviour)
  underlineThickness: number
  underlineColor:    string   // hex, '' = use activeColor
  underlineOffsetY:  number   // vertical offset from text baseline in px
  underlineWidth:    number   // 0 = match word width, >0 = fixed width in px
  bounceStrength:    number   // 0-1 fraction of fontSize
  scaleFactor:       number   // 1-2.5
  // Drop shadow
  shadowEnabled:  boolean
  shadowColor:    string
  shadowOpacity:  number
  shadowBlur:     number
  shadowOffsetX:  number
  shadowOffsetY:  number
  // Render (auto-filled from source video; user can override)
  resolution:    [number, number]  // [width, height]
  fps:           number
  format:        'webm' | 'mov' | 'mp4'
  renderMode:    'overlay' | 'baked'
  bitrate:       string             // e.g. "8M", "15M"
  /** True while a source resolution is pinned at the top of the picker. */
  resolutionIsSource: boolean
}

const FPS_PRESETS = [24, 25, 30, 48, 50, 60]

const DEFAULTS: StudioSettings = {
  fontName:      '',
  fontPath:      '',
  fontSize:      150,
  fontWeight:    100,
  tracking:      0,
  textColor:     '#FFFFFF',
  outlineColor:  '#000000',
  bgColor:       '#D4952A',
  activeColor:   '#F5C842',
  outlineWidth:  0,
  posX:          50,
  posY:          82,
  marginH:       8,
  marginV:       8,
  maxWidth:      90,
  wordsPerGroup: 3,
  lines:         1,
  bgOpacity:     0,
  bgRadius:      16,
  bgWidthExtra:  0,
  bgHeightExtra: 0,
  textOffsetX:   0,
  textOffsetY:   0,
  textAlignH:    'center',
  textAlignV:    'middle',
  lineHeight:    1.2,
  animationType: 'fade',
  animDuration:  12,
  wordStyle:     'highlight',
  highlightRadius:   16,
  highlightPadX:     17,
  highlightPadY:     17,
  highlightOpacity:  0.85,
  highlightAnim:     'jump',
  highlightTextColor: '#FFFFFF',
  underlineThickness: 4,
  underlineColor:    '',
  underlineOffsetY:  2,
  underlineWidth:    0,
  bounceStrength:    0.18,
  scaleFactor:       1.25,
  shadowEnabled:  false,
  shadowColor:    '#000000',
  shadowOpacity:  0.8,
  shadowBlur:     8,
  shadowOffsetX:  3,
  shadowOffsetY:  3,
  resolution:    [1920, 1080],
  fps:           30,
  format:        'webm',
  renderMode:    'overlay',
  bitrate:       '8M',
  resolutionIsSource: false,
}

interface StudioPanelProps {
  settings?: StudioSettings
  onChange?: (s: StudioSettings) => void
  /** Current display groups — forwarded to ExportPanel for custom_groups payload. */
  groups?:   Segment[]
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
    if (d < bestDiff) { bestDiff = d; best = f }
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
  // Merge with defaults so older saved projects that lack new fields don't produce undefined/NaN
  const s: StudioSettings = externalSettings ? { ...DEFAULTS, ...externalSettings } : internalS

  function set<K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) {
    const next = { ...s, [key]: val }
    if (onChange) onChange(next)
    else setInternalS(next)
  }

  const onChangeMerged = (next: StudioSettings) => {
    if (onChange) onChange(next); else setInternalS(next)
  }

  const render = useRender({ settings: s, groups, groupsEdited })

  return (
    <aside
      className="w-[380px] shrink-0 flex flex-col min-h-0 overflow-hidden border-l border-[var(--color-border)]"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b border-[var(--color-border)]"
      >
        <span className="label-xs">Custom Settings</span>
        <PresetPicker
          settings={s}
          onChange={next => { if (onChange) onChange(next); else setInternalS(next) }}
        />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2 [&>*]:shrink-0">

        {/* ── Typography ──────────────────────────────────────── */}
        <StudioCard title="Typography">
          <FontPicker value={s.fontName} onChange={(n, p) => {
            const next = { ...s, fontName: n, fontPath: p }
            if (onChange) onChange(next); else setInternalS(next)
          }} />
          <div className="divider" />
          <StudioRow label="Size"    value={s.fontSize}      min={50}  max={220} step={1}    unit="px"  def={DEFAULTS.fontSize}      onChange={v => set('fontSize', v)} />
          <StudioRow label="Tracking" value={s.tracking}     min={-5}  max={20}  step={0.5}  unit="px"  def={DEFAULTS.tracking}     onChange={v => set('tracking', v)} />
        </StudioCard>

        {/* ── Colors ──────────────────────────────────────────── */}
        <StudioCard title="Colors">
          <ColorSwatch label="Text"    value={s.textColor}    onChange={v => set('textColor', v)} />
          <ColorSwatch label="Outline" value={s.outlineColor} onChange={v => set('outlineColor', v)} />
          <ColorSwatch label="BG"      value={s.bgColor}      onChange={v => set('bgColor', v)} />
          <ColorSwatch label="Active"  value={s.activeColor}  onChange={v => set('activeColor', v)} />
          <div className="divider" />
          <StudioRow label="Outline W" value={s.outlineWidth} min={0} max={20} unit="px" def={DEFAULTS.outlineWidth} onChange={v => set('outlineWidth', v)} />
          <div className="divider" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Shadow</span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-2)] cursor-pointer">
              <input type="checkbox" checked={s.shadowEnabled} onChange={e => set('shadowEnabled', e.target.checked)} className="accent-[var(--color-accent)]" />
              {s.shadowEnabled ? 'On' : 'Off'}
            </label>
          </div>
          {s.shadowEnabled && (<>
            <ColorSwatch label="Shadow" value={s.shadowColor} onChange={v => set('shadowColor', v)} />
            <StudioRow label="Opacity" value={Math.round(s.shadowOpacity * 100)} min={0} max={100} unit="%" def={80} onChange={v => set('shadowOpacity', v / 100)} />
            <StudioRow label="Blur"    value={s.shadowBlur}    min={0} max={60}  unit="px" def={DEFAULTS.shadowBlur}    onChange={v => set('shadowBlur', v)} />
            <StudioRow label="Offset X" value={s.shadowOffsetX} min={-50} max={50} unit="px" def={DEFAULTS.shadowOffsetX} onChange={v => set('shadowOffsetX', v)} />
            <StudioRow label="Offset Y" value={s.shadowOffsetY} min={-50} max={50} unit="px" def={DEFAULTS.shadowOffsetY} onChange={v => set('shadowOffsetY', v)} />
          </>)}
        </StudioCard>

        {/* ── Layout ──────────────────────────────────────────── */}
        <StudioCard title="Layout">
          <StudioRow label="Words/Grp" value={s.wordsPerGroup} min={1}  max={8}   unit=""  def={DEFAULTS.wordsPerGroup} onChange={v => set('wordsPerGroup', v)} />
          <StudioRow label="Lines"     value={s.lines}         min={1}  max={4}   unit=""  def={DEFAULTS.lines}         onChange={v => set('lines', v)} />
          <div className="divider" />
          <StudioRow label="X Pos"     value={s.posX}          min={0}  max={100} unit="%" def={DEFAULTS.posX}          onChange={v => set('posX', v)} />
          <StudioRow label="Y Pos"     value={s.posY}          min={10} max={95}  unit="%" def={DEFAULTS.posY}          onChange={v => set('posY', v)} />
          <StudioRow label="Max width" value={s.maxWidth}      min={20} max={100} unit="%" def={DEFAULTS.maxWidth}      onChange={v => set('maxWidth', v)} />
        </StudioCard>

        {/* ── Background ──────────────────────────────────────── */}
        <StudioCard title="Background" defaultOpen={false}>
          <StudioRow label="BG opacity"  value={s.bgOpacity}     min={0}   max={100} unit="%" def={DEFAULTS.bgOpacity}     onChange={v => set('bgOpacity', v)} />
          <StudioRow label="BG radius"   value={s.bgRadius}      min={0}   max={80}  unit="px" def={DEFAULTS.bgRadius}      onChange={v => set('bgRadius', v)} />
          <StudioRow label="BG width +"  value={s.bgWidthExtra}  min={-50} max={200} unit="px" def={DEFAULTS.bgWidthExtra}  onChange={v => set('bgWidthExtra', v)} />
          <StudioRow label="BG height +" value={s.bgHeightExtra} min={-50} max={200} unit="px" def={DEFAULTS.bgHeightExtra} onChange={v => set('bgHeightExtra', v)} />
          <StudioRow label="Margin H"    value={s.marginH}       min={0}   max={25}  unit="%" def={DEFAULTS.marginH}       onChange={v => set('marginH', v)} />
          <StudioRow label="Margin V"    value={s.marginV}       min={0}   max={50}  unit="px" def={DEFAULTS.marginV}      onChange={v => set('marginV', v)} />

          <div className="divider" />
          <span className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">Text in BG box</span>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Align H</span>
            <div className="flex flex-1 min-w-0 rounded-md overflow-hidden border border-[var(--color-border)]">
              {(['left','center','right'] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => set('textAlignH', a)}
                  className={`flex-1 text-[11px] py-1 capitalize transition-colors ${
                    s.textAlignH === a
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
                  }`}
                >{a}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Align V</span>
            <div className="flex flex-1 min-w-0 rounded-md overflow-hidden border border-[var(--color-border)]">
              {(['top','middle','bottom'] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => set('textAlignV', a)}
                  className={`flex-1 text-[11px] py-1 capitalize transition-colors ${
                    s.textAlignV === a
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
                  }`}
                >{a}</button>
              ))}
            </div>
          </div>

          <StudioRow label="Offset X" value={s.textOffsetX} min={-100} max={100} unit="px" def={DEFAULTS.textOffsetX} onChange={v => set('textOffsetX', v)} />
          <StudioRow label="Offset Y" value={s.textOffsetY} min={-50}  max={50}  unit="px" def={DEFAULTS.textOffsetY} onChange={v => set('textOffsetY', v)} />
        </StudioCard>

        {/* ── Animation ───────────────────────────────────────── */}
        <StudioCard title="Animation" defaultOpen={false}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Entry/Exit</span>
            <select
              className="field-input flex-1 min-w-0 text-xs"
              value={s.animationType}
              onChange={e => set('animationType', e.target.value)}
            >
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="slide">Slide Up</option>
              <option value="pop">Pop</option>
            </select>
          </div>
          {s.animationType !== 'none' && (
            <StudioRow label="Duration" value={s.animDuration} min={0} max={50} unit="f" def={DEFAULTS.animDuration} onChange={v => set('animDuration', v)} />
          )}
          <div className="divider" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Word style</span>
            <select
              className="field-input flex-1 min-w-0 text-xs"
              value={s.wordStyle}
              onChange={e => set('wordStyle', e.target.value)}
            >
              <option value="instant">Instant</option>
              <option value="crossfade">Crossfade</option>
              <option value="highlight">Highlight</option>
              <option value="underline">Underline</option>
              <option value="bounce">Bounce</option>
              <option value="scale">Scale Up</option>
              <option value="karaoke">Karaoke Fill</option>
              <option value="reveal">Reveal</option>
            </select>
          </div>

          {/* ── Per-effect options ─────────────────────────────── */}
          {s.wordStyle === 'highlight' && (<>
            <div className="divider" />
            <span className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">Highlight Options</span>
            <ColorSwatch label="Text" value={s.highlightTextColor || s.bgColor} onChange={v => set('highlightTextColor', v)} />
            <StudioRow label="Radius"    value={s.highlightRadius}  min={0}  max={80}  unit="px" def={DEFAULTS.highlightRadius}  onChange={v => set('highlightRadius', v)} />
            <StudioRow label="Width"     value={s.highlightPadX}    min={0}  max={40}  unit="px" def={DEFAULTS.highlightPadX}    onChange={v => set('highlightPadX', v)} />
            <StudioRow label="Height"    value={s.highlightPadY}    min={0}  max={40}  unit="px" def={DEFAULTS.highlightPadY}    onChange={v => set('highlightPadY', v)} />
            <StudioRow label="Opacity"   value={Math.round(s.highlightOpacity * 100)} min={0} max={100} unit="%" def={Math.round(DEFAULTS.highlightOpacity * 100)} onChange={v => set('highlightOpacity', v / 100)} />
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Movement</span>
              <select className="field-input flex-1 min-w-0 text-xs" value={s.highlightAnim} onChange={e => set('highlightAnim', e.target.value)}>
                <option value="jump">Jump</option>
                <option value="slide">Slide</option>
              </select>
            </div>
          </>)}

          {s.wordStyle === 'underline' && (<>
            <div className="divider" />
            <span className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">Underline Options</span>
            <StudioRow label="Thickness" value={s.underlineThickness} min={1}   max={30}  unit="px" def={DEFAULTS.underlineThickness} onChange={v => set('underlineThickness', v)} />
            <StudioRow label="Offset Y"  value={s.underlineOffsetY}  min={-20} max={30}  unit="px" def={DEFAULTS.underlineOffsetY}  onChange={v => set('underlineOffsetY', v)} />
            <StudioRow label="Width"     value={s.underlineWidth}    min={0}   max={100} unit="px" def={DEFAULTS.underlineWidth}    onChange={v => set('underlineWidth', v)} />
            <ColorSwatch label="Color" value={s.underlineColor || s.activeColor} onChange={v => set('underlineColor', v)} />
          </>)}

          {s.wordStyle === 'bounce' && (<>
            <div className="divider" />
            <span className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">Bounce Options</span>
            <StudioRow label="Strength" value={Math.round(s.bounceStrength * 100)} min={0} max={100} unit="%" def={Math.round(DEFAULTS.bounceStrength * 100)} onChange={v => set('bounceStrength', v / 100)} />
          </>)}

          {s.wordStyle === 'scale' && (<>
            <div className="divider" />
            <span className="text-[10px] text-[var(--color-text-3)] uppercase tracking-wider">Scale Options</span>
            <StudioRow label="Factor" value={Math.round(s.scaleFactor * 100)} min={100} max={250} unit="%" def={Math.round(DEFAULTS.scaleFactor * 100)} onChange={v => set('scaleFactor', v / 100)} />
          </>)}

        </StudioCard>

        {/* ── Export / Render ─────────────────────────────────── */}
        <ExportPanel
          audioPath={audioPath}
          sourceVideoInfo={sourceVideoInfo}
          render={render}
          outputDir={outputDir}
          onOutputDir={setOutputDir}
        />

        {/* ── Custom Render ───────────────────────────────────── */}
        <CustomRenderPanel
          settings={s}
          onChange={onChangeMerged}
          audioPath={audioPath}
          outputDir={outputDir}
          render={render}
        />

        {render.status === 'done' && (
          <p className="text-xs mt-1 text-[var(--color-success)]">✓ Render complete</p>
        )}
        {render.status === 'error' && (
          <p className="text-xs mt-1 text-[var(--color-danger)]">{render.message || 'Render failed — check logs'}</p>
        )}
      </div>

      {/* Blocking modal — shown while a render is in flight. */}
      <RenderProgressModal render={render} />
    </aside>
  )
}
