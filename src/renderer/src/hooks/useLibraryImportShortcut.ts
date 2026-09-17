/**
 * ⌘O / Ctrl+O on the library screen: Add to library… (docs/plans/library-finder.md
 * §3.1). It replaced the title bar's Open, which is gone.
 *
 * Mounted by `LibraryHome`, which exists only while the library screen is on
 * show, so on every other screen the keystroke does nothing — nothing listens.
 * It opens the same picker the toolbar's Add to library… does: the combined
 * file-or-folder dialog on macOS; on Windows and Linux, where that button is a
 * Files… / Folder… menu, the **Files…** picker (media and `.capforge`
 * projects, the closest thing to the old Open).
 *
 * The modifier is required, so an "o" typed into the search field never fires.
 */

import { useEffect, useRef } from 'react'
import type { ImportPickMode } from '../lib/libraryImport'
import { isMacPlatform } from '../lib/platform'

type ShortcutKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

export function isImportShortcut(e: ShortcutKey): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'o'
}

/** The picker the shortcut opens on this platform. */
export function importShortcutMode(platform: string | null | undefined): ImportPickMode {
  return isMacPlatform(platform) ? 'any' : 'files'
}

export interface LibraryImportShortcutInput {
  onImport: (mode: ImportPickMode) => void
  /** False while something modal (the "Publish to:" sheet) owns the screen. */
  enabled: boolean
}

export function useLibraryImportShortcut({ onImport, enabled }: LibraryImportShortcutInput): void {
  const onImportRef = useRef(onImport)
  useEffect(() => {
    onImportRef.current = onImport
  })

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (!isImportShortcut(e)) return
      e.preventDefault()
      onImportRef.current(importShortcutMode(navigator.platform))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
