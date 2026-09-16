/**
 * Starts the editor tour by itself, the first time there is a video to walk.
 *
 * The getting-around tour cannot show the editor, the player or the Publish
 * workspace, because on a fresh install none of them exist yet. So the second
 * tour waits for the results screen, which is reached either by transcribing
 * the first video or by opening a record.
 *
 * Once per install (`toursSeen`) and once per session (the ref), so a trip
 * back to the library and in again does not start it over.
 */

import { useEffect, useRef } from 'react'
import { FIRST_VIDEO_TOUR_ID, firstVideoTourDue } from '../lib/tourEngine'
import type { TourId } from '../lib/tourSteps'
import type { Screen } from '../types/app'

export interface FirstVideoTourInput {
  screen: Screen
  /** null while the stored list is still being read: not due yet. */
  seen: readonly TourId[] | null
  start: (id: TourId) => void
}

export function useFirstVideoTour({ screen, seen, start }: FirstVideoTourInput): void {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    if (!firstVideoTourDue(screen, seen)) return
    started.current = true
    start(FIRST_VIDEO_TOUR_ID)
  }, [screen, seen, start])
}
