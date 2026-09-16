/**
 * A library menu opened at a point in the window — a right-click, or under a
 * `…` button: drawn `position: fixed` so no scroll box clips it, held inside
 * the window's right edge, and closed on Esc or a press elsewhere.
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useDismiss } from '../../hooks/useDismiss'

/** Tailwind `w-56`: kept in sync so a menu near the window's edge stays on screen. */
export const POINT_MENU_WIDTH_PX = 224
/** Room kept between a menu and the right edge of the window. */
const POINT_MENU_EDGE_PX = 8

export interface MenuPoint {
  x: number
  y: number
}

/** The point, held inside the window so the menu opens fully on screen. */
export function clampedPosition(point: MenuPoint): { left: number; top: number } {
  if (typeof window === 'undefined') return { left: point.x, top: point.y }
  const maxLeft = window.innerWidth - POINT_MENU_WIDTH_PX - POINT_MENU_EDGE_PX
  return { left: Math.max(0, Math.min(point.x, maxLeft)), top: point.y }
}

export interface PointMenuProps {
  point: MenuPoint
  label: string
  onDismiss: () => void
  children: ReactNode
}

export function PointMenu({ point, label, onDismiss, children }: PointMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onDismiss)
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-[var(--z-dropdown)] flex w-56 flex-col rounded-lg p-1 text-left text-xs"
      style={{
        ...clampedPosition(point),
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-2)',
        boxShadow: 'var(--shadow-2)',
      }}
    >
      {children}
    </div>
  )
}
