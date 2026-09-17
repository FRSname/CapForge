/**
 * The width rule behind the results screen's two resizable columns: the
 * transcript editor on the left and the studio/publish aside on the right.
 * Pure so the clamp and the direction are tested without a DOM; the drag
 * itself lives in `hooks/usePanelResize.ts`.
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

/** Which side of the screen the panel sits on, i.e. which drag direction widens it. */
export type PanelSide = 'left' | 'right'

export interface ResizeInput {
  startWidth: number
  startX: number
  clientX: number
  bounds: PanelWidthBounds
  side: PanelSide
}

export function resizedWidth({ startWidth, startX, clientX, bounds, side }: ResizeInput): number {
  const delta = clientX - startX
  const next = side === 'left' ? startWidth + delta : startWidth - delta
  return Math.max(bounds.min, Math.min(bounds.max, next))
}
