/**
 * Per-group caption position popup — opened by right-clicking a group row in
 * GroupEditor. Lets the user pin THIS group's caption anchor somewhere other
 * than the global Position setting (e.g. move it to the top while something
 * important occupies the bottom of the frame).
 *
 * Pattern mirrors WordStylePopup: local state, live apply on every change,
 * sparse override build (only axes that differ from the global default are
 * stored), viewport-clamped fixed positioning, Clear/Done footer.
 *
 * Units: the UI edits percent (matches the StudioPanel Position sliders);
 * the stored GroupPositionOverride uses fractions 0–1 (what the backend
 * CustomGroup schema and all three renderers consume).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupPositionOverride } from '../../types/app'

/** Global position defaults, in percent — from StudioSettings posX/posY. */
export interface GroupPositionDefaults {
  posX: number
  posY: number
}

interface GroupPositionPopupProps {
  /** Short text preview of the group, shown in the header. */
  groupLabel: string
  /** Current override (fractions 0–1), {} when none. */
  override: GroupPositionOverride
  anchorRect: DOMRect
  defaults: GroupPositionDefaults
  onApply: (override: GroupPositionOverride) => void
  onReset: () => void
  onClose: () => void
}

const POPUP_W = 260
const POPUP_H = 170

export function GroupPositionPopup({
  groupLabel,
  override,
  defaults,
  anchorRect,
  onApply,
  onReset,
  onClose,
}: GroupPositionPopupProps) {
  // Percent in the UI; seeded from the override when present, else the global.
  const [x, setX] = useState(() =>
    override.position_x != null ? Math.round(override.position_x * 100) : defaults.posX
  )
  const [y, setY] = useState(() =>
    override.position_y != null ? Math.round(override.position_y * 100) : defaults.posY
  )
  const popupRef = useRef<HTMLDivElement>(null)

  // Position — clamp to viewport (same approach as WordStylePopup).
  const popupStyle: React.CSSProperties = useMemo(() => {
    const pad = 8
    let left = anchorRect.left
    let top = anchorRect.bottom + pad
    if (left + POPUP_W > window.innerWidth - 10) left = window.innerWidth - POPUP_W - 10
    if (top + POPUP_H > window.innerHeight - 10) top = anchorRect.top - POPUP_H - pad
    if (left < 10) left = 10
    if (top < 10) top = 10
    return { position: 'fixed', top, left, zIndex: 'var(--z-dropdown)' }
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
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Live apply — skip the first render so opening the popup for a group that
  // already has an override doesn't ping state.
  const firstRenderRef = useRef(true)
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    onApply(buildOverride())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])

  function buildOverride(): GroupPositionOverride {
    // Sparse: only axes that differ from the global setting are stored, so
    // moving the global slider later still moves un-overridden groups.
    const next: GroupPositionOverride = {}
    if (x !== defaults.posX) next.position_x = x / 100
    if (y !== defaults.posY) next.position_y = y / 100
    return next
  }

  function handleApply() {
    onApply(buildOverride())
    onClose()
  }

  function handleClear() {
    onReset()
    onClose()
  }

  return (
    <div
      ref={popupRef}
      className="pop-in w-[260px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl flex flex-col gap-2 p-3 text-xs"
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
          Group position
        </span>
        <span className="text-2xs truncate text-[var(--color-text-3)]">{groupLabel}</span>
      </div>

      <PercentRow label="Horizontal" value={x} onChange={setX} />
      <PercentRow label="Vertical" value={y} onChange={setY} />

      <div className="flex gap-2 pt-1 border-t border-[var(--color-border)]">
        <button
          className="flex-1 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] text-xs transition-colors"
          onClick={handleClear}
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

function PercentRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 text-[var(--color-text-2)]">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="flex-1 min-w-0"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-[var(--color-text-2)]">
        {value}%
      </span>
    </div>
  )
}
