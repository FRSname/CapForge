/**
 * Settings → Shortcuts: the keyboard reference, rendered from the shared
 * `lib/shortcuts.ts` inventory — the same constant the `?` ShortcutOverlay
 * renders, so the two surfaces can never drift apart.
 *
 * Two-column grid, matching ShortcutOverlay's layout; the dialog is wide
 * enough for it now that Settings is no longer a 288px slide-over.
 */

import { Fragment } from 'react'
import { SHORTCUT_SECTIONS } from '../../lib/shortcuts'

export function ShortcutsSettings() {
  return (
    <div className="flex flex-col gap-3">
      <label className="label-xs">Keyboard Shortcuts</label>
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
                <span className="text-xs-plus" style={{ color: 'var(--color-text-2)' }}>
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
  )
}
