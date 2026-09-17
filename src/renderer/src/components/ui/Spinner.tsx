/**
 * A small indeterminate ring for a wait that has no progress to report (a
 * session being restored, a request in flight). Decorative: the text beside it
 * says what is happening, so screen readers hear that, not the ring.
 */

import { cn } from '../../lib/cn'

export const SPINNER_SIZE_PX = 14

export interface SpinnerProps {
  sizePx?: number
  className?: string
}

export function Spinner({ sizePx = SPINNER_SIZE_PX, className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      data-spinner=""
      className={cn('inline-block shrink-0 animate-spin rounded-full', className)}
      style={{
        width: sizePx,
        height: sizePx,
        border: '2px solid var(--color-border-2)',
        borderTopColor: 'var(--color-brand)',
      }}
    />
  )
}
