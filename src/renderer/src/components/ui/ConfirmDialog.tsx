/**
 * The in-app confirm dialog — CapForge's own answer to `window.confirm`, whose
 * native OS sheet looks nothing like the app and cannot be styled or themed.
 *
 * It is a thin layer over `ModalShell` (scrim, Escape, focus trap, a click
 * outside), which is why a dismissal of any kind means *cancel*.
 *
 * Reach for it through `hooks/useConfirm.tsx` rather than mounting it by hand.
 */

import { ModalShell } from './ModalShell'
import { Button } from './Button'

/** Narrower than the default modal: a confirm is two lines and two buttons. */
const WIDTH_CLASS = 'w-[400px]'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** May contain newlines; they are preserved. */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive actions confirm in red. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalShell open={open} onClose={onCancel} label={title} width={WIDTH_CLASS}>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </h2>
        {body && (
          <p
            className="text-xs leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--color-text-2)' }}
          >
            {body}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  )
}
