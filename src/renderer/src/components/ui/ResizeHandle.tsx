/**
 * The 1 px drag strip between two columns. Drawn as a flex child of the row,
 * so it stays where the panels meet whatever their widths are.
 */

import type React from 'react'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  /** Hidden along with the column it belongs to. */
  hidden?: boolean
  label: string
}

export function ResizeHandle({ onMouseDown, hidden = false, label }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      hidden={hidden}
      className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
      onMouseDown={onMouseDown}
    />
  )
}
