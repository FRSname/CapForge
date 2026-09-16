/**
 * App's one line of the tour: registering how the tour switches the workspace.
 *
 * The `Captions | Publish` toggle lives in App's `usePublishWorkspace` and
 * nothing outside App can reach it, so App registers a navigator and
 * `lib/tourNavigation.ts` calls it. Settings needs no such thing; it already
 * has the `settingsNavigation.ts` seam.
 */

import { useEffect } from 'react'
import { registerTourNavigator } from '../lib/tourNavigation'
import type { TourNavigator } from '../lib/tourNavigation'

export function useTourNavigator({ setWorkspace }: TourNavigator): void {
  // Keyed on the function, not on App's inline object: `setWorkspace` is a
  // `useState` setter, so this registers once and stays registered.
  useEffect(() => registerTourNavigator({ setWorkspace }), [setWorkspace])
}
