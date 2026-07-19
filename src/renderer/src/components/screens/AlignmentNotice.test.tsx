import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { AlignmentNotice } from './AlignmentNotice'

describe('AlignmentNotice', () => {
  test('renders a persistent status when timings are degraded', () => {
    const html = renderToStaticMarkup(<AlignmentNotice visible />)

    expect(html).toContain('role="status"')
    expect(html).toContain('Approximate word timings')
    expect(html).toContain('karaoke timing may be less precise')
  })

  test('renders nothing for forced-aligned results', () => {
    expect(renderToStaticMarkup(<AlignmentNotice visible={false} />)).toBe('')
  })
})
