/**
 * Close a popup on Esc or on a press outside it — the library's menus (a
 * folder's, a card's right-click menu, the selection's) and the selection
 * bar's "Move to…" picker. `ref` should wrap whatever opens the popup too, so
 * pressing the opener toggles it instead of closing and reopening it.
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useDismiss(ref: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, close])
}
