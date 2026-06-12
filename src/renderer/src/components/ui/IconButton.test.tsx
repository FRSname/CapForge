/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the primitive produces.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  test('renders the icon-btn class with the required aria-label', () => {
    // Arrange
    const el = (
      <IconButton aria-label="Close settings">✕</IconButton>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('class="icon-btn"')
    expect(html).toContain('aria-label="Close settings"')
  })

  test('merges extra layout classes', () => {
    // Arrange
    const el = (
      <IconButton aria-label="Remove file" className="w-6 h-6 text-xs">
        ✕
      </IconButton>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('class="icon-btn w-6 h-6 text-xs"')
  })

  test('forwards disabled and title button attributes', () => {
    // Arrange
    const el = (
      <IconButton aria-label="Undo" title="Undo (⌘Z)" disabled>
        ↺
      </IconButton>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('disabled')
    expect(html).toContain('title="Undo (⌘Z)"')
  })

  test('aria-label is required at the type level', () => {
    // Arrange / Act / Assert — compile-time check enforced by `npm run typecheck`
    // @ts-expect-error — IconButton without aria-label must not typecheck
    const invalid = <IconButton>✕</IconButton>
    expect(invalid).toBeTruthy()
  })
})
