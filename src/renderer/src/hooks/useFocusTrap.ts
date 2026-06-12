/**
 * Minimal hand-rolled focus trap for modal surfaces (no dependency).
 *
 * While `active`:
 *   - on activation, focus moves to the first focusable element in the
 *     container (or the container itself when nothing is focusable)
 *   - Tab / Shift+Tab cycle within the container's focusable elements
 *   - on deactivation/unmount, focus is restored to the previously-focused
 *     element
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'

export const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Focusable descendants, filtered for disabled/invisible elements. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  )
}

/**
 * Pure cycle logic: the index Tab should jump to, or null when the browser's
 * native focus order should proceed (focus stays inside the container).
 * `currentIndex === -1` means focus is outside the container — pull it back in.
 */
export function nextTrapIndex(
  count: number,
  currentIndex: number,
  shiftKey: boolean
): number | null {
  if (count === 0) return null
  if (currentIndex === -1) return shiftKey ? count - 1 : 0
  if (shiftKey && currentIndex === 0) return count - 1
  if (!shiftKey && currentIndex === count - 1) return 0
  return null
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean = true): void {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previous = document.activeElement as HTMLElement | null

    // Initial focus: first focusable element, else the container itself.
    const focusables = getFocusable(container)
    if (focusables.length > 0) {
      focusables[0].focus()
    } else {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
      container.focus()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return
      const items = getFocusable(container)
      const current = document.activeElement as HTMLElement | null
      const currentIndex = current ? items.indexOf(current) : -1
      const next = nextTrapIndex(items.length, currentIndex, e.shiftKey)
      if (next !== null) {
        e.preventDefault()
        items[next]?.focus()
      } else if (items.length === 0) {
        // Nothing focusable — keep focus pinned on the container.
        e.preventDefault()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [ref, active])
}
