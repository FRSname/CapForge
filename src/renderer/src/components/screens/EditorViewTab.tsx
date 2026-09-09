/**
 * The Text / Groups tab of the results editor.
 *
 * Extracted from `ResultsScreen` (which is at the file-size ceiling) so
 * `hovered` can be local `useState`: the tabs are rendered inline in that
 * component's JSX, and each needs its own hover state.
 *
 * Roving tabIndex + ArrowLeft/ArrowRight, the pattern from `ui/SegmentedControl`.
 */

import { useState } from 'react'

interface TabButtonProps {
  id: string
  active: boolean
  onClick: () => void
  /** ArrowLeft/ArrowRight pressed while the tab has focus. */
  onArrow: () => void
  children: React.ReactNode
}

export function TabButton({ id, active, onClick, onArrow, children }: TabButtonProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={[
        'text-xs px-3 py-1.5 rounded-t transition-colors border-b-2',
        active ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]' : 'border-transparent',
      ].join(' ')}
      style={{
        color: active ? 'var(--color-text)' : hovered ? 'var(--color-text)' : 'var(--color-text-3)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          // Stop the event reaching the window-level playback handler,
          // which maps ←/→ to frame stepping.
          e.stopPropagation()
          onArrow()
        }
      }}
    >
      {children}
    </button>
  )
}
