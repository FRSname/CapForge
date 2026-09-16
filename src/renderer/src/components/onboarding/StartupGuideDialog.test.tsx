/**
 * Static-markup tests (node env, react-dom/server) for the startup guide.
 *
 * There are no DOM events here, so only the first step can be rendered: the
 * later steps' copy is pinned by `lib/startupGuide.test.ts`, and what this
 * file checks is the frame around it (the counter, the dot rail, the buttons).
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GUIDE_STEPS } from '../../lib/startupGuide'
import { StartupGuideDialog } from './StartupGuideDialog'

function dialog(open = true): string {
  return renderToStaticMarkup(
    <StartupGuideDialog
      open={open}
      onClose={() => {}}
      onOpenSettings={() => {}}
      onOpenUrl={() => {}}
    />
  )
}

describe('StartupGuideDialog', () => {
  test('closed renders nothing', () => {
    expect(dialog(false)).toBe('')
  })

  test('opens on step 1, with its title and paragraphs', () => {
    const html = dialog()
    expect(html).toContain('Welcome to CapForge')
    expect(html).toContain(`Step 1 of ${GUIDE_STEPS.length}`)
    expect(html).toContain(GUIDE_STEPS[0].title)
    for (const paragraph of GUIDE_STEPS[0].paragraphs) {
      expect(html).toContain(paragraph)
    }
  })

  test('the dot rail has one button per step, the first one current', () => {
    const html = dialog()
    const dots = html.match(/aria-label="Step \d+"/g) ?? []
    expect(dots).toHaveLength(GUIDE_STEPS.length)
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('var(--color-brand)')
  })

  test('step 1 can go forward or skip, but not back', () => {
    const html = dialog()
    expect(html).toContain('Next')
    expect(html).toContain('Skip')
    expect(html).toMatch(/Back/)
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('Get started')
  })

  test('the tutorial line sits under the footer', () => {
    const html = dialog()
    expect(html).toContain('Prefer to watch?')
    expect(html).toContain('Watch the tutorial')
    expect(html).toContain('Open in browser')
  })

  test('the video is click to load, so opening the guide loads nothing', () => {
    expect(dialog()).not.toContain('<iframe')
  })

  test('the first step has no action button of its own', () => {
    expect(GUIDE_STEPS[0].action).toBeUndefined()
  })

  test('theme colours only', () => {
    const html = dialog()
    expect(html).toContain('var(--cf-font-display)')
    expect(html).not.toContain('text-white')
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
