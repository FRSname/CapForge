/**
 * Pure, DOM/canvas-free zoom/pan/snap/time↔pixel math extracted from useTimeline.ts.
 * Moved verbatim (same order of float operations) so it can be unit-pinned
 * independently of canvas rendering and mouse-event plumbing.
 */

/** Pick a "nice" ruler tick step (seconds) so major ticks land ~80px apart. */
export function niceStep(duration: number, widthPx: number): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const ideal = duration / (widthPx / 80)
  for (const s of steps) {
    if (s >= ideal) return s
  }
  return steps[steps.length - 1]
}

/** Nearest target within thresholdT of t, or null when nothing is close enough. */
export function nearestSnap(t: number, targets: number[], thresholdT: number): number | null {
  let best: number | null = null
  let bestDist = thresholdT
  for (const target of targets) {
    const dist = Math.abs(t - target)
    if (dist < bestDist) {
      bestDist = dist
      best = target
    }
  }
  return best
}

/** Pixels-per-second scale for a given pixel width and visible time window. */
export function computePixelsPerSecond(widthPx: number, visibleDur: number): number {
  return widthPx / visibleDur
}

/** Seconds → x pixel offset within the visible window (t0 = window start time). */
export function timeToPixel(t: number, t0: number, pps: number): number {
  return (t - t0) * pps
}

/** Client X pixel → seconds, clamped to the visible window (ratio in [0,1]). */
export function clientXToTime(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  scrollT: number,
  visibleDur: number
): number {
  const ratio = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth))
  return scrollT + ratio * visibleDur
}

/** Clamp scrollT so the visible window never runs past [0, duration]. */
export function clampScrollT(scrollT: number, duration: number, visibleDur: number): number {
  return Math.max(0, Math.min(scrollT, Math.max(0, duration - visibleDur)))
}

/** Auto-pan target while playing: returns a new scrollT when the playhead has
 *  drifted outside the "keep visible" window, or null when no pan is needed. */
export function computeAutoPanScrollT(
  currentTime: number,
  rawScrollT: number,
  duration: number,
  visibleDur: number
): number | null {
  const raw = clampScrollT(rawScrollT, duration, visibleDur)
  if (currentTime < raw || currentTime > raw + visibleDur * 0.85) {
    return Math.max(0, currentTime - visibleDur * 0.2)
  }
  return null
}

export interface ZoomResult {
  zoom: number
  scrollT: number
}

/** Ctrl/Cmd+wheel zoom, keeping the point under the cursor fixed (zoom clamped [1,200]). */
export function computeZoomAtPointer(
  deltaY: number,
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  duration: number,
  currentZoom: number,
  currentScrollT: number
): ZoomResult {
  const factor = deltaY < 0 ? 1.15 : 1 / 1.15
  const ratio = (clientX - rectLeft) / rectWidth
  const anchorT = currentScrollT + (duration / currentZoom) * ratio
  const newZoom = Math.max(1, Math.min(200, currentZoom * factor))
  const newScrollT = anchorT - (duration / newZoom) * ratio
  return { zoom: newZoom, scrollT: newScrollT }
}

/** Plain-wheel horizontal scroll (10% of the visible window per tick), clamped to [0, duration]. */
export function computeWheelScroll(
  deltaY: number,
  duration: number,
  zoom: number,
  scrollT: number
): number {
  const step = (duration / zoom) * 0.1
  return Math.max(0, Math.min(scrollT + (deltaY > 0 ? step : -step), duration))
}

/** Zoom floor used by setZoom(). */
export function clampZoom(zoom: number): number {
  return Math.max(1, zoom)
}

/** Viewport x/width for a [startT, endT] time range, clamped to the canvas's
 *  client rect. Reuses the exact `timeToPixel` conversion the hit-test
 *  functions use so a double-click popup's anchor rect can never drift from
 *  what findEdge()/findWordHit() consider a hit. */
export function timeRangeToRect(
  startT: number,
  endT: number,
  rectLeft: number,
  rectWidth: number,
  scrollT: number,
  pps: number
): { x: number; w: number } {
  const rawStartX = timeToPixel(startT, scrollT, pps) + rectLeft
  const rawEndX = timeToPixel(endT, scrollT, pps) + rectLeft
  const min = rectLeft
  const max = rectLeft + rectWidth
  const x = Math.max(min, Math.min(rawStartX, max))
  const endX = Math.max(min, Math.min(rawEndX, max))
  return { x, w: Math.max(endX - x, 0) }
}
