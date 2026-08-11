import { useState } from 'react'

interface StudioRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  def: number
  onChange: (value: number) => void
  /** Tooltip for the label — for settings whose terse label needs a sentence. */
  title?: string
  /**
   * The highest value this setting may ever hold, in this row's own units —
   * NOT the slider's visual range. `max` bounds the drag; `commitMax` bounds
   * what may be *stored*, and the two are deliberately allowed to differ.
   *
   * OPT-IN, default absent: for most rows the slider max is only a
   * *recommended* range and typing a bigger number is a deliberate escape
   * hatch (posX/posY past the frame, an oversized maxWidth, …), so with this
   * prop omitted a typed value is clamped to `min` only, exactly as before.
   *
   * Set it on rows whose setting has a hard backend limit — a
   * `Field(..., le=…)` on `VideoRenderConfig` — so a typed-in value can't store
   * a config Pydantic will reject at render time (422 on /api/render-video).
   * UI writes do not pass through `sanitizeSettings`, so this row is the only
   * guard on that path. Express the bound in the row's units (a row that shows
   * a 0–1 fraction as a percentage passes 100, not 1) and keep it in step with
   * the schema, the same mirroring contract `lib/settingsSanitize.ts` documents.
   */
  commitMax?: number
}

/**
 * The value a manual (typed) edit should commit, or `null` when the draft isn't
 * a usable number and the edit must be dropped.
 *
 * Extracted as a pure function because the frontend test environment is `node`,
 * not jsdom — there are no DOM events to simulate a blur/Enter with, so this is
 * where the clamp contract is actually pinned.
 */
export function clampCommittedValue(raw: number, min: number, commitMax?: number): number | null {
  if (!Number.isFinite(raw)) return null
  const lowered = Math.max(min, raw)
  if (commitMax == null || !Number.isFinite(commitMax)) return lowered
  return Math.min(commitMax, lowered)
}

export function StudioRow({
  label,
  value: rawValue,
  min,
  max,
  step = 1,
  unit = '',
  def,
  onChange,
  title,
  commitMax,
}: StudioRowProps) {
  const value = Number.isFinite(rawValue) ? rawValue : def
  const display = step < 1 ? value.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(value))
  const isDirty = Math.abs(value - def) > 0.001

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [hovered, setHovered] = useState(false)

  function startEdit() {
    setDraft(display)
    setEditing(true)
  }

  function commitEdit() {
    setEditing(false)
    const n = Number(draft)
    // Always clamp to min; apply an upper bound only when the caller declared
    // one (see `commitMax` above — the default keeps the over-max manual
    // override, and the slider's `max` never limits a typed value).
    const next = clampCommittedValue(step < 1 ? n : Math.round(n), min, commitMax)
    if (next == null) return
    onChange(next)
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span
        className="w-[72px] shrink-0 text-xs truncate"
        style={{ color: 'var(--color-text-2)' }}
        title={title}
      >
        {label}
      </span>

      {/* Range */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`flex-1 min-w-0 h-[3px] ${isDirty ? 'accent-[var(--color-accent-2)]' : 'accent-[var(--color-accent)]'}`}
      />

      {/* Editable numeric value */}
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-10 shrink-0 text-right text-[11px] tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-accent)] rounded px-0.5 outline-none"
          style={{ color: 'var(--color-text)' }}
        />
      ) : (
        <span
          className="w-10 shrink-0 text-right text-[11px] tabular-nums cursor-text transition-colors"
          style={{
            color: hovered
              ? 'var(--color-accent)'
              : isDirty
                ? 'var(--color-text)'
                : 'var(--color-text-3)',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={startEdit}
          title="Click to type a value"
        >
          {display}
          {unit}
        </span>
      )}

      {/* Reset — only visible when dirty */}
      <button
        type="button"
        className="icon-btn w-5 h-5 text-[11px] shrink-0"
        title={`Reset to ${def}${unit}`}
        onClick={() => onChange(def)}
        style={{ opacity: isDirty ? 1 : 0.2 }}
      >
        ↺
      </button>
    </div>
  )
}
