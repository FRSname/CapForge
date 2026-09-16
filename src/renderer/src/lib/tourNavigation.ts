/**
 * How a tour step drives the app to the screen it is about.
 *
 * Settings already has a listener-set seam (`settingsNavigation.ts`), so
 * opening and closing it goes through that. The workspace toggle lives in
 * App's `usePublishWorkspace`, which nothing else can reach, so App registers
 * one navigator here (`hooks/useTourNavigator.ts`) and the tour calls it.
 *
 * One navigator at a time: there is one App. A missing one is a warning, not
 * a throw, because a step that cannot run its action must still show its card.
 */

import { requestSettingsCategory, requestSettingsClose } from './settingsNavigation'
import type { TourAction } from './tourSteps'
import type { Workspace } from '../types/app'

export interface TourNavigator {
  setWorkspace: (workspace: Workspace) => void
}

let current: TourNavigator | null = null

/**
 * Register App's navigator; the returned function unregisters it, but only
 * while it is still the registered one (a remount registers before the old
 * effect cleans up).
 */
export function registerTourNavigator(nav: TourNavigator): () => void {
  current = nav
  return () => {
    if (current === nav) current = null
  }
}

/** Run one step's `before` action. Never throws. */
export function runTourAction(action: TourAction): void {
  switch (action.kind) {
    case 'open-settings':
      if (!requestSettingsCategory(action.category)) {
        console.warn('[CapForge] Tour could not open Settings: nothing is listening.')
      }
      return
    case 'close-settings':
      if (!requestSettingsClose()) {
        console.warn('[CapForge] Tour could not close Settings: nothing is listening.')
      }
      return
    case 'set-workspace':
      if (!current) {
        console.warn('[CapForge] Tour could not switch workspace: no navigator is registered.')
        return
      }
      current.setWorkspace(action.workspace)
  }
}
