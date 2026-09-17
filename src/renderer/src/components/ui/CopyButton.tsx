/**
 * CopyButton — the small "copy this box" control beside a Publish field's
 * label. Copies `text` and toasts "Copied <what>". Disabled while there is
 * nothing to copy, so an empty field never copies an empty string.
 */

import { useCopyText } from '../../hooks/useCopyText'
import { cn } from '../../lib/cn'

/** What a copy button copies, and how the toast names it ("Copied the title"). */
export interface CopyTarget {
  text: string
  what: string
}

interface CopyButtonProps extends CopyTarget {
  className?: string
}

const ICON_SIZE_PX = 12

function CopyIcon() {
  return (
    <svg
      width={ICON_SIZE_PX}
      height={ICON_SIZE_PX}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

export function CopyButton({ text, what, className }: CopyButtonProps) {
  const copy = useCopyText()
  const empty = text.trim() === ''
  return (
    <button
      type="button"
      className={cn('icon-btn w-5 h-5', className)}
      aria-label={`Copy ${what}`}
      title={empty ? 'Nothing to copy yet' : `Copy ${what}`}
      disabled={empty}
      onClick={() => void copy(text, what)}
    >
      <CopyIcon />
    </button>
  )
}
