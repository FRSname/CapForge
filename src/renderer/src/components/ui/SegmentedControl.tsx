/**
 * SegmentedControl — generalization of the inline button groups that were
 * duplicated in StudioPanel (safe zones, Align H, Align V). Rendering is
 * pixel-identical to the original inline markup; on top of it we add proper
 * radiogroup semantics with roving tabIndex + ArrowLeft/ArrowRight selection.
 */

import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  /** Extra layout classes for the container (e.g. "flex-1 min-w-0"). */
  className?: string
}

/**
 * Pure helper: the option value that arrow-key navigation should select next.
 * Wraps around at both ends; unknown current value resolves to the first option.
 */
export function nextOptionValue<T extends string>(
  options: ReadonlyArray<SegmentedOption<T>>,
  current: T,
  dir: 1 | -1
): T {
  if (options.length === 0) return current
  const i = options.findIndex((o) => o.value === current)
  if (i === -1) return options[0].value
  return options[(i + dir + options.length) % options.length].value
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = nextOptionValue(options, value, e.key === 'ArrowRight' ? 1 : -1)
    onChange(next)
    // Move focus along with the selection (roving tabIndex)
    const idx = options.findIndex((o) => o.value === next)
    const radios = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios?.[idx]?.focus()
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex rounded-md overflow-hidden border border-[var(--color-border)]', className)}
    >
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={handleKeyDown}
          className={`flex-1 text-[11px] py-1 transition-colors ${
            v === value
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-surface-2)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
