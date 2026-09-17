/**
 * `Captions | Publish` — the workspace switch, rendered beside the track tabs.
 *
 * Publish is disabled until the session belongs to a library record: the whole
 * workspace edits that record's dossier, and there is nothing to edit without
 * one.
 */

import type { Workspace } from '../../types/app'

/** Why Publish is unavailable — the title on the disabled tab. */
export const PUBLISH_DISABLED_HINT = 'Add this video to the library first'

const OPTIONS: ReadonlyArray<{ value: Workspace; label: string }> = [
  { value: 'captions', label: 'Captions' },
  { value: 'publish', label: 'Publish' },
]

interface WorkspaceToggleProps {
  workspace: Workspace
  onChange: (workspace: Workspace) => void
  /** False when the session has no record — Publish is offered but refused. */
  publishEnabled: boolean
}

export function WorkspaceToggle({ workspace, onChange, publishEnabled }: WorkspaceToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Workspace"
      className="flex rounded-md overflow-hidden border border-[var(--color-border)] shrink-0"
    >
      {OPTIONS.map(({ value, label }) => {
        const disabled = value === 'publish' && !publishEnabled
        const active = value === workspace
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? PUBLISH_DISABLED_HINT : undefined}
            onClick={() => onChange(value)}
            className={`text-xs-plus py-1 px-3 transition-colors ${
              active
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : 'bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]'
            } ${disabled ? 'opacity-40 cursor-default' : ''}`}
            style={active ? undefined : { color: 'var(--color-text-2)' }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
