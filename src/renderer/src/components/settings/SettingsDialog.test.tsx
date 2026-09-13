/**
 * Static-markup tests (node env, react-dom/server) for the Settings dialog
 * shell: dialog semantics, the category rail, and that General is the pane
 * shown by default.
 *
 * Only the default render is exercised — the other panes own effects and
 * `window.subforge` calls, which this environment has no DOM or bridge for.
 */

import { describe, expect, test, vi, beforeAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsDialog } from './SettingsDialog'
import { APP_SETTINGS_CATEGORIES } from '../../lib/appSettingsIndex'

beforeAll(() => {
  // `useTheme` reads localStorage + matchMedia during the first render.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  // `useTheme` calls `window.matchMedia`; in the node env `window` is absent,
  // so the global stub is what the bare `window.matchMedia(...)` resolves to.
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
})

function render() {
  return renderToStaticMarkup(<SettingsDialog open onClose={() => {}} onOpen={() => {}} />)
}

describe('SettingsDialog', () => {
  test('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open={false} onClose={() => {}} onOpen={() => {}} />
    )
    expect(html).toBe('')
  })

  test('renders a modal dialog when open', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Settings"')
    expect(html).toContain('pop-in')
  })

  test('renders every category label in the rail', () => {
    const html = render()
    for (const c of APP_SETTINGS_CATEGORIES) {
      // "Claude & Skills" arrives HTML-escaped in static markup.
      expect(html).toContain(c.label.replace('&', '&amp;'))
    }
  })

  test('marks exactly one rail button as the current page', () => {
    const html = render()
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  test('renders the search input', () => {
    const html = render()
    expect(html).toContain('aria-label="Search settings"')
    expect(html).toContain('Search settings…')
  })

  test('shows the General pane by default', () => {
    const html = render()
    expect(html).toContain('Appearance')
  })
})
