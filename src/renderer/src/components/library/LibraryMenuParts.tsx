/**
 * The rows the library's menus are built from: a card's `…` menu
 * (`LibraryCardMenu`), its "Move to folder…" sub-list, and a folder's menu
 * (`FolderMenu`).
 */

import { useId } from 'react'

export interface MenuItemProps {
  label: string
  title?: string
  color?: string
  /** Why the item cannot be used; given, the item is disabled and the reason shows under it. */
  disabledReason?: string | null
  onClick: () => void
}

export function MenuItem({
  label,
  title,
  color = 'var(--color-text)',
  disabledReason = null,
  onClick,
}: MenuItemProps) {
  const reasonId = useId()
  const disabled = disabledReason !== null
  return (
    <>
      <button
        type="button"
        role="menuitem"
        title={title}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-describedby={disabled ? reasonId : undefined}
        className="rounded px-2 py-1.5 text-left enabled:hover:bg-[var(--color-surface-3)] disabled:cursor-default"
        style={{ color: disabled ? 'var(--color-text-3)' : color }}
        onClick={onClick}
      >
        {label}
      </button>
      {disabled && (
        <p id={reasonId} className="px-2 pb-1.5 text-2xs" style={{ color: 'var(--color-text-3)' }}>
          {disabledReason}
        </p>
      )}
    </>
  )
}

export interface InlineConfirmProps {
  prompt: string
  title?: string
  confirmLabel: string
  confirmColor: string
  onConfirm: () => void
  onCancel: () => void
}

/** The menu's inline "are you sure" row — Delete's pattern, shared with Link. */
export function InlineConfirm({
  prompt,
  title,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: InlineConfirmProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5" title={title}>
      <span style={{ color: 'var(--color-text-2)' }}>{prompt}</span>
      <button
        type="button"
        role="menuitem"
        className="ml-auto rounded px-1.5 py-0.5"
        style={{ color: confirmColor }}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        role="menuitem"
        className="rounded px-1.5 py-0.5"
        style={{ color: 'var(--color-text-3)' }}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}
