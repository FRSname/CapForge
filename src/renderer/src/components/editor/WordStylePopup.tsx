/**
 * Per-word style override popup (right-click on a word chip).
 * Ports openWordStylePopup() from app.js.
 * Rendered as a floating div positioned near the trigger element.
 */

import { useEffect, useRef, useState } from 'react'

export interface WordOverrides {
  text_color?:    string
  outline_color?: string
  bg_color?:      string
}

interface WordStylePopupProps {
  word: string
  overrides: WordOverrides
  anchorRect: DOMRect
  defaultTextColor:    string
  defaultOutlineColor: string
  defaultBgColor:      string
  onApply:  (overrides: WordOverrides) => void
  onReset:  () => void
  onClose:  () => void
}

export function WordStylePopup({
  word, overrides, anchorRect,
  defaultTextColor, defaultOutlineColor, defaultBgColor,
  onApply, onReset, onClose,
}: WordStylePopupProps) {
  const [textColor,    setTextColor]    = useState(overrides.text_color    ?? defaultTextColor)
  const [outlineColor, setOutlineColor] = useState(overrides.outline_color ?? defaultOutlineColor)
  const [bgColor,      setBgColor]      = useState(overrides.bg_color      ?? defaultBgColor)
  const popupRef = useRef<HTMLDivElement>(null)

  // Position below anchor, clamp to viewport
  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    top:  Math.min(anchorRect.bottom + 4, window.innerHeight - 250),
    left: Math.min(anchorRect.left,       window.innerWidth  - 260),
    zIndex: 1000,
  }

  // Close on outside click or Escape
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function handleApply() {
    onApply({ text_color: textColor, outline_color: outlineColor, bg_color: bgColor })
    onClose()
  }

  return (
    <div
      ref={popupRef}
      style={popupStyle}
      className="w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl flex flex-col gap-1 p-3 text-xs"
    >
      <div className="font-semibold mb-1 text-[var(--color-text-muted)]">
        Style: &ldquo;{word}&rdquo;
      </div>

      <ColorRow label="Text color"    value={textColor}    onChange={setTextColor} />
      <ColorRow label="Outline color" value={outlineColor} onChange={setOutlineColor} />
      <ColorRow label="BG color"      value={bgColor}      onChange={setBgColor} />

      <div className="flex gap-2 mt-2">
        <button
          className="flex-1 py-1 rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors text-xs"
          onClick={handleApply}
        >
          Apply
        </button>
        <button
          className="flex-1 py-1 rounded border border-[var(--color-border)] hover:bg-white/[0.04] text-[var(--color-text-muted)] transition-colors text-xs"
          onClick={() => { onReset(); onClose() }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

interface ColorRowProps {
  label:    string
  value:    string
  onChange: (v: string) => void
}

function ColorRow({ label, value, onChange }: ColorRowProps) {
  const [hex, setHex] = useState(value.toUpperCase())

  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.toUpperCase()
    setHex(v)
    onChange(v)
  }

  function handleHexChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v.toUpperCase())
  }

  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-[var(--color-text-muted)]">{label}</label>
      <input
        type="color"
        value={value}
        onChange={handlePickerChange}
        className="w-7 h-6 rounded cursor-pointer border border-[var(--color-border)] bg-transparent p-0"
      />
      <input
        type="text"
        value={hex}
        maxLength={7}
        onChange={handleHexChange}
        className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
      />
    </div>
  )
}
