/**
 * What a key means on the library's contents (docs/plans/library-finder.md
 * §4.4), and when the contents may take a key at all.
 *
 * The keys are handled on the contents container, never on `window`, and are
 * refused when the event comes from a text field (the rename input) or while a
 * dialog or a menu owns the keyboard: Settings, the "Publish to:" sheet, a
 * folder's or a card's menu. ⌘O is not handled here (`useLibraryImportShortcut`).
 *
 * Pure module: the hook reads the event and the document and passes plain
 * values in.
 */

import type { MoveDirection } from './libraryNavigation'
import type { KeyOrigin } from './librarySelection'

export type LibraryKeyAction =
  | { kind: 'move'; direction: MoveDirection; extend: boolean }
  | { kind: 'select-all' }
  | { kind: 'clear' }
  | { kind: 'open' }
  | { kind: 'remove' }

export interface KeyInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const ARROWS: Readonly<Record<string, MoveDirection>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
}

/** The action a key stands for, or null when it is not the library's. */
export function libraryKeyAction(e: KeyInput, mac: boolean): LibraryKeyAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  const otherMod = mac ? e.ctrlKey : e.metaKey
  if (e.altKey || otherMod) return null
  if (mod) {
    if (!e.shiftKey && e.key.toLowerCase() === 'a') return { kind: 'select-all' }
    if (!e.shiftKey && e.key === 'Backspace') return { kind: 'remove' }
    return null
  }
  const direction = ARROWS[e.key]
  if (direction) return { kind: 'move', direction, extend: e.shiftKey }
  if (e.shiftKey) return null
  if (e.key === 'Escape') return { kind: 'clear' }
  if (e.key === 'Enter') return { kind: 'open' }
  // The Delete key: Windows and Linux only (on a Mac it is fn+⌫, a forward delete).
  if (e.key === 'Delete' && !mac) return { kind: 'remove' }
  return null
}

export interface KeyTarget {
  tagName?: string
  isContentEditable?: boolean
}

const TEXT_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isEditableTarget(target: KeyTarget | null | undefined): boolean {
  if (!target) return false
  return TEXT_TAGS.has((target.tagName ?? '').toUpperCase()) || target.isContentEditable === true
}

export interface KeyContext {
  /** A `[aria-modal="true"]` dialog is open (Settings, the "Publish to:" sheet). */
  modalOpen: boolean
  /** A `[role="menu"]` is open (a folder's or a card's menu). */
  menuOpen: boolean
}

export function libraryTakesKey(
  target: KeyTarget | null | undefined,
  context: KeyContext
): boolean {
  return !isEditableTarget(target) && !context.modalOpen && !context.menuOpen
}

/** Marks a grid section (folders, videos), whose computed columns the keyboard reads. */
export const GRID_SECTION_ATTRIBUTE = 'data-library-grid'

/** Marks an item's focusable element; its value is the item key. */
export const ITEM_ATTRIBUTE = 'data-library-item'

/**
 * A click the contents clear the selection on: not on an item, a control, a
 * menu or the list's headers — empty space.
 */
export const NOT_EMPTY_SPACE_SELECTOR = `[${ITEM_ATTRIBUTE}], button, a, input, select, textarea, [role="menu"], thead`

export function isEmptySpaceClick(
  target: { closest: (selector: string) => unknown } | null | undefined
): boolean {
  if (!target) return false
  return !target.closest(NOT_EMPTY_SPACE_SELECTOR)
}

/** The nearest item or control around a key's target decides where it was pressed. */
export const KEY_ORIGIN_SELECTOR = `[${ITEM_ATTRIBUTE}], button, a, input, select, textarea`

export interface OriginTarget {
  closest: (selector: string) => { getAttribute: (name: string) => string | null } | null
}

export function keyOriginOf(target: OriginTarget | null | undefined): KeyOrigin {
  const hit = target?.closest(KEY_ORIGIN_SELECTOR) ?? null
  if (!hit) return { kind: 'container' }
  const key = hit.getAttribute(ITEM_ATTRIBUTE)
  return key ? { kind: 'item', key } : { kind: 'control' }
}
