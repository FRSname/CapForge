/**
 * App Settings — a centered modal dialog with a category rail on the left and
 * one content pane on the right (macOS System Settings shape).
 *
 * Replaces the 288px slide-over `SettingsPanel`: Settings now holds a text
 * editor (Skills) and will gain more, and a narrow strip cannot carry that.
 * Every control moved across unchanged — this shell only decides *which* pane
 * is visible.
 *
 * Two things are owned here rather than by a pane, because the shell is always
 * mounted and the panes are not:
 *   - the theme (`useTheme`), which must apply at launch, long before anyone
 *     opens Settings;
 *   - the ⌘, / Ctrl+, keydown that opens the dialog.
 *
 * Dialog markup mirrors `ShortcutOverlay` (fixed scrim, focus trap, Escape and
 * scrim-click close).
 */

import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useTheme } from '../../hooks/useTheme'
import {
  APP_SETTINGS_CATEGORIES,
  filterAppSettings,
  type AppSettingsCategoryId,
} from '../../lib/appSettingsIndex'
import { IconButton } from '../ui/IconButton'
import { ClaudeSettings } from './ClaudeSettings'
import { GeneralSettings } from './GeneralSettings'
import { ShortcutsSettings } from './ShortcutsSettings'
import { TranscriptionSettings } from './TranscriptionSettings'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** ⌘, is handled in here, so the shell needs a way to open itself. */
  onOpen: () => void
}

/** Rail buttons for categories the current search query does not match. */
const DIMMED = 'opacity-40'

/** True while focus sits in a field where "," is just a character. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

export function SettingsDialog({ open, onClose, onOpen }: SettingsDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef, open)

  // The theme lives on the always-mounted shell — see hooks/useTheme.ts.
  const { lightMode, setLightMode } = useTheme()

  // Survives a close/reopen: the dialog reopens where the user left it.
  const [category, setCategory] = useState<AppSettingsCategoryId>('general')
  const [query, setQuery] = useState('')

  const { categories: matching } = filterAppSettings(query)
  const filtering = query.trim() !== ''

  /**
   * Typing filters the rail. While a query is active the selected category has
   * to be one that still matches it, otherwise the pane on the right has
   * nothing to do with what was typed. Done here rather than in an effect:
   * it is a consequence of the keystroke, not of rendering.
   */
  function handleQueryChange(next: string) {
    setQuery(next)
    if (next.trim() === '') return
    const { categories } = filterAppSettings(next)
    if (categories.length > 0 && !categories.includes(category)) setCategory(categories[0])
  }

  // ⌘, / Ctrl+, opens Settings (registered in lib/shortcuts.ts).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ',') return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpen])

  // Closing clears the search: the category the user was on is worth keeping
  // across a reopen, a half-typed query is not (it would keep the rail dimmed).
  function close() {
    setQuery('')
    onClose()
  }

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuery('')
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={close}
    >
      <div
        ref={cardRef}
        className="pop-in flex h-[80vh] w-[860px] max-w-[92vw] flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Settings
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="field-input text-xs ml-auto w-56"
          />
          <IconButton onClick={close} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </IconButton>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr]">
          <nav
            aria-label="Settings categories"
            className="flex flex-col gap-0.5 overflow-y-auto border-r border-[var(--color-border)] p-2"
          >
            {APP_SETTINGS_CATEGORIES.map((c) => {
              const active = c.id === category
              const dimmed = filtering && !matching.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setCategory(c.id)}
                  className={`rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)] ${
                    dimmed ? DIMMED : ''
                  }`}
                  style={{
                    background: active ? 'var(--color-surface-2)' : 'transparent',
                    color: active ? 'var(--color-text)' : 'var(--color-text-2)',
                  }}
                >
                  {c.label}
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 overflow-y-auto p-5">
            {category === 'general' && (
              <GeneralSettings lightMode={lightMode} onLightModeChange={setLightMode} />
            )}
            {category === 'transcription' && <TranscriptionSettings />}
            {category === 'claude' && <ClaudeSettings />}
            {category === 'shortcuts' && <ShortcutsSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
