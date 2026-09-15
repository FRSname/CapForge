/**
 * The one platform question the library asks: can a single native dialog pick
 * files and folders together? Only macOS can (Electron shows a folder picker
 * elsewhere), and the check is `TitleBar.tsx`'s `navigator.platform` test.
 */

import { describe, expect, test } from 'vitest'
import { isMacPlatform } from './platform'

describe('isMacPlatform', () => {
  test.each(['MacIntel', 'MacPPC', 'Macintosh'])('%s is macOS', (platform) => {
    expect(isMacPlatform(platform)).toBe(true)
  })

  test.each(['Win32', 'Linux x86_64', 'linux', 'iPhone', '', 'mac'])('%j is not', (platform) => {
    expect(isMacPlatform(platform)).toBe(false)
  })

  test('an unknown platform is not macOS', () => {
    expect(isMacPlatform(undefined)).toBe(false)
    expect(isMacPlatform(null)).toBe(false)
  })
})
