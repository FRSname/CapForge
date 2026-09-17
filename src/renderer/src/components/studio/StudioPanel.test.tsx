/**
 * Static-markup tests (node env, `react-dom/server`) for StudioPanel's header
 * slot: the panel's own label by default, whatever the aside hands it when the
 * workspace toggle rides there instead (docs/plans/ux-ui-refresh.md §4).
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioPanel } from './StudioPanel'

describe('StudioPanel header title', () => {
  test('falls back to the "Custom Settings" label when no title is given', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(<StudioPanel />)

    // Assert
    expect(html).toContain('<span class="label-xs">Custom Settings</span>')
  })

  test('renders the title the aside hands it in place of the label', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(
      <StudioPanel title={<span data-testid="aside-title">Workspace switch</span>} />
    )

    // Assert
    expect(html).toContain('Workspace switch')
    expect(html).not.toContain('<span class="label-xs">Custom Settings</span>')
  })
})
