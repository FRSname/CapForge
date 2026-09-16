/**
 * The library's keys: what each one means on macOS and elsewhere, and when the
 * contents must leave a key alone (a text field, a dialog, a menu).
 */

import { describe, expect, test } from 'vitest'
import type { KeyInput } from './libraryKeyboard'
import {
  isEditableTarget,
  isEmptySpaceClick,
  keyOriginOf,
  libraryKeyAction,
  libraryTakesKey,
} from './libraryKeyboard'

function key(value: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { key: value, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }
}

describe('libraryKeyAction', () => {
  test('⌘A on macOS, Ctrl+A elsewhere, selects all', () => {
    expect(libraryKeyAction(key('a', { metaKey: true }), true)).toEqual({ kind: 'select-all' })
    expect(libraryKeyAction(key('a', { ctrlKey: true }), false)).toEqual({ kind: 'select-all' })
    expect(libraryKeyAction(key('A', { ctrlKey: true }), false)).toEqual({ kind: 'select-all' })
  })

  test('the other platform’s modifier does not select all', () => {
    expect(libraryKeyAction(key('a', { ctrlKey: true }), true)).toBeNull()
    expect(libraryKeyAction(key('a', { metaKey: true }), false)).toBeNull()
    expect(libraryKeyAction(key('a'), true)).toBeNull()
  })

  test('⌘⌫ / Ctrl+Backspace removes; a bare Backspace does nothing', () => {
    expect(libraryKeyAction(key('Backspace', { metaKey: true }), true)).toEqual({ kind: 'remove' })
    expect(libraryKeyAction(key('Backspace', { ctrlKey: true }), false)).toEqual({
      kind: 'remove',
    })
    expect(libraryKeyAction(key('Backspace'), true)).toBeNull()
  })

  test('the Delete key removes on Windows and Linux, not on macOS', () => {
    expect(libraryKeyAction(key('Delete'), false)).toEqual({ kind: 'remove' })
    expect(libraryKeyAction(key('Delete'), true)).toBeNull()
  })

  test('Esc clears and Enter opens', () => {
    expect(libraryKeyAction(key('Escape'), true)).toEqual({ kind: 'clear' })
    expect(libraryKeyAction(key('Enter'), false)).toEqual({ kind: 'open' })
  })

  test.each([
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['Home', 'home'],
    ['End', 'end'],
  ] as const)('%s moves %s, and Shift extends', (value, direction) => {
    expect(libraryKeyAction(key(value), true)).toEqual({ kind: 'move', direction, extend: false })
    expect(libraryKeyAction(key(value, { shiftKey: true }), false)).toEqual({
      kind: 'move',
      direction,
      extend: true,
    })
  })

  test('⌘O and every other chord is left to others', () => {
    expect(libraryKeyAction(key('o', { metaKey: true }), true)).toBeNull()
    expect(libraryKeyAction(key('ArrowDown', { metaKey: true }), true)).toBeNull()
    expect(libraryKeyAction(key('ArrowDown', { altKey: true }), true)).toBeNull()
    expect(libraryKeyAction(key('Enter', { shiftKey: true }), true)).toBeNull()
    expect(libraryKeyAction(key('x'), true)).toBeNull()
  })
})

describe('when the contents take a key', () => {
  const quiet = { modalOpen: false, menuOpen: false }

  test.each(['INPUT', 'TEXTAREA', 'SELECT', 'input'])('never from a %s', (tagName) => {
    expect(isEditableTarget({ tagName })).toBe(true)
    expect(libraryTakesKey({ tagName }, quiet)).toBe(false)
  })

  test('never from contenteditable', () => {
    expect(libraryTakesKey({ tagName: 'DIV', isContentEditable: true }, quiet)).toBe(false)
  })

  test('from an item or the container', () => {
    expect(libraryTakesKey({ tagName: 'BUTTON' }, quiet)).toBe(true)
    expect(libraryTakesKey({ tagName: 'TR' }, quiet)).toBe(true)
    expect(libraryTakesKey(null, quiet)).toBe(true)
  })

  test('never while a dialog or a menu is open', () => {
    expect(libraryTakesKey({ tagName: 'BUTTON' }, { modalOpen: true, menuOpen: false })).toBe(false)
    expect(libraryTakesKey({ tagName: 'BUTTON' }, { modalOpen: false, menuOpen: true })).toBe(false)
  })
})

describe('isEmptySpaceClick', () => {
  const at = (hit: boolean) => ({ closest: () => (hit ? {} : null) })

  test('a click that is on nothing clears', () => {
    expect(isEmptySpaceClick(at(false))).toBe(true)
  })

  test('a click on an item, a control or a menu does not', () => {
    expect(isEmptySpaceClick(at(true))).toBe(false)
    expect(isEmptySpaceClick(null)).toBe(false)
  })

  test('asks about items, controls, menus and the list header', () => {
    const asked: string[] = []
    isEmptySpaceClick({ closest: (selector: string) => asked.push(selector) && null })
    expect(asked[0]).toContain('[data-library-item]')
    expect(asked[0]).toContain('button')
    expect(asked[0]).toContain('[role="menu"]')
    expect(asked[0]).toContain('thead')
  })
})

describe('keyOriginOf', () => {
  const hitting = (attribute: string | null) => ({
    closest: () => ({ getAttribute: () => attribute }),
  })

  test('an item element names its key', () => {
    expect(keyOriginOf(hitting('v:abc'))).toEqual({ kind: 'item', key: 'v:abc' })
  })

  test('another control is a control', () => {
    expect(keyOriginOf(hitting(null))).toEqual({ kind: 'control' })
  })

  test('nothing around it is the container', () => {
    expect(keyOriginOf({ closest: () => null })).toEqual({ kind: 'container' })
    expect(keyOriginOf(null)).toEqual({ kind: 'container' })
  })
})
