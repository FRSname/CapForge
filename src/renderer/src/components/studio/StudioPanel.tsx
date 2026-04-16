/**
 * Right-side "Custom Settings" panel.
 * Mirrors the #studio-panel / .subtitle-studio sidebar from the vanilla renderer.
 *
 * Each section is a StudioCard. Settings state lives here (or can be lifted to App
 * once wired up to the backend export pipeline).
 *
 * TODO: Replace placeholder useState with a useStudioSettings hook that
 *       persists settings to electron state via window.subforge.setState().
 */

import { useState } from 'react'
import { StudioCard } from './StudioCard'
import { StudioRow } from './StudioRow'

// ── Default values ─────────────────────────────────────────────────
const DEFAULTS = {
  // Typography
  fontSize:    52,
  lineHeight:  1.2,
  letterSpacing: 0,
  wordSpacing: 0,
  // Layout
  positionY:   85,
  marginH:     8,
  maxWidth:    90,
  // Fine-tune
  outlineWidth: 2,
  shadowBlur:  4,
  bgOpacity:   0,
  bgRadius:    6,
  // Animation
  fadeIn:      80,
  fadeOut:     80,
  scaleFrom:   95,
}

export function StudioPanel() {
  const [settings, setSettings] = useState({ ...DEFAULTS })

  function set<K extends keyof typeof DEFAULTS>(key: K, value: number) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  return (
    <aside className="w-[380px] shrink-0 flex flex-col gap-2 overflow-y-auto overflow-x-hidden p-3 border-l border-[var(--color-border)]">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] mb-1">
        Custom Settings
      </h2>

      {/* ── Typography ──────────────────────────────────────────── */}
      <StudioCard title="Typography">
        <StudioRow label="Font size"    value={settings.fontSize}      min={12}  max={120} defaultValue={DEFAULTS.fontSize}      onChange={v => set('fontSize', v)}      unit="px" />
        <StudioRow label="Line height"  value={settings.lineHeight}    min={0.8} max={3}   defaultValue={DEFAULTS.lineHeight}    onChange={v => set('lineHeight', v)}    step={0.05} />
        <StudioRow label="Letter spc"   value={settings.letterSpacing} min={-5}  max={20}  defaultValue={DEFAULTS.letterSpacing} onChange={v => set('letterSpacing', v)} unit="px" />
        <StudioRow label="Word spc"     value={settings.wordSpacing}   min={-5}  max={30}  defaultValue={DEFAULTS.wordSpacing}   onChange={v => set('wordSpacing', v)}   unit="px" />
        {/* TODO: Font picker, weight, style, color pickers */}
      </StudioCard>

      {/* ── Layout ──────────────────────────────────────────────── */}
      <StudioCard title="Layout">
        <StudioRow label="Position Y"  value={settings.positionY} min={0}  max={100} defaultValue={DEFAULTS.positionY} onChange={v => set('positionY', v)} unit="%" />
        <StudioRow label="Margin H"    value={settings.marginH}   min={0}  max={25}  defaultValue={DEFAULTS.marginH}   onChange={v => set('marginH', v)}   unit="%" />
        <StudioRow label="Max width"   value={settings.maxWidth}  min={20} max={100} defaultValue={DEFAULTS.maxWidth}  onChange={v => set('maxWidth', v)}  unit="%" />
      </StudioCard>

      {/* ── Fine-tune ───────────────────────────────────────────── */}
      <StudioCard title="Fine-tune" defaultOpen={false}>
        <StudioRow label="Outline"    value={settings.outlineWidth} min={0} max={10} defaultValue={DEFAULTS.outlineWidth} onChange={v => set('outlineWidth', v)} unit="px" />
        <StudioRow label="Shadow"     value={settings.shadowBlur}   min={0} max={30} defaultValue={DEFAULTS.shadowBlur}   onChange={v => set('shadowBlur', v)}   unit="px" />
        <StudioRow label="BG opacity" value={settings.bgOpacity}    min={0} max={100} defaultValue={DEFAULTS.bgOpacity}  onChange={v => set('bgOpacity', v)}    unit="%" />
        <StudioRow label="BG radius"  value={settings.bgRadius}     min={0} max={30} defaultValue={DEFAULTS.bgRadius}    onChange={v => set('bgRadius', v)}     unit="px" />
      </StudioCard>

      {/* ── Animation ───────────────────────────────────────────── */}
      <StudioCard title="Animation" defaultOpen={false}>
        <StudioRow label="Fade in"   value={settings.fadeIn}    min={0} max={500} defaultValue={DEFAULTS.fadeIn}   onChange={v => set('fadeIn', v)}   unit="ms" />
        <StudioRow label="Fade out"  value={settings.fadeOut}   min={0} max={500} defaultValue={DEFAULTS.fadeOut}  onChange={v => set('fadeOut', v)}  unit="ms" />
        <StudioRow label="Scale from" value={settings.scaleFrom} min={50} max={100} defaultValue={DEFAULTS.scaleFrom} onChange={v => set('scaleFrom', v)} unit="%" />
      </StudioCard>
    </aside>
  )
}
