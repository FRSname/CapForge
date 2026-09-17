/**
 * The TitleBar's "Library" button — the way home that, unlike New, resets
 * nothing: the session and `activeVideoId` stay exactly as they are, and the
 * Continue hero (or the card) reopens the record through `openRecord`.
 *
 * Pure module: no React, no `window`. `hooks/useScreenNavigation.ts` binds it.
 */

import type { Screen } from '../types/app'

/**
 * Where **New** lands. New starts a fresh transcription, so it goes to the
 * transcribe (drop) screen, not home: from the editor the library is one
 * click away on its own button, and a click on New means "another file".
 */
export const NEW_SESSION_SCREEN: Screen = 'file'

/**
 * Where the button is offered. Not on the library (already there) and not on
 * `progress` — leaving mid-transcription would strand the running job.
 */
const LIBRARY_BUTTON_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['file', 'results'])

export function libraryButtonVisible(screen: Screen): boolean {
  return LIBRARY_BUTTON_SCREENS.has(screen)
}

/**
 * What a click does. The editor flushes the pending record autosave first so
 * the snapshot the library reopens is current; a chosen-but-unstarted file has
 * no session to save.
 */
export type GoToLibraryPlan = 'flush-then-library' | 'library' | 'stay'

export function planGoToLibrary(screen: Screen): GoToLibraryPlan {
  if (screen === 'results') return 'flush-then-library'
  if (screen === 'file') return 'library'
  return 'stay'
}

/** The flush rejected — even the local fallback copy could not be written. */
export function libraryFlushFailedMessage(reason: string): string {
  return `Could not save the latest changes before returning to the library (${reason}) — the session is still open.`
}

export interface GoToLibraryInput {
  screen: Screen
  /** Writes the pending autosave now; rejects only when nothing could be saved. */
  flush: () => Promise<void>
  showLibrary: () => void
  notify: (message: string) => void
}

/**
 * Flush (when there is a session), then show the library. A failed flush is
 * reported, never swallowed, and never blocks the navigation: the session is
 * still in memory, so nothing is lost by going home.
 */
export async function goToLibrary(input: GoToLibraryInput): Promise<GoToLibraryPlan> {
  const plan = planGoToLibrary(input.screen)
  if (plan === 'stay') return plan
  if (plan === 'flush-then-library') {
    try {
      await input.flush()
    } catch (err) {
      input.notify(libraryFlushFailedMessage(err instanceof Error ? err.message : String(err)))
    }
  }
  input.showLibrary()
  return plan
}
