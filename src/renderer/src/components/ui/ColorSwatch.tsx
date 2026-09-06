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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

interface SliderRowProps {
  /** Omitted for the per-stop rows, whose colour input is the label. */
  label?: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}

/**
 * Slider + editable numeric readout, the same shape (and the same
 * `accent-[var(--color-accent)]` 3px range) as `StudioRow` — the pattern every
 * other numeric setting in the studio uses. Not `StudioRow` itself: that one
 * owns a fixed 72px label column and a dirty/reset affordance against a
 * `DEFAULTS` entry, neither of which a gradient stop has.
 */
function SliderRow({ label, value, min, max, unit, onChange }: SliderRowProps) {
  function commit(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    onChange(Math.min(max, Math.max(min, Math.round(n))))
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {label && (
        <span className="w-9 shrink-0 text-[11px]" style={{ color: 'var(--color-text-2)' }}>
          {label}
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-[3px] accent-[var(--color-accent)]"
        aria-label={label ?? `Stop position (${unit})`}
      />
      {/* Kept alongside the slider so an exact value (45°, 50%) is still
          typeable — dragging cannot reliably hit one. */}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="w-9 shrink-0 text-right text-[11px] tabular-nums bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none px-0.5"
        style={{ color: 'var(--color-text-3)' }}
      />
      <span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-3)' }}>
        {unit}
      </span>
    </div>
  )
}

/**
 * The offset (0–1) a stop should take when dragged to `percent`, clamped to its
 * neighbours.
 *
 * Exported and pure for the same reason as `StudioRow`'s `clampCommittedValue`:
 * the frontend test environment is `node`, so there is no drag to simulate and
 * this is where the contract is actually pinned.
 *
 * Load-bearing rather than cosmetic. The grammar requires non-decreasing
 * offsets, so an out-of-order list fails `parseGradient` — and because
 * `ColorSwatch` reads its own mode back off the committed value, that would flip
 * the editor to Solid mid-drag and lose the gradient. A number field made that
 * hard to reach; a slider makes it the first thing anyone does.
 */
export function clampStopOffset(
  stops: readonly GradientStop[],
  index: number,
  percent: number
): number {
  const lower = index > 0 ? stops[index - 1].offset : 0
  const upper = index < stops.length - 1 ? stops[index + 1].offset : 1
  const wanted = Number.isFinite(percent) ? percent / 100 : lower
  return Math.min(upper, Math.max(lower, wanted))
}

/**
 * Index of the segment a new stop should split — the WIDEST one.
 *
 * Not the last: with sliders it is easy to drag the final two stops onto the
 * same offset, and splitting a zero-width segment yields a stop whose
 * neighbours are identical, which {@link clampStopOffset} can then never move.
 * The widest gap has room whenever any gap does.
 *
 * Pure and exported for the same reason as {@link clampStopOffset}.
 */
export function widestSegmentIndex(stops: readonly GradientStop[]): number {
  let at = 1
  let widest = -1
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].offset - stops[i - 1].offset
    if (gap > widest) {
      widest = gap
      at = i
    }
  }
  return at
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
  const anchorRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  const popWidth = isGradient ? 272 : 176

  // Sync external value
  useEffect(() => {
    if (!isGradient) setHexRaw(value.toUpperCase())
  }, [value, isGradient])

  /**
   * Place the portaled popover against the swatch, flipping above when there is
   * no room below and clamping to the viewport on both axes.
   */
  const updatePopupPosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const maxHeight = Math.min(360, window.innerHeight - 24)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const desired = popRef.current?.offsetHeight ?? 220
    const top =
      spaceBelow >= Math.min(maxHeight, desired)
        ? rect.bottom + 6
        : Math.max(8, rect.top - Math.min(maxHeight, desired) - 6)
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - popWidth - 8))
    setPopupStyle({
      position: 'fixed',
      top,
      left,
      width: popWidth,
      maxHeight,
      zIndex: 'var(--z-dropdown)',
    })
  }, [popWidth])

  // Position on open, and follow the anchor while the sidebar scrolls. `true`
  // on the scroll listener because the StudioPanel scrolls an inner container,
  // and a scroll event there does not bubble to window.
  useLayoutEffect(() => {
    if (!open) return
    updatePopupPosition()
    window.addEventListener('scroll', updatePopupPosition, true)
    window.addEventListener('resize', updatePopupPosition)
    return () => {
      window.removeEventListener('scroll', updatePopupPosition, true)
      window.removeEventListener('resize', updatePopupPosition)
    }
  }, [open, updatePopupPosition])

  // Re-measure once the gradient editor's own height changes (a stop added or
  // removed), so a flipped-above popover stays anchored to the swatch.
  useLayoutEffect(() => {
    if (open) updatePopupPosition()
  }, [open, spec?.stops.length, isGradient, updatePopupPosition])

  // Close on outside click. The popover is portaled to document.body, so it is
  // NOT inside `anchorRef` — both have to be checked.
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (popRef.current?.contains(target)) return
      setOpen(false)
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

  function moveStop(index: number, percent: number) {
    if (!spec) return
    patchStop(index, { offset: clampStopOffset(spec.stops, index, percent) })
  }

  function addStop() {
    if (!spec || spec.stops.length >= MAX_STOPS) return
    const at = widestSegmentIndex(spec.stops)
    const before = spec.stops[at - 1]
    const after = spec.stops[at]
    const stops = [...spec.stops]
    stops.splice(at, 0, { offset: (before.offset + after.offset) / 2, color: after.color })
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
      <div ref={anchorRef} className="relative">
        <button
          type="button"
          className="w-6 h-6 rounded border border-[var(--color-border-2)] cursor-pointer shrink-0 hover:ring-1 hover:ring-[var(--color-accent)] transition-all"
          style={{ background: value }}
          onClick={() => setOpen((o) => !o)}
          title={swatchTitle}
        />

        {/* Portaled to document.body: StudioCard's root is `overflow-hidden`
            (for its rounded header), which CLIPS any popover positioned inside
            it — the taller gradient editor made that visible, but the solid
            picker was being cut off too. Same fix, same `data-cf-popover`
            marker as FontCombobox, so an ancestor popup's outside-click closer
            does not treat a click in here as an outside click. */}
        {open &&
          createPortal(
            <div
              ref={popRef}
              data-cf-popover=""
              style={popupStyle}
              className="pop-in overflow-y-auto p-3 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] shadow-2xl flex flex-col gap-2.5"
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

                  <SliderRow
                    label="Angle"
                    value={Math.round(spec.angle)}
                    min={0}
                    max={359}
                    unit="°"
                    onChange={(n) => commitSpec({ ...spec, angle: ((n % 360) + 360) % 360 })}
                  />

                  <div className="flex flex-col gap-1.5">
                    {spec.stops.map((stop, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={stop.color}
                          onChange={(e) => patchStop(i, { color: e.target.value.toUpperCase() })}
                          className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                          title={`Stop ${i + 1} colour`}
                        />
                        <SliderRow
                          value={Math.round(stop.offset * 100)}
                          min={0}
                          max={100}
                          unit="%"
                          onChange={(n) => moveStop(i, n)}
                        />
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

                  {/* Offsets must be non-decreasing — `moveStop` clamps each
                    slider to its neighbours rather than letting the grammar
                    reject the result. */}
                  <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-3)' }}>
                    Each stop slides between its neighbours.
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
            </div>,
            document.body
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
