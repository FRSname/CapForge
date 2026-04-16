/**
 * A single settings row: label | range slider | numeric display | reset button.
 * Used inside StudioCard sections.
 */

interface StudioRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  defaultValue: number
  onChange: (value: number) => void
}

export function StudioRow({
  label, value, min, max, step = 1, unit = '', defaultValue, onChange,
}: StudioRowProps) {
  const display = Number.isInteger(step) ? value.toFixed(0) : value.toFixed(1)

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Label */}
      <span className="w-[76px] shrink-0 text-xs text-[var(--color-text-muted)] truncate">
        {label}
      </span>

      {/* Range */}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-1 accent-[var(--color-accent)] cursor-pointer"
      />

      {/* Numeric display */}
      <span className="w-[42px] shrink-0 text-right text-xs text-[var(--color-text-muted)] tabular-nums">
        {display}{unit}
      </span>

      {/* Reset */}
      <button
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-white/[0.06] transition-colors"
        title={`Reset to ${defaultValue}${unit}`}
        onClick={() => onChange(defaultValue)}
      >
        ↺
      </button>
    </div>
  )
}
