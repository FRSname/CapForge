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

// ── Settings shape ────────────────────────────────────────────
export interface StudioSettings {
  // Typography
  fontName:      string
  fontPath:      string
  fontSize:      number
  fontWeight:    number
  lineHeight:    number
  letterSpacing: number
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
  maxWidth:      number
  wordsPerGroup: number
  lines:         number
  bgOpacity:     number
  bgRadius:      number
  bgWidthExtra:  number
  bgHeightExtra: number
  // Animation
  animationType: string
  animDuration:  number
  wordStyle:     string
}

const DEFAULTS: StudioSettings = {
  fontName:      '',
  fontPath:      '',
  fontSize:      52,
  fontWeight:    700,
  lineHeight:    1.2,
  letterSpacing: 0,
  textColor:     '#FFFFFF',
  outlineColor:  '#000000',
  bgColor:       '#D4952A',
  activeColor:   '#F5C842',
  outlineWidth:  2,
  posX:          50,
  posY:          82,
  marginH:       8,
  maxWidth:      90,
  wordsPerGroup: 3,
  lines:         1,
  bgOpacity:     0,
  bgRadius:      16,
  bgWidthExtra:  0,
  bgHeightExtra: 0,
  animationType: 'fade',
  animDuration:  12,
  wordStyle:     'highlight',
}

export function StudioPanel() {
  const [s, setS] = useState<StudioSettings>({ ...DEFAULTS })

  function set<K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) {
    setS(prev => ({ ...prev, [key]: val }))
  }

  return (
    <aside
      className="w-[380px] shrink-0 flex flex-col overflow-hidden border-l"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span className="label-xs">Custom Settings</span>
        {/* Preset selector — TODO: wire up presets:list / presets:load / presets:save */}
        <button className="btn-ghost text-[11px] py-0.5 px-2">Presets ▾</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 flex flex-col gap-2">

        {/* ── Typography ──────────────────────────────────────── */}
        <StudioCard title="Typography">
          <FontPicker value={s.fontName} onChange={(n, p) => { set('fontName', n); set('fontPath', p) }} />
          <div className="divider" />
          <StudioRow label="Size"    value={s.fontSize}      min={12}  max={120} step={1}    unit="px"  def={DEFAULTS.fontSize}      onChange={v => set('fontSize', v)} />
          <StudioRow label="Weight"  value={s.fontWeight}    min={100} max={900} step={100}  unit=""    def={DEFAULTS.fontWeight}    onChange={v => set('fontWeight', v)} />
          <StudioRow label="Leading" value={s.lineHeight}    min={0.8} max={3}   step={0.05} unit=""    def={DEFAULTS.lineHeight}    onChange={v => set('lineHeight', v)} />
          <StudioRow label="Tracking" value={s.letterSpacing} min={-5} max={20}  step={1}    unit="px"  def={DEFAULTS.letterSpacing} onChange={v => set('letterSpacing', v)} />
        </StudioCard>

        {/* ── Colors ──────────────────────────────────────────── */}
        <StudioCard title="Colors">
          <ColorSwatch label="Text"    value={s.textColor}    onChange={v => set('textColor', v)} />
          <ColorSwatch label="Outline" value={s.outlineColor} onChange={v => set('outlineColor', v)} />
          <ColorSwatch label="BG"      value={s.bgColor}      onChange={v => set('bgColor', v)} />
          <ColorSwatch label="Active"  value={s.activeColor}  onChange={v => set('activeColor', v)} />
          <div className="divider" />
          <StudioRow label="Outline W" value={s.outlineWidth} min={0} max={20} unit="px" def={DEFAULTS.outlineWidth} onChange={v => set('outlineWidth', v)} />
        </StudioCard>

        {/* ── Layout ──────────────────────────────────────────── */}
        <StudioCard title="Layout">
          <StudioRow label="Words/Grp" value={s.wordsPerGroup} min={1}  max={8}   unit=""  def={DEFAULTS.wordsPerGroup} onChange={v => set('wordsPerGroup', v)} />
          <StudioRow label="Lines"     value={s.lines}         min={1}  max={4}   unit=""  def={DEFAULTS.lines}         onChange={v => set('lines', v)} />
          <div className="divider" />
          <StudioRow label="X Pos"     value={s.posX}          min={0}  max={100} unit="%" def={DEFAULTS.posX}          onChange={v => set('posX', v)} />
          <StudioRow label="Y Pos"     value={s.posY}          min={10} max={95}  unit="%" def={DEFAULTS.posY}          onChange={v => set('posY', v)} />
          <StudioRow label="Max width" value={s.maxWidth}      min={20} max={100} unit="%" def={DEFAULTS.maxWidth}      onChange={v => set('maxWidth', v)} />
          <StudioRow label="Margin H"  value={s.marginH}       min={0}  max={25}  unit="%" def={DEFAULTS.marginH}       onChange={v => set('marginH', v)} />
        </StudioCard>

        {/* ── Fine-tune ───────────────────────────────────────── */}
        <StudioCard title="Fine-tune" defaultOpen={false}>
          <StudioRow label="BG opacity"  value={s.bgOpacity}     min={0}   max={100} unit="%" def={DEFAULTS.bgOpacity}     onChange={v => set('bgOpacity', v)} />
          <StudioRow label="BG radius"   value={s.bgRadius}      min={0}   max={80}  unit="px" def={DEFAULTS.bgRadius}      onChange={v => set('bgRadius', v)} />
          <StudioRow label="BG width +"  value={s.bgWidthExtra}  min={-50} max={200} unit="px" def={DEFAULTS.bgWidthExtra}  onChange={v => set('bgWidthExtra', v)} />
          <StudioRow label="BG height +" value={s.bgHeightExtra} min={-50} max={200} unit="px" def={DEFAULTS.bgHeightExtra} onChange={v => set('bgHeightExtra', v)} />
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
        </StudioCard>

        {/* ── Export / Render ─────────────────────────────────── */}
        <ExportPanel settings={s} />
      </div>
    </aside>
  )
}
