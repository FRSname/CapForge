/**
 * Coach-mark geometry: the hole cut in the scrim, and where the popover sits
 * beside it.
 *
 * Pure numbers, no DOM. `useTourTarget` measures the element and hands the
 * rect in; `TourPopover` measures itself and asks for a position.
 */

import type { Placement } from './tourSteps'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PlacedPopover {
  top: number
  left: number
  /** The side actually used, which may not be the preferred one. */
  placement: Placement
}

/** How far the spotlight reaches past the element it frames. */
export const SPOTLIGHT_PADDING = 6

/** Between the spotlight and the popover. */
export const POPOVER_GAP = 12

/** The popover never comes closer than this to an edge of the window. */
export const VIEWPORT_MARGIN = 16

/** The order of fallbacks once the preferred side and its opposite are out. */
const CROSS_SIDES: Record<Placement, readonly Placement[]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
}

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/** The padded box drawn around a target. */
export function spotlightRect(target: Rect): Rect {
  return {
    top: target.top - SPOTLIGHT_PADDING,
    left: target.left - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  }
}

/**
 * False for an element that is on the page but not laid out: a hidden aside
 * measures zero, and a zero-size spotlight would be a stray dot in the corner.
 */
export function isVisibleRect(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}

function fits(side: Placement, target: Rect, popover: Size, viewport: Size): boolean {
  const needed =
    POPOVER_GAP + (side === 'left' || side === 'right' ? popover.width : popover.height)
  switch (side) {
    case 'top':
      return target.top - needed >= VIEWPORT_MARGIN
    case 'bottom':
      return target.top + target.height + needed <= viewport.height - VIEWPORT_MARGIN
    case 'left':
      return target.left - needed >= VIEWPORT_MARGIN
    case 'right':
      return target.left + target.width + needed <= viewport.width - VIEWPORT_MARGIN
  }
}

/** Keeps `value` inside the margins; a card bigger than the axis pins to the near margin. */
function clamp(value: number, size: number, extent: number): number {
  const max = extent - VIEWPORT_MARGIN - size
  return Math.max(VIEWPORT_MARGIN, Math.min(value, max))
}

/**
 * The preferred side when it fits, else its opposite, else the other axis;
 * if nothing fits, the preferred side clamped on screen. The popover is
 * centred on the target along the other axis and always kept in the viewport.
 */
export function placePopover(
  target: Rect,
  popover: Size,
  viewport: Size,
  preferred: Placement
): PlacedPopover {
  const order = [preferred, OPPOSITE[preferred], ...CROSS_SIDES[preferred]]
  const placement = order.find((side) => fits(side, target, popover, viewport)) ?? preferred

  if (placement === 'top' || placement === 'bottom') {
    const top =
      placement === 'top'
        ? target.top - POPOVER_GAP - popover.height
        : target.top + target.height + POPOVER_GAP
    const left = target.left + target.width / 2 - popover.width / 2
    return {
      top: clamp(top, popover.height, viewport.height),
      left: clamp(left, popover.width, viewport.width),
      placement,
    }
  }

  const left =
    placement === 'left'
      ? target.left - POPOVER_GAP - popover.width
      : target.left + target.width + POPOVER_GAP
  const top = target.top + target.height / 2 - popover.height / 2
  return {
    top: clamp(top, popover.height, viewport.height),
    left: clamp(left, popover.width, viewport.width),
    placement,
  }
}
