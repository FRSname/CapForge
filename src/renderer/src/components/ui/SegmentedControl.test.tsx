/**
 * Render tests via react-dom/server static markup — the vitest environment is
 * plain node (no jsdom). Markup assertions cover the radiogroup semantics and
 * roving tabIndex; the arrow-key selection logic is exercised through the pure
 * nextOptionValue helper that handleKeyDown delegates to.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SegmentedControl, nextOptionValue } from './SegmentedControl'

const OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'reels', label: 'Reels' },
] as const

const noop = () => {}

describe('SegmentedControl', () => {
  test('renders a radiogroup with one radio per option', () => {
    // Arrange
    const el = (
      <SegmentedControl options={OPTIONS} value="off" onChange={noop} ariaLabel="Safe zones" />
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Safe zones"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toContain('>Off<')
    expect(html).toContain('>TikTok<')
    expect(html).toContain('>Reels<')
  })

  test('selected option is aria-checked with the active styling', () => {
    // Arrange
    const el = <SegmentedControl options={OPTIONS} value="tiktok" onChange={noop} />

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2)
    expect(html).toContain('bg-[var(--color-accent)] text-white')
  })

  test('roving tabIndex: selected radio is 0, others are -1', () => {
    // Arrange
    const el = <SegmentedControl options={OPTIONS} value="reels" onChange={noop} />

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2)
  })

  test('container keeps the original pixel-identical classes and merges layout classes', () => {
    // Arrange
    const el = (
      <SegmentedControl options={OPTIONS} value="off" onChange={noop} className="flex-1 min-w-0" />
    )

    // Act
    const html = renderToStaticMarkup(el)

    // Assert
    expect(html).toContain(
      'class="flex rounded-md overflow-hidden border border-[var(--color-border)] flex-1 min-w-0"'
    )
  })
})

describe('nextOptionValue (ArrowLeft/ArrowRight selection logic)', () => {
  test('ArrowRight moves to the next option', () => {
    // Arrange / Act
    const next = nextOptionValue(OPTIONS, 'off', 1)

    // Assert
    expect(next).toBe('tiktok')
  })

  test('ArrowLeft moves to the previous option', () => {
    // Arrange / Act
    const next = nextOptionValue(OPTIONS, 'reels', -1)

    // Assert
    expect(next).toBe('tiktok')
  })

  test('wraps from last to first going right', () => {
    expect(nextOptionValue(OPTIONS, 'reels', 1)).toBe('off')
  })

  test('wraps from first to last going left', () => {
    expect(nextOptionValue(OPTIONS, 'off', -1)).toBe('reels')
  })

  test('unknown current value falls back to the first option', () => {
    expect(nextOptionValue(OPTIONS, 'bogus' as (typeof OPTIONS)[number]['value'], 1)).toBe('off')
  })

  test('empty options return the current value unchanged', () => {
    expect(nextOptionValue([], 'off', 1)).toBe('off')
  })
})
