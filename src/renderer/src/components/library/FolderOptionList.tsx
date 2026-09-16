/**
 * A folder picker inside a library menu: a way back, then one radio row per
 * place — "Top level" and the folders — with the current one checked. Shared
 * by a video's "Move to folder…" (the tree, indented, the path in the tooltip)
 * and a folder's "Move to…" (the legal targets, labelled by path).
 */

import type { MoveOption } from '../../lib/collectionMove'

/** React key for the Top level row, which has no id. */
const TOP_LEVEL_KEY = ':top'
/** Indent per level of nesting, in rem, on top of the row's own padding. */
const INDENT_REM_PER_LEVEL = 0.75
/** The row's own left padding, in rem (Tailwind `px-2`). */
const ROW_PADDING_REM = 0.5

export interface FolderOptionListProps {
  /** The group's name and the back row's label. */
  heading: string
  /** The back row's accessible name. */
  backLabel: string
  options: readonly MoveOption[]
  onPick: (id: string | null) => void
  onBack: () => void
}

export function FolderOptionList({
  heading,
  backLabel,
  options,
  onPick,
  onBack,
}: FolderOptionListProps) {
  return (
    <div role="group" aria-label={heading} className="flex flex-col">
      <button
        type="button"
        role="menuitem"
        aria-label={backLabel}
        className="flex items-center gap-1 rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
        style={{ color: 'var(--color-text-3)' }}
        onClick={onBack}
      >
        <span aria-hidden="true">‹</span>
        <span>{heading}</span>
      </button>
      <div className="flex max-h-56 flex-col overflow-y-auto">
        {options.map((option) => (
          <button
            key={option.id ?? TOP_LEVEL_KEY}
            type="button"
            role="menuitemradio"
            aria-checked={option.checked}
            title={option.title}
            className="flex items-center gap-2 rounded py-1.5 pr-2 text-left hover:bg-[var(--color-surface-3)]"
            style={{
              color: 'var(--color-text)',
              paddingLeft: `${ROW_PADDING_REM + Math.max(0, option.depth - 1) * INDENT_REM_PER_LEVEL}rem`,
            }}
            onClick={() => onPick(option.id)}
          >
            <span
              aria-hidden="true"
              className="w-3 shrink-0"
              style={{ color: 'var(--color-brand)' }}
            >
              {option.checked ? '✓' : ''}
            </span>
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
