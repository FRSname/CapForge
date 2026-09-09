/**
 * Static-markup tests (node env, react-dom/server) for the caption-track tab
 * strip. The vitest environment is plain node — no jsdom, no DOM events — so
 * only the rendered HTML is asserted: order, ARIA state, badges, and which
 * affordances exist on which kind of tab.
 *
 * The language picker is portaled and only mounts once `+` has been clicked, so
 * it never appears in this markup (see LanguagePicker.test.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { TrackTabs, type TrackTabInfo } from './TrackTabs'

function makeTab(over: Partial<TrackTabInfo> = {}): TrackTabInfo {
  return {
    id: 'src',
    label: 'Original',
    lang: 'en',
    isSource: true,
    staleCount: 0,
    untranslatedCount: 0,
    reflowNeeded: false,
    ...over,
  }
}

const SOURCE = makeTab()
const POLISH = makeTab({ id: 't1', label: 'Polski', lang: 'pl', isSource: false })

const noop = () => {}

function render(tracks: TrackTabInfo[], activeTrackId: string): string {
  return renderToStaticMarkup(
    <TrackTabs
      tracks={tracks}
      activeTrackId={activeTrackId}
      onSelect={noop}
      onAdd={noop}
      onClose={noop}
    />
  )
}

describe('TrackTabs', () => {
  test('renders the source tab first, then translated tabs', () => {
    // Arrange / Act — the store keeps the source first; the strip must not reorder.
    const html = render([SOURCE, POLISH], 'src')

    // Assert
    expect(html.indexOf('Original')).toBeGreaterThan(-1)
    expect(html.indexOf('Original')).toBeLessThan(html.indexOf('Polski'))
  })

  test('marks only the active tab aria-selected', () => {
    // Arrange / Act
    const html = render([SOURCE, POLISH], 't1')

    // Assert
    expect(html).toMatch(/id="track-tab-t1"[^>]*aria-selected="true"/)
    expect(html).toMatch(/id="track-tab-src"[^>]*aria-selected="false"/)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  test('shows the stale count as a badge', () => {
    // Arrange
    const stale = makeTab({ id: 't1', label: 'Polski', lang: 'pl', isSource: false, staleCount: 3 })

    // Act
    const html = render([SOURCE, stale], 'src')

    // Assert
    expect(html).toContain('>3</span>')
    expect(html).toContain('3 captions whose source text changed')
  })

  test('omits the stale badge when nothing is stale', () => {
    // Arrange / Act
    const html = render([SOURCE, POLISH], 'src')

    // Assert
    expect(html).not.toContain('captions whose source text changed')
  })

  test('shows the untranslated count as its own badge', () => {
    // Arrange
    const blank = makeTab({
      id: 't1',
      label: 'Polski',
      lang: 'pl',
      isSource: false,
      untranslatedCount: 7,
    })

    // Act
    const html = render([SOURCE, blank], 'src')

    // Assert
    expect(html).toContain('>7</span>')
    expect(html).toContain('7 captions with no text yet')
  })

  test('shows a re-flow dot when the source chunking moved', () => {
    // Arrange
    const reflow = makeTab({
      id: 't1',
      label: 'Polski',
      lang: 'pl',
      isSource: false,
      reflowNeeded: true,
    })

    // Act
    const withDot = render([SOURCE, reflow], 'src')
    const without = render([SOURCE, POLISH], 'src')

    // Assert
    expect(withDot).toContain('The source grouping changed')
    expect(without).not.toContain('The source grouping changed')
  })

  test('gives translated tabs a close control and the source none', () => {
    // Arrange / Act
    const both = render([SOURCE, POLISH], 'src')
    const sourceOnly = render([SOURCE], 'src')

    // Assert
    expect(both).toContain('aria-label="Close Polski"')
    expect(sourceOnly).not.toContain('aria-label="Close')
  })

  test('renders the add tab last', () => {
    // Arrange / Act
    const html = render([SOURCE, POLISH], 'src')

    // Assert
    expect(html).toContain('id="track-add-tab"')
    expect(html.lastIndexOf('id="track-add-tab"')).toBeGreaterThan(
      html.lastIndexOf('id="track-tab-t1"')
    )
  })

  test('every tab carries roving tabIndex with only the active one reachable', () => {
    // Arrange / Act
    const html = render([SOURCE, POLISH], 'src')

    // Assert
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(/id="track-tab-src"[^>]*tabindex="0"/)
  })
})
