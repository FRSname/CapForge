/**
 * The rows a library card's `…` menu is built from, shared by the main menu
 * (`LibraryCardMenu`) and its "Move to collection…" sub-list.
 */

export interface MenuItemProps {
  label: string
  title?: string
  color?: string
  onClick: () => void
}

export function MenuItem({ label, title, color = 'var(--color-text)', onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      className="rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
      style={{ color }}
      onClick={onClick}
    >
      {label}
    </button>
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
