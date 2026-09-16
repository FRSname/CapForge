/**
 * Which tour is running, and where in it.
 *
 * A thin shell: every rule about stepping lives in `lib/tourEngine.ts`, every
 * step's copy and actions in `lib/tourSteps.ts`, and the way a step drives the
 * app in `lib/tourNavigation.ts`. What is left here is the DOM query behind
 * "is this target on screen", the `app-state` read and write, and the two
 * ways a tour ends: the user says so, or the user leaves the screen it is about.
 *
 * A failed `app-state` read or write is a `console.warn`. The tour still runs;
 * the worst case is that it offers itself once more.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { firstIndex, nextIndex, parseToursSeen, previousIndex, stepSeen } from '../lib/tourEngine'
import type { TargetPresent } from '../lib/tourEngine'
import { runTourAction } from '../lib/tourNavigation'
import type { Tour, TourId, TourStep } from '../lib/tourSteps'
import { TOURS, TOUR_SEEN_KEY } from '../lib/tourSteps'
import type { Screen } from '../types/app'

export interface ActiveTour {
  tour: Tour
  index: number
}

export interface TourController {
  /** The running tour and step, or null. */
  active: ActiveTour | null
  /** The tours already walked; null while the stored list is being read. */
  seen: readonly TourId[] | null
  start: (id: TourId) => void
  next: () => void
  back: () => void
  end: () => void
}

/** True while focus is in something that consumes the arrow keys itself. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

async function readToursSeen(): Promise<TourId[]> {
  const bridge = window.subforge
  if (!bridge || typeof bridge.getState !== 'function') return []
  return parseToursSeen(await bridge.getState<unknown>(TOUR_SEEN_KEY, null))
}

function writeToursSeen(seen: readonly TourId[]): void {
  if (typeof window.subforge?.setState !== 'function') return
  void Promise.resolve(window.subforge.setState(TOUR_SEEN_KEY, [...seen])).catch((err: unknown) => {
    console.warn('[CapForge] Could not remember the tours seen:', err)
  })
}

/** Only an element that is laid out counts; a hidden aside has no client rects. */
const present: TargetPresent = (target) => {
  if (!target) return true
  if (typeof document === 'undefined') return false
  const el = document.querySelector(`[data-tour="${target}"]`)
  return el !== null && el.getClientRects().length > 0
}

interface Position {
  id: TourId
  index: number
}

export function useTour(context: { screen: Screen }): TourController {
  const [position, setPosition] = useState<Position | null>(null)
  const [seen, setSeen] = useState<TourId[] | null>(null)
  // Mirrors of the two states, written beside every `setState` below rather
  // than during render, so the callbacks can read the current values without
  // being rebuilt on every step.
  const positionRef = useRef<Position | null>(null)
  const seenRef = useRef<TourId[] | null>(null)
  /** The tour opened Settings and has to put it back. */
  const settingsOpened = useRef(false)

  useEffect(() => {
    let cancelled = false
    function remember(list: TourId[]): void {
      if (cancelled) return
      seenRef.current = list
      setSeen(list)
    }
    readToursSeen()
      .then(remember)
      .catch((err: unknown) => {
        console.warn('[CapForge] Could not read the tours seen:', err)
        remember([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runBefore = useCallback((step: TourStep) => {
    for (const action of step.before ?? []) {
      if (action.kind === 'open-settings') settingsOpened.current = true
      if (action.kind === 'close-settings') settingsOpened.current = false
      runTourAction(action)
    }
  }, [])

  const end = useCallback(() => {
    const current = positionRef.current
    positionRef.current = null
    setPosition(null)
    if (settingsOpened.current) {
      settingsOpened.current = false
      runTourAction({ kind: 'close-settings' })
    }
    if (!current) return
    const next = stepSeen(seenRef.current ?? [], current.id)
    seenRef.current = next
    setSeen(next)
    writeToursSeen(next)
  }, [])

  const start = useCallback(
    (id: TourId) => {
      const tour = TOURS[id]
      const index = firstIndex(tour, present)
      if (index === null) return
      runBefore(tour.steps[index])
      positionRef.current = { id, index }
      setPosition({ id, index })
    },
    [runBefore]
  )

  const step = useCallback(
    (pick: typeof nextIndex, onExhausted?: () => void) => {
      const current = positionRef.current
      if (!current) return
      const tour = TOURS[current.id]
      const index = pick(tour, current.index, present)
      if (index === null) {
        onExhausted?.()
        return
      }
      runBefore(tour.steps[index])
      positionRef.current = { id: current.id, index }
      setPosition({ id: current.id, index })
    },
    [runBefore]
  )

  const next = useCallback(() => step(nextIndex, end), [step, end])
  const back = useCallback(() => step(previousIndex), [step])

  // Leaving the screen a tour is about ends it, quietly and for good: it is
  // marked seen, so it does not ambush the user again on the way back. The
  // overlay is already gone by then (`active` below is derived), so this is
  // only the bookkeeping, and it is deferred by a microtask: on the way from
  // the library to the results screen, `useFirstVideoTour` starts the editor
  // tour in this very commit, and ending must not reach across and end that.
  useEffect(() => {
    if (!position) return
    if (TOURS[position.id].screen === context.screen) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || positionRef.current?.id !== position.id) return
      end()
    })
    return () => {
      cancelled = true
    }
  }, [position, context.screen, end])

  useEffect(() => {
    if (!position) return
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        end()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [position, end, next, back])

  // Derived, not corrected by an effect: the moment the screen stops matching,
  // the overlay stops drawing, with no frame in between.
  const active = useMemo<ActiveTour | null>(() => {
    if (!position) return null
    const tour = TOURS[position.id]
    return tour.screen === context.screen ? { tour, index: position.index } : null
  }, [position, context.screen])

  return { active, seen, start, next, back, end }
}
