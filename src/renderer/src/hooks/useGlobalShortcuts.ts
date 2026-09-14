/**
 * The window-level shortcuts App owns: Save, Open, settings undo/redo and the
 * shortcut overlay.
 *
 * Moved out of `App.tsx` verbatim when the library screen landed (App is at its
 * size ceiling, §9.3). The behaviour is unchanged, including the two rules that
 * are easy to lose: a keystroke typed into an input/textarea/contentEditable is
 * ignored unless it carries the modifier, and Cmd+Z is *settings* undo only
 * outside a text editor — the editor has its own stack.
 */

import { useEffect } from 'react'

export interface GlobalShortcutHandlers {
  onSave: () => void
  onOpen: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleShortcutOverlay: () => void
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const { onSave, onOpen, onUndo, onRedo, onToggleShortcutOverlay } = handlers

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const tag = (e.target as HTMLElement).tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable && !mod) return

      if (mod && e.key === 's') {
        e.preventDefault()
        onSave()
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        onOpen()
      } else if (mod && e.key === 'z' && !editable) {
        e.preventDefault()
        if (e.shiftKey) onRedo()
        else onUndo()
      } else if (e.key === '?' && !mod) {
        // The editable guard above already swallowed `?` typed into inputs/
        // textareas/contentEditables (editable && !mod returns early).
        e.preventDefault()
        onToggleShortcutOverlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSave, onOpen, onUndo, onRedo, onToggleShortcutOverlay])
}
