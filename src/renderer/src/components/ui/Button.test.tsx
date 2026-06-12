/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom), so we assert on the HTML the primitive produces.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from './Button'

describe('Button', () => {
  test('renders btn-primary class by default', () => {
    // Arrange
    const el = <Button>Go</Button>

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('class="btn-primary"')
    expect(html).toContain('>Go</button>')
  })

  test.each([
    ['primary', 'btn-primary'],
    ['ghost', 'btn-ghost'],
    ['danger', 'btn-danger'],
    ['titlebar', 'titlebar-btn'],
  ] as const)('maps variant %s to class %s', (variant, expected) => {
    // Arrange
    const el = (
      <Button variant={variant}>x</Button>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain(`class="${expected}"`)
  })

  test('merges extra layout classes after the variant class', () => {
    // Arrange
    const el = (
      <Button variant="ghost" className="flex-1 text-xs justify-center">
        Open
      </Button>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('class="btn-ghost flex-1 text-xs justify-center"')
  })

  test('defaults to type="button" but allows override', () => {
    // Arrange / Act
    const def = renderToStaticMarkup(<Button>x</Button>)
    const submit = renderToStaticMarkup(<Button type="submit">x</Button>)

    // Assert
    expect(def).toContain('type="button"')
    expect(submit).toContain('type="submit"')
  })

  test('loading disables the button and sets aria-busy', () => {
    // Arrange
    const el = (
      <Button loading>Rendering…</Button>
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
  })

  test('not loading omits aria-busy and disabled', () => {
    // Arrange
    const el = <Button>Render</Button>

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).not.toContain('aria-busy')
    expect(html).not.toContain('disabled')
  })
})
