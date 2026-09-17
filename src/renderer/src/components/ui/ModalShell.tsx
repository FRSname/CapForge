/**
 * The scrim + card a modal dialog is made of, extracted from
 * `ShortcutOverlay.tsx` so the onboarding dialogs share one implementation of
 * "fixed scrim, centred surface card, Escape closes, a click outside closes,
 * focus trapped inside".
 *
 * ShortcutOverlay and SettingsDialog still have their own copies; retrofitting
 * them is a separate change.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { cn } from '../../lib/cn'

/** The card width when the caller does not ask for one. */
const DEFAULT_WIDTH_CLASS = 'w-[560px]'

export interface ModalShellProps {
  open: boolean
  onClose: () => void
  /** The dialog's accessible name. */
  label: string
  /** A Tailwind width class for the card. */
  width?: string
  children: ReactNode
}

export function ModalShell({
  open,
  onClose,
  label,
  width = DEFAULT_WIDTH_CLASS,
  children,
}: ModalShellProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef, open)

  // Escape closes (capture-level not needed; nothing else handles Escape here).
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-scrim)] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={cn(
          'pop-in max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-5 flex flex-col gap-4',
          width
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
