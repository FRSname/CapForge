import { useState } from 'react'

interface StudioRowProps {
  label: string
  value: number
  min:   number
  max:   number
  step?: number
  unit?: string
  def:   number
  onChange: (value: number) => void
}

export function StudioRow({ label, value: rawValue, min, max, step = 1, unit = '', def, onChange }: StudioRowProps) {
  const value = Number.isFinite(rawValue) ? rawValue : def
  const display = step < 1 ? value.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(value))
  const isDirty = Math.abs(value - def) > 0.001

  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')

  function startEdit() {
    setDraft(display)
    setEditing(true)
  }

  function commitEdit() {
    setEditing(false)
    const n = Number(draft)
    if (!Number.isFinite(n)) return
    // Only clamp to min — allow values above slider max for manual override
    onChange(Math.max(min, step < 1 ? n : Math.round(n)))
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span
        className="w-[72px] shrink-0 text-xs truncate text-[var(--color-text-2)]"
      >
        {label}
      </span>

      {/* Range */}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`flex-1 min-w-0 h-[3px] ${isDirty ? 'accent-[var(--color-accent-2)]' : 'accent-[var(--color-accent)]'}`}
      />

      {/* Editable numeric value */}
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-10 shrink-0 text-right text-[11px] tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-accent)] rounded px-0.5 outline-none text-[var(--color-text)]"
        />
      ) : (
        <span
          className={`w-10 shrink-0 text-right text-[11px] tabular-nums cursor-text hover:text-[var(--color-accent)] transition-colors ${isDirty ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)]'}`}
          onClick={startEdit}
          title="Click to type a value"
        >
          {display}{unit}
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
