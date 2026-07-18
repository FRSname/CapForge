import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { VolumeControl } from './VolumeControl'

describe('VolumeControl', () => {
  test('renders an always-visible volume slider and percentage', () => {
    const html = renderToStaticMarkup(<VolumeControl volume={0.72} onVolumeChange={vi.fn()} />)

    expect(html).toContain('type="range"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="1"')
    expect(html).toContain('step="0.01"')
    expect(html).toContain('value="0.72"')
    expect(html).toContain('aria-valuetext="72%"')
    expect(html).toContain('ml-auto')
    expect(html).toContain('72%')
  })

  test('shows the muted icon at zero volume', () => {
    const html = renderToStaticMarkup(<VolumeControl volume={0} onVolumeChange={vi.fn()} />)

    expect(html).toContain('title="Volume: 0%"')
    expect(html).toContain('m11 6 3 4')
    expect(html).toContain('m14 6-3 4')
  })
})
