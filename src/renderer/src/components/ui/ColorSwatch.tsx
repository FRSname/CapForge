/**
 * Compact color picker: swatch button that opens a popover with
 * a native <input type="color"> + editable hex field.
 */

import { useEffect, useRef, useState } from 'react'

interface ColorSwatchProps {
  label: string
  value: string
  onChange: (hex: string) => void
}

export function ColorSwatch({ label, value, onChange }: ColorSwatchProps) {
  const [open, setOpen]   = useState(false)
  const [hex,  setHexRaw] = useState(value.toUpperCase())
  const popRef = useRef<HTMLDivElement>(null)

  // Sync external value
  useEffect(() => { setHexRaw(value.toUpperCase()) }, [value])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handlePicker(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.toUpperCase()
    setHexRaw(v)
    onChange(v)
  }

  function handleHex(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setHexRaw(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v.toUpperCase())
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)] truncate">{label}</span>

      {/* Swatch button */}
      <div ref={popRef} className="relative">
        <button
          type="button"
          className="w-6 h-6 rounded border border-[var(--color-border-2)] cursor-pointer shrink-0 hover:ring-1 hover:ring-[var(--color-accent)] transition-all"
          style={{ background: value }}
          onClick={() => setOpen(o => !o)}
          title={value}
        />

        {open && (
          <div className="absolute left-0 top-8 z-50 w-44 p-3 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] shadow-2xl flex flex-col gap-2.5">
            {/* Native color wheel */}
            <input
              type="color"
              value={value}
              onChange={handlePicker}
              className="w-full h-28 rounded cursor-pointer border-0 bg-transparent p-0 block"
            />
            {/* Hex field */}
            <input
              type="text"
              value={hex}
              maxLength={7}
              onChange={handleHex}
              className="field-input font-mono text-xs"
              placeholder="#RRGGBB"
            />
          </div>
        )}
      </div>

      {/* Inline hex */}
      <span className="text-[11px] font-mono text-[var(--color-text-3)] truncate">{value.toUpperCase()}</span>
    </div>
  )
}
