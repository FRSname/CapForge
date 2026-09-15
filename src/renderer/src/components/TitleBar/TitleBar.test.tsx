/**
 * The TitleBar's "Library" button: offered on the file and results screens,
 * absent on the library itself and while a transcription runs, and always the
 * first of the right-hand actions.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Screen } from '../../types/app'
import { TitleBar } from './TitleBar'

const noop = () => {}

function render(screen: Screen): string {
  return renderToStaticMarkup(
    <TitleBar
      screen={screen}
      onLibrary={noop}
      onNew={noop}
      onSave={noop}
      onOpen={noop}
      onSettingsToggle={noop}
    />
  )
}

const LIBRARY_BUTTON = 'aria-label="Back to the library"'

describe('TitleBar Library button', () => {
  test('renders on the results screen, before Save / New / Open', () => {
    const html = render('results')

    expect(html).toContain(LIBRARY_BUTTON)
    const library = html.indexOf(LIBRARY_BUTTON)
    expect(library).toBeLessThan(html.indexOf('>Save<'))
    expect(library).toBeLessThan(html.indexOf('>New<'))
    expect(library).toBeLessThan(html.indexOf('>Open<'))
    expect(library).toBeLessThan(html.indexOf('aria-label="Undo"'))
  })

  test('renders on the file screen, before Open', () => {
    const html = render('file')

    expect(html).toContain(LIBRARY_BUTTON)
    expect(html.indexOf(LIBRARY_BUTTON)).toBeLessThan(html.indexOf('>Open<'))
  })

  test('is absent on the library screen', () => {
    expect(render('library')).not.toContain(LIBRARY_BUTTON)
  })

  test('is absent while a transcription is running', () => {
    expect(render('progress')).not.toContain(LIBRARY_BUTTON)
  })

  test('uses theme tokens, not hardcoded colours', () => {
    const html = render('results')
    expect(html).not.toMatch(/text-white|bg-black/)
  })
})
