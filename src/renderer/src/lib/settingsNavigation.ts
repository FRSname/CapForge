/**
 * "Open Settings on this category", from anywhere in the renderer.
 *
 * The Settings dialog is mounted once, at the App root, and App.tsx is at its
 * size ceiling — so instead of threading an `openSettings(category)` prop down
 * to every card that wants a "Manage…" link, the always-mounted dialog
 * subscribes here and a card calls `requestSettingsCategory`. A plain listener
 * set: no `window`, no DOM events, testable in the node environment.
 */

import type { AppSettingsCategoryId } from './appSettingsIndex'

/** What to show once the category is open. */
export interface SettingsFocus {
  /** Settings → Folders: select this folder (a collection id). */
  collectionId?: string
}

type Listener = (category: AppSettingsCategoryId, focus: SettingsFocus) => void

const listeners = new Set<Listener>()

/**
 * Ask Settings to open on `category`, optionally on one thing inside it (the
 * library's "Folder settings…" selects its folder). Returns false when nothing
 * is listening (the dialog is not mounted), so the caller can say where to go
 * instead.
 */
export function requestSettingsCategory(
  category: AppSettingsCategoryId,
  focus: SettingsFocus = {}
): boolean {
  if (listeners.size === 0) return false
  for (const listener of [...listeners]) listener(category, focus)
  return true
}

/** Subscribe; the returned function unsubscribes. */
export function onSettingsCategoryRequested(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
