/**
 * Compact color picker: swatch button that opens a popover with
 * a native <input type="color"> + editable hex field.
 *
 * With `allowGradient`, the popover also offers a **Gradient** mode whose value
 * is the restricted `linear-gradient(...)` string the renderers accept
 * (`lib/gradient.ts`). Only the two settings that actually support one —
 * `textColor` and `bgColor` — opt in; the rest stay solid-only, because nothing
 * downstream would honour a gradient there.
 */

import { useEffect, useRef, useState } from 'react'
import {
  MAX_STOPS,
  MIN_STOPS,
  gradientToCss,
  parseGradient,
  type GradientSpec,
  type GradientStop,
} from '../../lib/gradient'

interface ColorSwatchProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** Offer the gradient editor. Only for settings the renderers honour it on. */
  allowGradient?: boolean
}

/** The gradient a solid colour becomes when the user first switches modes. */
function seedGradient(hex: string): GradientSpec {
  return {
    angle: 90,
    stops: [
      { offset: 0, color: hex.toUpperCase() },
      { offset: 1, color: '#000000' },
    ],
  }
}

export function ColorSwatch({
  label,
  value: rawValue,
  onChange,
  allowGradient = false,
}: ColorSwatchProps) {
  const value = rawValue || '#000000'
  const spec = allowGradient ? parseGradient(value) : null
  const isGradient = spec !== null

  const [open, setOpen] = useState(false)
  // The hex fields track the SOLID reading only; in gradient mode the stops own
  // the value, so there is nothing here to keep in sync.
  const [hex, setHexRaw] = useState(isGradient ? '' : value.toUpperCase())
  const popRef = useRef<HTMLDivElement>(null)

  // Sync external value
  useEffect(() => {
    if (!isGradient) setHexRaw(value.toUpperCase())
  }, [value, isGradient])

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

  /** Emit a spec as the canonical string — never a hand-built one. */
  function commitSpec(next: GradientSpec) {
    onChange(gradientToCss(next))
  }

  function patchStop(index: number, patch: Partial<GradientStop>) {
    if (!spec) return
    commitSpec({
      ...spec,
      stops: spec.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  function addStop() {
    if (!spec || spec.stops.length >= MAX_STOPS) return
    const last = spec.stops[spec.stops.length - 1]
    const prev = spec.stops[spec.stops.length - 2] ?? { offset: 0 }
    // Halfway into the final segment, so the new stop is always in order.
    const offset = (prev.offset + last.offset) / 2
    const stops = [...spec.stops]
    stops.splice(stops.length - 1, 0, { offset, color: last.color })
    commitSpec({ ...spec, stops })
  }

  function removeStop(index: number) {
    if (!spec || spec.stops.length <= MIN_STOPS) return
    commitSpec({ ...spec, stops: spec.stops.filter((_, i) => i !== index) })
  }

  const swatchTitle = isGradient ? 'Gradient' : value
  const inlineText = isGradient ? `${spec.stops.length} stops` : hex

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span className="w-[72px] shrink-0 text-xs truncate" style={{ color: 'var(--color-text-2)' }}>
        {label}
      </span>

      {/* Swatch button — `background` renders a gradient string as-is. */}
      <div ref={popRef} className="relative">
        <button
          type="button"
          className="w-6 h-6 rounded border border-[var(--color-border-2)] cursor-pointer shrink-0 hover:ring-1 hover:ring-[var(--color-accent)] transition-all"
          style={{ background: value }}
          onClick={() => setOpen((o) => !o)}
          title={swatchTitle}
        />

        {open && (
          <div
            className={`absolute left-0 top-8 z-[var(--z-dropdown)] ${
              isGradient ? 'w-60' : 'w-44'
            } p-3 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] shadow-2xl flex flex-col gap-2.5`}
          >
            {allowGradient && (
              <div className="flex gap-1">
                <button
                  type="button"
                  className={`flex-1 text-[11px] py-1 rounded ${isGradient ? '' : 'font-semibold'}`}
                  style={{
                    background: isGradient ? 'var(--color-surface-3)' : 'var(--color-accent)',
                    color: isGradient ? 'var(--color-text-2)' : 'var(--color-bg)',
                  }}
                  onClick={() => onChange(spec ? spec.stops[0].color : value)}
                >
                  Solid
                </button>
                <button
                  type="button"
                  className={`flex-1 text-[11px] py-1 rounded ${isGradient ? 'font-semibold' : ''}`}
                  style={{
                    background: isGradient ? 'var(--color-accent)' : 'var(--color-surface-3)',
                    color: isGradient ? 'var(--color-bg)' : 'var(--color-text-2)',
                  }}
                  onClick={() => commitSpec(seedGradient(value))}
                >
                  Gradient
                </button>
              </div>
            )}

            {isGradient ? (
              <>
                {/* Live preview of exactly what will be stored */}
                <div
                  className="h-8 rounded border border-[var(--color-border-2)]"
                  style={{ background: gradientToCss(spec) }}
                />

                <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-2)' }}>
                  <span className="w-10 shrink-0">Angle</span>
                  <input
                    type="number"
                    min={0}
                    max={359}
                    step={1}
                    value={Math.round(spec.angle)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) commitSpec({ ...spec, angle: ((n % 360) + 360) % 360 })
                    }}
                    className="field-input font-mono text-xs w-full"
                  />
                  <span className="shrink-0">°</span>
                </label>

                <div className="flex flex-col gap-1.5">
                  {spec.stops.map((stop, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={stop.color}
                        onChange={(e) => patchStop(i, { color: e.target.value.toUpperCase() })}
                        className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(stop.offset * 100)}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n)) {
                            patchStop(i, { offset: Math.min(100, Math.max(0, n)) / 100 })
                          }
                        }}
                        className="field-input font-mono text-xs w-full"
                      />
                      <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-3)' }}>
                        %
                      </span>
                      <button
                        type="button"
                        disabled={spec.stops.length <= MIN_STOPS}
                        onClick={() => removeStop(i)}
                        className="w-5 h-5 shrink-0 rounded text-[11px] leading-none disabled:opacity-30"
                        style={{ color: 'var(--color-text-3)' }}
                        title="Remove stop"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={spec.stops.length >= MAX_STOPS}
                  onClick={addStop}
                  className="text-[11px] py-1 rounded disabled:opacity-30"
                  style={{ background: 'var(--color-surface-3)', color: 'var(--color-text-2)' }}
                >
                  + Add stop
                </button>

                {/* Stops must be non-decreasing — the renderers reject a
                    descending list rather than silently reordering it. */}
                <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-3)' }}>
                  Stops run in order, 0% to 100%.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}
      </div>

      {/* Inline editable hex — read-only summary while a gradient is set. */}
      {isGradient ? (
        <span
          className="w-[68px] text-[11px] font-mono px-0.5 truncate"
          style={{ color: 'var(--color-text-3)' }}
          title={value}
        >
          {inlineText}
        </span>
      ) : (
        <input
          type="text"
          value={hex}
          maxLength={7}
          onChange={handleHex}
          className="w-[68px] text-[11px] font-mono bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none transition-colors px-0.5"
          style={{ color: 'var(--color-text-3)' }}
          onFocus={(e) => {
            e.currentTarget.style.color = 'var(--color-text)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.color = 'var(--color-text-3)'
          }}
          placeholder="#RRGGBB"
        />
      )}
    </div>
  )
}
