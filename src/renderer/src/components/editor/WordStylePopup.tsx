/**
 * Per-word style override popup (right-click on a word chip).
 * Ports openWordStylePopup() from app.js:2570-2790.
 *
 * Rows (all optional overrides — if unchanged from "Global", no override is
 * saved for that field):
 *   1. Text color
 *   2. Active color (active_word_color)
 *   3. Size scale  (font_size_scale, 50–200%)
 *   4. Font family (font_family + custom_font_path) — pick a Bold variant here
 *      if you want bold for a single word
 *   5. Animation  (word_transition)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { WordOverrides, WordTransition } from '../../types/app'
import { loadAllFonts, registerFontFromBuffer, type FontInfo } from '../../lib/fonts'

// ── Props ───────────────────────────────────────────────────────

export interface WordStyleDefaults {
  textColor:   string
  activeColor: string
  /** The global font name, if any — used only to render "— Global —" label context. */
  fontName?:   string
  /** Global word transition — used as the effective transition when override is "— Global —". */
  wordTransition?: WordTransition
  // Global sub-settings — pre-fill values shown for per-word overrides
  highlightRadius?:    number
  highlightPadX?:      number
  highlightPadY?:      number
  highlightOpacity?:   number
  underlineThickness?: number
  underlineColor?:     string
  bounceStrength?:     number
  scaleFactor?:        number
}

interface WordStylePopupProps {
  word:       string
  overrides:  WordOverrides
  anchorRect: DOMRect
  defaults:   WordStyleDefaults
  onApply:    (overrides: WordOverrides) => void
  onReset:    () => void
  onClose:    () => void
}

// Vanilla's word-level transitions.
const TRANSITIONS: Array<[WordTransition | '', string]> = [
  ['',           '— Global —'],
  ['instant',    'Instant'],
  ['crossfade',  'Crossfade'],
  ['highlight',  'Highlight'],
  ['underline',  'Underline'],
  ['bounce',     'Bounce'],
  ['scale',      'Scale Up'],
  ['karaoke',    'Karaoke'],
]

// Popup dimensions used for viewport clamping (approximate).
const POPUP_W = 280
const POPUP_H = 480

// Re-export for call sites that want a single import path.
export type { WordOverrides } from '../../types/app'

// ── Component ────────────────────────────────────────────────────

export function WordStylePopup({
  word, overrides, anchorRect, defaults, onApply, onReset, onClose,
}: WordStylePopupProps) {
  // Local edit state — only committed on Apply. Reflect the override if set,
  // otherwise fall back to the global default for nice initial values.
  const [textColor,    setTextColor]    = useState(overrides.text_color        ?? defaults.textColor)
  const [activeColor,  setActiveColor]  = useState(overrides.active_word_color ?? defaults.activeColor)
  const [scale,        setScale]        = useState(overrides.font_size_scale   ?? 1)
  const [fontFamily,   setFontFamily]   = useState(overrides.font_family       ?? '')
  const [fontPath,     setFontPath]     = useState(overrides.custom_font_path  ?? '')
  const [transition,   setTransition]   = useState<WordTransition | ''>(overrides.word_transition ?? '')

  // Per-word position nudge (px) — additive to the row layout.
  const [posOffX,      setPosOffX]      = useState(overrides.pos_offset_x ?? 0)
  const [posOffY,      setPosOffY]      = useState(overrides.pos_offset_y ?? 0)

  // Per-effect sub-settings — pre-fill with global values so sliders show
  // something sensible before the user changes them.
  const [hlRadius,     setHlRadius]     = useState(overrides.highlight_radius    ?? defaults.highlightRadius    ?? 0)
  const [hlPadX,       setHlPadX]       = useState(overrides.highlight_padding_x ?? defaults.highlightPadX      ?? 0)
  const [hlPadY,       setHlPadY]       = useState(overrides.highlight_padding_y ?? defaults.highlightPadY      ?? 0)
  const [hlOpacity,    setHlOpacity]    = useState(overrides.highlight_opacity   ?? defaults.highlightOpacity   ?? 1)
  const [ulThick,      setUlThick]      = useState(overrides.underline_thickness ?? defaults.underlineThickness ?? 3)
  const [ulColor,      setUlColor]      = useState(overrides.underline_color     ?? defaults.underlineColor     ?? defaults.activeColor)
  const [bStrength,    setBStrength]    = useState(overrides.bounce_strength     ?? defaults.bounceStrength     ?? 0.3)
  const [sFactor,      setSFactor]      = useState(overrides.scale_factor        ?? defaults.scaleFactor        ?? 1.2)

  const [fonts,        setFonts]        = useState<FontInfo[]>([])
  const popupRef = useRef<HTMLDivElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  // Populate the font picker — same source as FontPicker, but scoped here so
  // the "＋" upload button can add a new face and select it in-popup.
  useEffect(() => {
    let cancelled = false
    loadAllFonts().then(list => { if (!cancelled) setFonts(list) }).catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  // Position — clamp to viewport. Placed near the anchor (click origin), like
  // vanilla's popup.style.left/top. Uses fixed positioning so we don't have to
  // walk up scroll containers.
  const popupStyle: React.CSSProperties = useMemo(() => {
    const pad = 8
    let left = anchorRect.left
    let top  = anchorRect.bottom + pad
    if (left + POPUP_W > window.innerWidth  - 10) left = window.innerWidth  - POPUP_W - 10
    if (top  + POPUP_H > window.innerHeight - 10) top  = anchorRect.top - POPUP_H - pad
    if (left < 10) left = 10
    if (top  < 10) top  = 10
    return { position: 'fixed', top, left, zIndex: 1000 }
  }, [anchorRect])

  // Close on outside click or Escape.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [onClose])

  // ── Actions ────────────────────────────────────────────────────

  // Effective transition — what will actually run for this word at render time.
  // Used to decide which sub-settings UI to show.
  const effectiveTransition: WordTransition | '' = transition || (defaults.wordTransition ?? '')

  // Live preview — re-apply on every state change so the editor reflects
  // edits without the user clicking Apply. The Apply button is now just an
  // explicit "I'm done" close action.
  // Using a ref to skip the very first render avoids an unnecessary state
  // ping when the popup opens for a word that already has overrides.
  const firstRenderRef = useRef(true)
  useEffect(() => {
    if (firstRenderRef.current) { firstRenderRef.current = false; return }
    onApply(buildOverrides())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    textColor, activeColor, scale, fontFamily, fontPath, transition,
    posOffX, posOffY,
    hlRadius, hlPadX, hlPadY, hlOpacity,
    ulThick, ulColor, bStrength, sFactor,
  ])

  function buildOverrides(): WordOverrides {
    // Mirror vanilla's "hasOverride" logic: only include fields that differ
    // from the global. The exporter uses defined-keys to know what to apply.
    const next: WordOverrides = {}
    if (textColor   !== defaults.textColor)   next.text_color        = textColor
    if (activeColor !== defaults.activeColor) next.active_word_color = activeColor
    if (scale       !== 1)                    next.font_size_scale   = scale
    if (fontFamily) {
      next.font_family = fontFamily
      if (fontPath) next.custom_font_path = fontPath
    }
    if (transition) next.word_transition = transition

    if (posOffX !== 0) next.pos_offset_x = posOffX
    if (posOffY !== 0) next.pos_offset_y = posOffY

    // Sub-settings — only saved when they differ from the global default AND
    // the effective transition uses them. Avoids polluting the override blob
    // with unrelated values.
    if (effectiveTransition === 'highlight') {
      if (hlRadius  !== (defaults.highlightRadius  ?? 0)) next.highlight_radius    = hlRadius
      if (hlPadX    !== (defaults.highlightPadX    ?? 0)) next.highlight_padding_x = hlPadX
      if (hlPadY    !== (defaults.highlightPadY    ?? 0)) next.highlight_padding_y = hlPadY
      if (hlOpacity !== (defaults.highlightOpacity ?? 1)) next.highlight_opacity   = hlOpacity
    }
    if (effectiveTransition === 'underline') {
      if (ulThick !== (defaults.underlineThickness ?? 3))                       next.underline_thickness = ulThick
      if (ulColor !== (defaults.underlineColor ?? defaults.activeColor))        next.underline_color     = ulColor
    }
    if (effectiveTransition === 'bounce') {
      if (bStrength !== (defaults.bounceStrength ?? 0.3)) next.bounce_strength = bStrength
    }
    if (effectiveTransition === 'scale') {
      if (sFactor !== (defaults.scaleFactor ?? 1.2)) next.scale_factor = sFactor
    }
    return next
  }

  function handleApply() {
    onApply(buildOverrides())
    onClose()
  }

  function handleClear() {
    onReset()
    onClose()
  }

  async function handleFontUpload(file: File) {
    const name = file.name.replace(/\.[^.]+$/, '')
    try {
      const buf = await file.arrayBuffer()
      await registerFontFromBuffer(name, buf.slice(0))
      let savedPath = ''
      try { savedPath = await window.subforge.saveFont(file.name, buf) } catch { /* best-effort */ }
      setFonts(prev => prev.some(f => f.name === name) ? prev : [{ name, path: savedPath, bundled: false }, ...prev])
      setFontFamily(name)
      setFontPath(savedPath)
    } catch {
      // ignore — selection stays unchanged
    }
  }

  return (
    <div
      ref={popupRef}
      style={popupStyle}
      className="w-[280px] max-h-[80vh] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl flex flex-col p-3 text-xs"
    >
      <div className="font-semibold text-[var(--color-text-2)] mb-2 shrink-0">
        Style: &ldquo;{word}&rdquo;
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto pr-1 min-h-0">

      <ColorRow label="Text color"   value={textColor}   onChange={setTextColor} />
      <ColorRow label="Active color" value={activeColor} onChange={setActiveColor} />

      {/* Size scale */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-[var(--color-text-2)]">Size scale</label>
        <input
          type="range"
          min={50} max={200} step={1}
          value={Math.round(scale * 100)}
          onChange={e => setScale(parseInt(e.target.value, 10) / 100)}
          className="flex-1 min-w-0"
        />
        <input
          type="number"
          min={50} max={200}
          value={Math.round(scale * 100)}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) setScale(v / 100)
          }}
          className="w-12 shrink-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1 py-0.5 text-xs tabular-nums"
        />
      </div>

      {/* Font */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-[var(--color-text-2)]">Font</label>
        <select
          value={fontFamily}
          onChange={e => {
            const name = e.target.value
            setFontFamily(name)
            setFontPath(fonts.find(f => f.name === name)?.path ?? '')
          }}
          className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs"
          style={fontFamily ? { fontFamily: `"${fontFamily}", sans-serif` } : undefined}
        >
          <option value="">— Global —</option>
          {fonts.map(f => (
            <option
              key={`${f.name}|${f.path}`}
              value={f.name}
              style={{ fontFamily: `"${f.name}", sans-serif` }}
            >
              {f.bundled ? f.name : `${f.name} ★`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Load a custom font for this word"
          className="shrink-0 px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]"
        >
          ＋
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          className="hidden"
          onChange={async e => {
            const f = e.target.files?.[0]
            if (f) await handleFontUpload(f)
            if (fileRef.current) fileRef.current.value = ''
          }}
        />
      </div>

      {/* Animation */}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-[var(--color-text-2)]">Animation</label>
        <select
          value={transition}
          onChange={e => setTransition(e.target.value as WordTransition | '')}
          className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs"
        >
          {TRANSITIONS.map(([v, label]) => (
            <option key={v || 'global'} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {/* Conditional animation sub-settings — scoped to the effective
          transition so the popup doesn't show options that won't take effect. */}
      {effectiveTransition === 'highlight' && (
        <SubSettings title="Highlight options">
          <NumberRow label="Radius"   value={hlRadius}  onChange={setHlRadius}  min={0} max={50} />
          <NumberRow label="Pad X"    value={hlPadX}    onChange={setHlPadX}    min={0} max={100} />
          <NumberRow label="Pad Y"    value={hlPadY}    onChange={setHlPadY}    min={0} max={100} />
          <NumberRow label="Opacity"  value={hlOpacity} onChange={setHlOpacity} min={0} max={1} step={0.05} />
        </SubSettings>
      )}

      {effectiveTransition === 'underline' && (
        <SubSettings title="Underline options">
          <NumberRow label="Thickness" value={ulThick} onChange={setUlThick} min={1} max={20} />
          <ColorRow  label="Color"     value={ulColor} onChange={setUlColor} />
        </SubSettings>
      )}

      {effectiveTransition === 'bounce' && (
        <SubSettings title="Bounce options">
          <NumberRow label="Strength" value={bStrength} onChange={setBStrength} min={0} max={2} step={0.05} />
        </SubSettings>
      )}

      {effectiveTransition === 'scale' && (
        <SubSettings title="Scale options">
          <NumberRow label="Factor" value={sFactor} onChange={setSFactor} min={1} max={3} step={0.05} />
        </SubSettings>
      )}

      {/* Position offsets — additive to the row layout, in px. */}
      <SubSettings title="Position offset">
        <NumberRow label="Offset X" value={posOffX} onChange={setPosOffX} min={-200} max={200} />
        <NumberRow label="Offset Y" value={posOffY} onChange={setPosOffY} min={-200} max={200} />
      </SubSettings>

      </div>

      {/* Footer */}
      <div className="flex gap-2 mt-2 shrink-0">
        <button
          className="flex-1 py-1 rounded border border-[var(--color-border)] hover:bg-white/[0.04] text-[var(--color-text-2)] text-xs transition-colors"
          onClick={handleClear}
          title="Remove all overrides for this word"
        >
          Clear
        </button>
        <button
          className="flex-1 py-1 rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs transition-colors"
          onClick={handleApply}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ── SubSettings (collapsible-looking group) ────────────────────────

function SubSettings({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-[var(--color-border)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-3)]">
        {title}
      </div>
      {children}
    </div>
  )
}

// ── NumberRow ────────────────────────────────────────────────────

interface NumberRowProps {
  label:    string
  value:    number
  onChange: (v: number) => void
  min:      number
  max:      number
  step?:    number
}

function NumberRow({ label, value, onChange, min, max, step = 1 }: NumberRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-[var(--color-text-2)]">{label}</label>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 min-w-0"
      />
      <input
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(v)
        }}
        className="w-14 shrink-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1 py-0.5 text-xs tabular-nums"
      />
    </div>
  )
}

// ── ColorRow ─────────────────────────────────────────────────────

interface ColorRowProps {
  label:    string
  value:    string
  onChange: (v: string) => void
}

function ColorRow({ label, value, onChange }: ColorRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-[var(--color-text-2)]">{label}</label>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value.toUpperCase())}
        className="w-7 h-6 rounded cursor-pointer border border-[var(--color-border)] bg-transparent p-0"
      />
      <input
        type="text"
        value={value.toUpperCase()}
        maxLength={7}
        onChange={e => {
          const v = e.target.value
          if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v.toUpperCase())
        }}
        className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs font-mono"
      />
    </div>
  )
}
