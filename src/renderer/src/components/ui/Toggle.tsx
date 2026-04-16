interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`toggle-track ${checked ? 'active' : ''} ${disabled ? 'opacity-40 cursor-default' : ''}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="toggle-thumb" />
      </button>
      {label && <span className="text-xs text-[var(--color-text-2)]">{label}</span>}
    </label>
  )
}
