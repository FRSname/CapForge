/**
 * Static-markup tests (node env, react-dom/server) for the optional
 * onTextCommit text field — see docs/plans/timeline-inline-editing.md Phase 2.
 *
 * `popupStyle` reads `window.innerWidth`/`innerHeight` synchronously during
 * render (not inside an effect), so — unlike components that only touch
 * `window` from effects — this component needs `window` stubbed even under
 * renderToStaticMarkup. `loadAllFonts()` runs in a useEffect and does NOT run
 * under renderToStaticMarkup, so no font-loading mock is needed (same
 * reasoning as HyperFramesPanel.test.tsx).
 *
 * Only rendering (presence/absence/initial value) is asserted here — this
 * harness has no jsdom/testing-library, so it cannot simulate the
 * Enter/blur commit interactions. See the session report for what remains
 * unverified by automated tests.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WordStylePopup, type WordStyleDefaults } from './WordStylePopup'

const DEFAULTS: WordStyleDefaults = {
  textColor: '#FFFFFF',
  activeColor: '#D4952A',
}

function fakeRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    top: 100,
    left: 100,
    right: 140,
    bottom: 120,
    toJSON: () => ({}),
  } as DOMRect
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WordStylePopup — onTextCommit text field', () => {
  test('renders no text field when onTextCommit is omitted (GroupEditor call site)', () => {
    const html = renderToStaticMarkup(
      <WordStylePopup
        word="hello"
        overrides={{}}
        anchorRect={fakeRect()}
        defaults={DEFAULTS}
        onApply={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(html).not.toContain('value="hello"')
  })

  test('renders an editable text field initialized to the word when onTextCommit is provided', () => {
    const html = renderToStaticMarkup(
      <WordStylePopup
        word="hello"
        overrides={{}}
        anchorRect={fakeRect()}
        defaults={DEFAULTS}
        onApply={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
        onTextCommit={vi.fn()}
      />
    )

    expect(html).toContain('type="text"')
    expect(html).toContain('value="hello"')
    // The label row sits above the existing style controls (text color row).
    expect(html.indexOf('>Text<')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('>Text<')).toBeLessThan(html.indexOf('>Text color<'))
  })
})
