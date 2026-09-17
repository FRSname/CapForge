/**
 * The width rule behind the results screen's two resizable columns: the
 * transcript editor on the left and the studio/publish aside on the right.
 * Pure so the clamp, the direction and the stored-value guard are tested
 * without a DOM; the drag and the `app-state` round trip live in
 * `hooks/usePanelResize.ts`.
 */

export interface PanelWidthBounds {
  min: number
  max: number
  initial: number
}

/** The transcript editor (left column). */
export const EDITOR_PANEL_WIDTH: PanelWidthBounds = { min: 180, max: 600, initial: 420 }

/** The studio / publish aside (right column). 380 is the width it always had. */
export const ASIDE_PANEL_WIDTH: PanelWidthBounds = { min: 320, max: 640, initial: 380 }

/** The `app-state` keys the two widths are remembered under (electron/app-state.js). */
export const PANEL_WIDTH_KEYS = {
  editor: 'editorPanelWidth',
  aside: 'asidePanelWidth',
} as const

/** Which side of the screen the panel sits on, i.e. which drag direction widens it. */
export type PanelSide = 'left' | 'right'

export interface ResizeInput {
  startWidth: number
  startX: number
  clientX: number
  bounds: PanelWidthBounds
  side: PanelSide
}

function clampWidth(width: number, bounds: PanelWidthBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, width))
}

export function resizedWidth({ startWidth, startX, clientX, bounds, side }: ResizeInput): number {
  const delta = clientX - startX
  const next = side === 'left' ? startWidth + delta : startWidth - delta
  return clampWidth(next, bounds)
}

/**
 * A remembered width read back from `app-state`: the file is external data,
 * so anything but a finite number falls back to the default, and a number
 * from a build with other bounds is clamped into today's.
 */
export function parseStoredPanelWidth(stored: unknown, bounds: PanelWidthBounds): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return bounds.initial
  return clampWidth(Math.round(stored), bounds)
}
