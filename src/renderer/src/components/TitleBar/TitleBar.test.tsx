/**
 * The TitleBar's "Library" button: offered on the file and results screens,
 * absent on the library itself and while a transcription runs, and always the
 * first of the right-hand actions. There is no Open button on any screen: the
 * library's Add to library… is the one way in (docs/plans/library-finder.md §3.1).
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Screen } from '../../types/app'
import { TitleBar } from './TitleBar'

const noop = () => {}

function render(screen: Screen): string {
  return renderToStaticMarkup(
    <TitleBar screen={screen} onLibrary={noop} onNew={noop} onSave={noop} onSettingsToggle={noop} />
  )
}

const LIBRARY_BUTTON = 'aria-label="Back to the library"'

describe('TitleBar Library button', () => {
  test('renders on the results screen, before Export project… / New', () => {
    const html = render('results')

    expect(html).toContain(LIBRARY_BUTTON)
    const library = html.indexOf(LIBRARY_BUTTON)
    expect(library).toBeLessThan(html.indexOf('>Export project…<'))
    expect(library).toBeLessThan(html.indexOf('>New<'))
    expect(library).toBeLessThan(html.indexOf('aria-label="Undo"'))
  })

  test('renders on the file screen, before Settings', () => {
    const html = render('file')

    expect(html).toContain(LIBRARY_BUTTON)
    expect(html.indexOf(LIBRARY_BUTTON)).toBeLessThan(html.indexOf('aria-label="Settings"'))
  })

  test('is absent on the library screen', () => {
    expect(render('library')).not.toContain(LIBRARY_BUTTON)
  })

  test('is absent while a transcription is running', () => {
    expect(render('progress')).not.toContain(LIBRARY_BUTTON)
  })

  test('names the project export in full, not "Save"', () => {
    const html = render('results')

    expect(html).toContain('>Export project…<')
    expect(html).toContain('aria-label="Export project"')
    expect(html).toContain('Export a .capforge project file')
    expect(html).not.toContain('>Save<')
    // New stays as it is (it starts a fresh transcription, not a file action).
    expect(html).toContain('>New<')
  })

  test('uses theme tokens, not hardcoded colours', () => {
    const html = render('results')
    expect(html).not.toMatch(/text-white|bg-black/)
  })
})

describe('TitleBar Open button', () => {
  test.each<Screen>(['library', 'file', 'progress', 'results'])(
    'is gone on the %s screen',
    (screen) => {
      const html = render(screen)
      expect(html).not.toContain('>Open<')
      expect(html).not.toContain('Open Project')
      expect(html).toContain('aria-label="Settings"')
    }
  )
})
