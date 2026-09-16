/**
 * Static-markup test (node env, react-dom/server) for the always-mounted
 * onboarding host. Its effects never run here, so what is pinned is the one
 * thing that matters at every other moment of the app's life: when nothing is
 * due, it draws nothing at all.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StartupPrompts } from './StartupPrompts'

describe('StartupPrompts', () => {
  test('renders nothing while no prompt is due', () => {
    expect(renderToStaticMarkup(<StartupPrompts active={false} />)).toBe('')
    expect(renderToStaticMarkup(<StartupPrompts active={true} />)).toBe('')
  })
})
