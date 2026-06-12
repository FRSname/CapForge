/**
 * Keyboard-shortcut reference overlay — toggled with `?` (wired in App.tsx).
 *
 * Dialog markup mirrors RenderProgressModal (role="dialog", aria-modal, fixed
 * scrim, centered surface card). Sections come from lib/shortcuts.ts — the
 * same constant the SettingsPanel reference list renders, so there is exactly
 * one shortcut inventory to maintain.
 */

import { Fragment, useEffect, useRef } from 'react'
import { SHORTCUT_SECTIONS } from '../lib/shortcuts'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { IconButton } from './ui/IconButton'

interface ShortcutOverlayProps {
  open: boolean
  onClose: () => void
}

export function ShortcutOverlay({ open, onClose }: ShortcutOverlayProps) {
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
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className="pop-in w-[560px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Keyboard Shortcuts
          </h2>
          <IconButton onClick={onClose} aria-label="Close keyboard shortcuts">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </IconButton>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title} className="flex flex-col gap-1">
              <p
                className="text-2xs uppercase tracking-wider mb-1"
                style={{ color: 'var(--color-text-3)' }}
              >
                {section.title}
              </p>
              {section.items.map((item) => (
                <div
                  key={item.description}
                  className="flex justify-between items-center gap-3 py-0.5"
                >
                  <span className="text-[11px]" style={{ color: 'var(--color-text-2)' }}>
                    {item.description}
                  </span>
                  <span className="shrink-0 flex items-center gap-1">
                    {item.keys.map((k, i) => (
                      <Fragment key={k}>
                        {i > 0 && (
                          <span className="text-2xs" style={{ color: 'var(--color-text-3)' }}>
                            /
                          </span>
                        )}
                        <kbd className="kbd">{k}</kbd>
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
