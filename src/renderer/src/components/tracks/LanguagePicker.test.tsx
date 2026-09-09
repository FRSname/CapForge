/**
 * Static-markup tests (node env, react-dom/server) for the `+` language picker.
 *
 * `LanguagePicker` itself portals to `document.body` (the tab strip sits inside
 * two `overflow-hidden` containers), and `createPortal` cannot run under
 * `renderToStaticMarkup`. The list is therefore its own component,
 * `LanguagePickerPanel`, which takes the query as a prop — which is also what
 * makes it assertable here, since this harness has no keyboard events.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LanguagePickerPanel, filterLanguages } from './LanguagePicker'

const noop = () => {}

function renderPanel(query: string, addedCodes: string[] = []): string {
  return renderToStaticMarkup(
    <LanguagePickerPanel
      query={query}
      onQueryChange={noop}
      addedCodes={addedCodes}
      onPick={noop}
      onClose={noop}
    />
  )
}

describe('filterLanguages', () => {
  test('matches the English name', () => {
    // Arrange / Act
    const codes = filterLanguages('pol').map((l) => l.code)

    // Assert
    expect(codes).toContain('pl')
    expect(codes).not.toContain('de')
  })

  test('matches the endonym and the code, case-insensitively', () => {
    // Arrange / Act / Assert
    expect(filterLanguages('POLSKI').map((l) => l.code)).toEqual(['pl'])
    expect(filterLanguages('  Pl ').map((l) => l.code)).toContain('pl')
  })

  test('an empty query lists everything', () => {
    // Arrange / Act / Assert
    expect(filterLanguages('').length).toBeGreaterThan(30)
  })

  test('an unmatched query lists nothing', () => {
    // Arrange / Act / Assert
    expect(filterLanguages('zzzz')).toEqual([])
  })
})

describe('LanguagePickerPanel', () => {
  test('filtering by "pol" lists Polish and nothing else', () => {
    // Arrange / Act
    const html = renderPanel('pol')

    // Assert
    expect(html).toContain('Polish')
    expect(html).toContain('Polski')
    expect(html).not.toContain('German')
  })

  test('a language that already has a track renders disabled and marked', () => {
    // Arrange / Act
    const html = renderPanel('pol', ['pl'])

    // Assert — the boolean attribute, not the `disabled:` Tailwind variants
    // that are on every option's class list.
    expect(html).toContain('disabled=""')
    expect(html).toContain('Added')
  })

  test('a language with no track yet is enabled', () => {
    // Arrange / Act
    const html = renderPanel('pol', ['de'])

    // Assert
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('Added')
  })

  test('an unmatched query explains itself instead of rendering an empty list', () => {
    // Arrange / Act
    const html = renderPanel('zzzz')

    // Assert
    expect(html).toContain('No language matches')
  })
})
