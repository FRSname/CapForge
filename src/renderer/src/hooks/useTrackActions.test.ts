/**
 * The §G-2 font hint is the one piece of `useTrackActions` that is pure, and
 * the one whose *silence* matters: it must not fire on a working setup, because
 * a hint that cries wolf on every new track is worse than none.
 *
 * The hook itself is not exercised here — the vitest environment is plain node,
 * so there is no renderer to mount a hook in.
 */

import { describe, expect, test } from 'vitest'
import { bundledFontHint } from './useTrackActions'
import type { FontInfo } from '../lib/fonts'

const FONTS: FontInfo[] = [
  { name: 'Coolvetica Rg', path: '/app/Fonts/Coolvetica Rg.otf', source: 'bundled' },
  { name: 'Helvetica Neue', path: '', source: 'system' },
  { name: 'My Brand Face', path: '/Users/x/fonts/brand.otf', source: 'custom' },
]

describe('bundledFontHint', () => {
  test('warns when a non-Latin language inherits a bundled display face', () => {
    // Arrange / Act
    const hint = bundledFontHint('ru', 'Coolvetica Rg', FONTS)

    // Assert
    expect(hint).toContain('Russian')
    expect(hint).toContain('Typography')
  })

  test('treats the empty font name as the bundled default', () => {
    // Arrange / Act / Assert — "" is CapForge's own face, not a system font.
    expect(bundledFontHint('el', '', FONTS)).not.toBeNull()
  })

  test('stays silent for a Latin-script language', () => {
    // Arrange / Act / Assert
    expect(bundledFontHint('pl', 'Coolvetica Rg', FONTS)).toBeNull()
    expect(bundledFontHint('vi', '', FONTS)).toBeNull()
  })

  test('stays silent when the copied font is a system or user font', () => {
    // Arrange / Act / Assert
    expect(bundledFontHint('ja', 'Helvetica Neue', FONTS)).toBeNull()
    expect(bundledFontHint('ja', 'My Brand Face', FONTS)).toBeNull()
  })

  test('stays silent when the font cannot be resolved at all', () => {
    // Arrange / Act / Assert — an unknown name is not evidence of a bundled face.
    expect(bundledFontHint('ar', 'Something Uninstalled', FONTS)).toBeNull()
  })

  test('an unknown language code is treated as non-Latin', () => {
    // Arrange / Act / Assert — `languageScript` never guesses "latin" (see
    // lib/languages.ts), because guessing wrong suppresses the useful hint.
    expect(bundledFontHint('xx', '', FONTS)).not.toBeNull()
  })
})
