/**
 * Stepping a tour, and the memory around it.
 *
 * Pure, so `useTour` only has to own the DOM query behind `present` and the
 * `app-state` read and write. The one rule with teeth: a step marked
 * `optional` whose target is not on screen is *skipped*, not centred, in both
 * directions, so the back button lands where Next came from.
 */

import type { Screen } from '../types/app'
import type { Tour, TourId } from './tourSteps'

/** "Is this step's target on screen right now?" A step with no target always is. */
export type TargetPresent = (target?: string) => boolean

/** The tour that starts by itself once a video is open. */
export const FIRST_VIDEO_TOUR_ID: TourId = 'first-video'

const TOUR_IDS: readonly TourId[] = ['getting-around', 'first-video']

function showable(tour: Tour, index: number, present: TargetPresent): boolean {
  const step = tour.steps[index]
  if (!step) return false
  if (!step.optional) return true
  return present(step.target)
}

function scan(tour: Tour, from: number, step: 1 | -1, present: TargetPresent): number | null {
  for (let i = from; i >= 0 && i < tour.steps.length; i += step) {
    if (showable(tour, i, present)) return i
  }
  return null
}

/** The first step worth showing, or null when a tour has nothing to say. */
export function firstIndex(tour: Tour, present: TargetPresent): number | null {
  return scan(tour, 0, 1, present)
}

/** The next showable step, or null when the tour is over. */
export function nextIndex(tour: Tour, index: number, present: TargetPresent): number | null {
  return scan(tour, index + 1, 1, present)
}

/** The previous showable step, or null when there is nothing behind this one. */
export function previousIndex(tour: Tour, index: number, present: TargetPresent): number | null {
  return scan(tour, index - 1, -1, present)
}

/** `seen` with `id` in it, without duplicating it and without mutating the input. */
export function stepSeen(seen: readonly TourId[], id: TourId): TourId[] {
  return seen.includes(id) ? [...seen] : [...seen, id]
}

/**
 * `app-state` is a JSON file a user can edit, so the stored list is validated
 * at the boundary rather than trusted: anything that is not a known tour id
 * is dropped, and anything that is not a list reads as "nothing seen".
 */
export function parseToursSeen(value: unknown): TourId[] {
  if (!Array.isArray(value)) return []
  const seen: TourId[] = []
  for (const entry of value) {
    const id = entry as TourId
    if (TOUR_IDS.includes(id) && !seen.includes(id)) seen.push(id)
  }
  return seen
}

/**
 * True the first time the results screen is shown on an install that has
 * never been walked through the editor. `null` means the stored list has not
 * been read yet, which is not the same as "empty".
 */
export function firstVideoTourDue(screen: Screen, seen: readonly TourId[] | null): boolean {
  if (seen === null) return false
  return screen === 'results' && !seen.includes(FIRST_VIDEO_TOUR_ID)
}
