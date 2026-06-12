/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the primitive produces.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Select } from './Select'

describe('Select', () => {
  test('renders a native select with the field-input class', () => {
    // Arrange
    const el = (
      <Select defaultValue="">
        <option value="">Auto-detect</option>
        <option value="en">en</option>
      </Select>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('<select')
    expect(html).toContain('class="field-input"')
    expect(html).toMatch(/<option[^>]*value=""[^>]*>Auto-detect<\/option>/)
    expect(html).toMatch(/<option[^>]*value="en"[^>]*>en<\/option>/)
  })

  test('merges extra layout classes', () => {
    // Arrange
    const el = (
      <Select className="flex-1 min-w-0 text-xs" defaultValue="fade">
        <option value="fade">Fade</option>
      </Select>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('class="field-input flex-1 min-w-0 text-xs"')
  })

  test('controlled value marks the matching option selected', () => {
    // Arrange
    const el = (
      <Select value="mov" onChange={() => {}}>
        <option value="webm">WebM</option>
        <option value="mov">MOV</option>
      </Select>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toMatch(/<option value="mov" selected="">MOV<\/option>/)
    expect(html).not.toMatch(/<option value="webm"[^>]*selected/)
  })
})
