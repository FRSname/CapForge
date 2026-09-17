/**
 * Static markup (node env): the button names what it copies and is disabled
 * while the field is empty.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyButton } from './CopyButton'

describe('CopyButton', () => {
  test('names what it copies for assistive tech and the tooltip', () => {
    const html = renderToStaticMarkup(<CopyButton text="A title" what="the title" />)
    expect(html).toContain('aria-label="Copy the title"')
    expect(html).toContain('title="Copy the title"')
    expect(html).not.toContain('disabled')
  })

  test('is disabled with nothing to copy, whitespace included', () => {
    const html = renderToStaticMarkup(<CopyButton text="   " what="the title" />)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Nothing to copy yet')
  })
})
