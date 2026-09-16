/**
 * ⌘O / Ctrl+O on the library screen is Import…. The node test environment has
 * no key events, so the two decisions are pinned as pure functions: which
 * keystroke counts, and which picker it opens on each platform.
 */

import { describe, expect, test } from 'vitest'
import { importShortcutMode, isImportShortcut } from './useLibraryImportShortcut'

const key = (overrides: Partial<Parameters<typeof isImportShortcut>[0]>) => ({
  key: 'o',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
})

describe('isImportShortcut', () => {
  test('⌘O and Ctrl+O count', () => {
    expect(isImportShortcut(key({ metaKey: true }))).toBe(true)
    expect(isImportShortcut(key({ ctrlKey: true }))).toBe(true)
  })

  test('a bare O (typed in the search field) does not', () => {
    expect(isImportShortcut(key({}))).toBe(false)
  })

  test('another letter, or O with Shift or Alt, does not', () => {
    expect(isImportShortcut(key({ metaKey: true, key: 'p' }))).toBe(false)
    expect(isImportShortcut(key({ metaKey: true, key: 'O', shiftKey: true }))).toBe(false)
    expect(isImportShortcut(key({ metaKey: true, altKey: true }))).toBe(false)
  })
})

describe('importShortcutMode', () => {
  test('macOS opens the combined file-or-folder picker', () => {
    expect(importShortcutMode('MacIntel')).toBe('any')
  })

  test('Windows and Linux, where Import… is a Files… / Folder… menu, pick files', () => {
    expect(importShortcutMode('Win32')).toBe('files')
    expect(importShortcutMode('Linux x86_64')).toBe('files')
    expect(importShortcutMode(undefined)).toBe('files')
  })
})
