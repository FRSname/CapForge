/**
 * The shade around a coach mark.
 *
 * Four rectangles, not one rectangle with a hole: the whole point of walking
 * the real app is that the thing being pointed at is still the real control,
 * so nothing may be drawn over it. A mask, a clip-path or an inset shadow
 * would all cover it and swallow the click.
 *
 * The ring is a fifth element, drawn on top of the spotlight, and takes no
 * pointer events for the same reason.
 */

import type { CSSProperties } from 'react'
import type { Rect } from '../../lib/tourPlacement'

/** The scrim's own class, shared by the full-screen and the four-piece cases. */
const PIECE_CLASS = 'fixed bg-[var(--color-scrim)] backdrop-blur-sm'

/** Thickness of the ring around the spotlight, in pixels. */
const RING_WIDTH_PX = 2

/** Rounding of the ring, in pixels. */
const RING_RADIUS_PX = 8

const BLOCKING: CSSProperties = { pointerEvents: 'auto' }

export interface TourScrimProps {
  /** The padded spotlight box; null shades the whole window. */
  rect: Rect | null
}

export function TourScrim({ rect }: TourScrimProps) {
  if (!rect) {
    return <div data-tour-scrim="all" className={`${PIECE_CLASS} inset-0`} style={BLOCKING} />
  }

  const right = rect.left + rect.width
  const bottom = rect.top + rect.height

  return (
    <>
      <Piece side="top" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }} />
      <Piece side="bottom" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <Piece
        side="left"
        style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }}
      />
      <Piece side="right" style={{ top: rect.top, left: right, right: 0, height: rect.height }} />
      <div
        aria-hidden="true"
        className="fixed"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          border: `${RING_WIDTH_PX}px solid var(--color-brand)`,
          borderRadius: `${RING_RADIUS_PX}px`,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}

interface PieceProps {
  side: 'top' | 'bottom' | 'left' | 'right'
  style: CSSProperties
}

function Piece({ side, style }: PieceProps) {
  return <div data-tour-scrim={side} className={PIECE_CLASS} style={{ ...style, ...BLOCKING }} />
}
