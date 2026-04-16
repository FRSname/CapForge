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

export function StudioRow({ label, value, min, max, step = 1, unit = '', def, onChange }: StudioRowProps) {
  const display = step < 1 ? value.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(value))
  const isDirty = Math.abs(value - def) > 0.001

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span
        className="w-[72px] shrink-0 text-xs truncate"
        style={{ color: 'var(--color-text-2)' }}
      >
        {label}
      </span>

      {/* Range */}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-[3px]"
        style={{ accentColor: isDirty ? 'var(--color-accent-2)' : 'var(--color-accent)' }}
      />

      {/* Numeric display */}
      <span
        className="w-10 shrink-0 text-right text-[11px] tabular-nums"
        style={{ color: isDirty ? 'var(--color-text)' : 'var(--color-text-3)' }}
      >
        {display}{unit}
      </span>

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
