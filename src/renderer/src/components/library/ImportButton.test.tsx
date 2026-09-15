/**
 * The library's one Import… action, as static markup (node environment).
 *
 * What matters: on macOS it is one button that opens the combined dialog; on
 * Windows and Linux (where Electron cannot combine files and folders in one
 * dialog) the same button opens a Files… / Folder… menu, closed until clicked.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImportButton } from './ImportButton'

const noop = () => {}

describe('ImportButton', () => {
  test('with the combined picker it is one plain button', () => {
    const html = renderToStaticMarkup(<ImportButton onImport={noop} combinedPicker />)
    expect(html).toContain('>Import…<')
    expect(html).toContain('whitespace-nowrap')
    expect(html).not.toContain('aria-haspopup')
    expect(html).not.toContain('role="menu"')
  })

  test('without it the button opens a menu, closed until clicked', () => {
    const html = renderToStaticMarkup(<ImportButton onImport={noop} combinedPicker={false} />)
    expect(html).toContain('>Import…<')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="menu"')
  })

  test('the open menu offers Files… and Folder…', () => {
    const html = renderToStaticMarkup(
      <ImportButton onImport={noop} combinedPicker={false} defaultOpen />
    )
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('role="menu"')
    expect(html.indexOf('>Files…<')).toBeGreaterThan(-1)
    expect(html.indexOf('>Folder…<')).toBeGreaterThan(html.indexOf('>Files…<'))
  })

  test('the combined picker never renders the menu, even asked to start open', () => {
    const html = renderToStaticMarkup(<ImportButton onImport={noop} combinedPicker defaultOpen />)
    expect(html).not.toContain('role="menu"')
  })
})
