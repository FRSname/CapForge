/**
 * Static-markup test (node env, react-dom/server) for the always-mounted
 * onboarding host. Its effects never run here, so what is pinned is the one
 * thing that matters at every other moment of the app's life: when nothing is
 * due, it draws nothing at all, on any screen.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Screen } from '../../types/app'
import { StartupPrompts } from './StartupPrompts'

const SCREENS: Screen[] = ['library', 'file', 'progress', 'results']

describe('StartupPrompts', () => {
  test('renders nothing while no prompt and no tour is due', () => {
    for (const screen of SCREENS) {
      expect(renderToStaticMarkup(<StartupPrompts screen={screen} />)).toBe('')
    }
  })
})
