/**
 * Presentational editor for one skill — a plain text editor over the user's
 * copy of a bundled skill, plus the actions that copy it around.
 *
 * Deliberately **pure**: every piece of state (the loaded detail, the draft,
 * dirty/busy, whether the bundled text is shown) arrives as a prop and every
 * action leaves as a callback. `SkillsPanel` owns all of it. That is what makes
 * this file testable in CapForge's node-env vitest setup, where components are
 * rendered with `react-dom/server` and only the markup can be asserted.
 */

import type { KeyboardEvent } from 'react'
import type { SkillDetail, SkillSummary } from '../../../../preload/index'
import { Button } from '../ui/Button'

export type SkillInstallStatus = SkillSummary['installStatus']

/** Chip copy. `outdated` means "your copy differs from what Claude Code has". */
const STATUS_LABEL: Record<SkillInstallStatus, string> = {
  'not-installed': 'Not installed',
  'up-to-date': 'Installed',
  outdated: 'Update available',
}

/** Install-button copy, keyed by the same status. */
const INSTALL_LABEL: Record<SkillInstallStatus, string> = {
  'not-installed': 'Install',
  'up-to-date': 'Installed',
  outdated: 'Update',
}

/** Tall enough to edit a real SKILL.md in the Settings dialog's content pane. */
const EDITOR_MIN_HEIGHT = '50vh'
/** The read-only bundled copy is reference material, so it gets less room. */
const BUNDLED_MIN_HEIGHT = '25vh'

interface SkillStatusChipProps {
  status: SkillInstallStatus
  /** Bundled version moved on since the user's copy was made. */
  bundleChanged?: boolean
}

/**
 * Install status as a chip, with the orange dot that marks a bundled skill
 * whose shipped text changed since the user's copy. Shared by the list rows in
 * `SkillsPanel` and the editor header so the two can never disagree.
 */
export function SkillStatusChip({ status, bundleChanged = false }: SkillStatusChipProps) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        color: status === 'not-installed' ? 'var(--color-text-3)' : 'var(--color-text-2)',
      }}
    >
      {bundleChanged && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--color-brand)' }}
          aria-hidden="true"
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  )
}

export interface SkillEditorProps {
  /** The loaded skill, or null when nothing is selected (renders nothing). */
  skill: SkillDetail | null
  /** Editor contents — may differ from `skill.text` while unsaved. */
  draft: string
  dirty: boolean
  /** An action is in flight; every control is locked. */
  busy: boolean
  /** "Open both" is on: the bundled text shows read-only under the editor. */
  showBundled?: boolean
  onChange: (text: string) => void
  onSave: () => void
  onReset: () => void
  onInstall: () => void
  onReveal: () => void
  /** Bundle notice — keep the user's copy, clear the flag. */
  onKeepMine: () => void
  /** Bundle notice — replace the user's copy with the bundled text. */
  onTakeNew: () => void
  /** Bundle notice — toggle the read-only bundled pane. */
  onOpenBoth: () => void
}

export function SkillEditor({
  skill,
  draft,
  dirty,
  busy,
  showBundled = false,
  onChange,
  onSave,
  onReset,
  onInstall,
  onReveal,
  onKeepMine,
  onTakeNew,
  onOpenBoth,
}: SkillEditorProps) {
  if (!skill) return null

  const installDisabled = busy || dirty || skill.installStatus === 'up-to-date'

  /**
   * Cmd/Ctrl+S saves the skill. `stopPropagation` matters as much as
   * `preventDefault`: App.tsx listens for the same chord on `window`, and
   * without it a skill save would also fire a project save.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      e.stopPropagation()
      if (dirty && !busy) onSave()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className="min-w-0 truncate text-[11px]"
          style={{ fontFamily: 'var(--cf-font-mono)', color: 'var(--color-text)' }}
        >
          {skill.name}
        </span>
        <SkillStatusChip status={skill.installStatus} bundleChanged={skill.bundleChanged} />
      </div>

      {skill.bundleChanged && (
        <div
          className="flex flex-col gap-1.5 rounded-r p-2"
          role="status"
          style={{
            background: 'var(--color-surface-2)',
            borderLeft: '2px solid var(--color-brand)',
          }}
        >
          <p className="text-[11px]" style={{ color: 'var(--color-text-2)' }}>
            This skill&apos;s bundled version changed since your copy.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" className="text-[11px]" disabled={busy} onClick={onKeepMine}>
              Keep mine
            </Button>
            <Button variant="ghost" className="text-[11px]" disabled={busy} onClick={onTakeNew}>
              Take new
            </Button>
            <Button variant="ghost" className="text-[11px]" disabled={busy} onClick={onOpenBoth}>
              Open both
            </Button>
          </div>
        </div>
      )}

      <textarea
        aria-label={`${skill.name} skill text`}
        value={draft}
        spellCheck={false}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded p-2 text-[11px] leading-relaxed"
        style={{
          fontFamily: 'var(--cf-font-mono)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border-2)',
          color: 'var(--color-text)',
          minHeight: EDITOR_MIN_HEIGHT,
          resize: 'vertical',
        }}
      />

      <p
        className="text-[10px]"
        style={{
          fontFamily: 'var(--cf-font-mono)',
          color: 'var(--color-text-3)',
          wordBreak: 'break-all',
        }}
      >
        {skill.userDir}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Button className="text-[11px]" disabled={!dirty || busy} onClick={onSave}>
          Save
        </Button>
        <Button variant="ghost" className="text-[11px]" disabled={busy} onClick={onReset}>
          Reset to bundled
        </Button>
        <Button
          variant="ghost"
          className="text-[11px]"
          disabled={installDisabled}
          title={dirty ? 'Save first' : undefined}
          onClick={onInstall}
        >
          {INSTALL_LABEL[skill.installStatus]}
        </Button>
        <Button variant="ghost" className="text-[11px]" disabled={busy} onClick={onReveal}>
          Reveal
        </Button>
      </div>

      {showBundled && (
        <div className="flex flex-col gap-1">
          <span className="label-xs">Bundled version</span>
          <textarea
            aria-label={`${skill.name} bundled skill text`}
            value={skill.bundledText}
            readOnly
            spellCheck={false}
            className="w-full rounded p-2 text-[11px] leading-relaxed"
            style={{
              fontFamily: 'var(--cf-font-mono)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-2)',
              minHeight: BUNDLED_MIN_HEIGHT,
              resize: 'vertical',
            }}
          />
        </div>
      )}
    </div>
  )
}
