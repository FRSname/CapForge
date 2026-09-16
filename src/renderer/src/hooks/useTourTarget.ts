/**
 * Finds the element a tour step points at, and keeps its box up to date.
 *
 * Finding it is not instant: three of the getting-around steps open a Settings
 * pane first, and that pane mounts a frame or two later, so the element is
 * polled for up to `TARGET_WAIT_MS` before the step gives up and shows its
 * card centred instead.
 *
 * Keeping it up to date is not free either: the results screen animates in,
 * the studio sidebar scrolls, and a window resize moves everything. A
 * `ResizeObserver` on the element catches its own size, capture-phase `scroll`
 * catches every scroller between it and the window, and a slow interval
 * catches the rest (a CSS transition reports neither).
 */

import { useEffect, useState } from 'react'
import type { Rect } from '../lib/tourPlacement'

/** How often the element is looked for while it is not there yet. */
const TARGET_POLL_MS = 100

/** How long to keep looking before the step is treated as targetless. */
const TARGET_WAIT_MS = 1500

/** How often a found element is re-measured, for movement nothing reports. */
const TRACK_INTERVAL_MS = 250

/** null: still looking (or nothing to look for). 'missing': gave up. */
export type TourTargetState = Rect | null | 'missing'

function toRect(el: Element): Rect {
  const box = el.getBoundingClientRect()
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

function sameRect(a: TourTargetState, b: Rect): boolean {
  if (!a || a === 'missing') return false
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

export function useTourTarget(target: string | undefined, active: boolean): TourTargetState {
  const [state, setState] = useState<TourTargetState>(null)

  // A new step starts from scratch. Adjusted during render rather than in an
  // effect (the React-documented way to reset state when a prop changes), so
  // the old step's box is never drawn around the new step's element.
  const key = active && target ? target : ''
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setState(null)
  }

  useEffect(() => {
    if (!key || typeof document === 'undefined') return

    let element: Element | null = null
    let observer: ResizeObserver | null = null
    let findTimer: ReturnType<typeof setInterval> | null = null
    let trackTimer: ReturnType<typeof setInterval> | null = null
    const deadline = Date.now() + TARGET_WAIT_MS

    function measure(): void {
      if (!element) return
      const rect = toRect(element)
      setState((previous) => (sameRect(previous, rect) ? previous : rect))
    }

    function attach(found: Element): void {
      element = found
      if (findTimer !== null) clearInterval(findTimer)
      findTimer = null
      found.scrollIntoView({ block: 'nearest' })
      measure()
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure)
        observer.observe(found)
      }
      trackTimer = setInterval(measure, TRACK_INTERVAL_MS)
      window.addEventListener('resize', measure)
      // Capture, so a scroll in any container between here and the window is seen.
      window.addEventListener('scroll', measure, true)
    }

    function look(): void {
      const found = document.querySelector(`[data-tour="${key}"]`)
      if (found && found.getClientRects().length > 0) {
        attach(found)
        return
      }
      if (Date.now() >= deadline) {
        if (findTimer !== null) clearInterval(findTimer)
        findTimer = null
        setState('missing')
      }
    }

    findTimer = setInterval(look, TARGET_POLL_MS)
    // One immediate attempt, after the browser has laid the step's screen out.
    const frame = requestAnimationFrame(look)

    return () => {
      cancelAnimationFrame(frame)
      if (findTimer !== null) clearInterval(findTimer)
      if (trackTimer !== null) clearInterval(trackTimer)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [key])

  return state
}
