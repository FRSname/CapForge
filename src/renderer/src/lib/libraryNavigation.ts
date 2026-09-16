/**
 * Arrow keys across the library's items (docs/plans/library-finder.md §4.4).
 *
 * Left/Right step through the visible order. Up/Down step one row: in the list
 * a row is an item, in the grid it is `columns` items. The grid draws its
 * folders and its videos as two **sections**, each starting a fresh row, so a
 * row never mixes the two; Down from the folders lands on the videos in the
 * same column (or the last video of a short first row), and a column past the
 * end of a ragged row lands on that row's last item. At an edge the focus
 * stays put.
 *
 * The column count is measured from the rendered grid by the hook
 * (`columnCountOf`); the index math here is pure.
 */

import type { ItemKey, Selection } from './librarySelection'
import { rangeKeys, selectOne } from './librarySelection'

export type MoveDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end'

export type ItemLayout =
  | { kind: 'list' }
  /** `sections`: the item count of each section in order (folders, videos). */
  | { kind: 'grid'; columns: number; sections: readonly number[] }

interface SectionSpan {
  start: number
  size: number
}

/** The non-empty sections as spans; one span over everything if they don't add up. */
function spansOf(sections: readonly number[], count: number): SectionSpan[] {
  const total = sections.reduce((sum, n) => sum + Math.max(0, n), 0)
  if (total !== count) return count > 0 ? [{ start: 0, size: count }] : []
  const spans: SectionSpan[] = []
  let start = 0
  for (const size of sections) {
    if (size > 0) spans.push({ start, size })
    start += Math.max(0, size)
  }
  return spans
}

function gridStep(spans: SectionSpan[], columns: number, index: number, down: boolean): number {
  const at = spans.findIndex((s) => index >= s.start && index < s.start + s.size)
  if (at < 0) return index
  const span = spans[at]
  const offset = index - span.start
  const row = Math.floor(offset / columns)
  const col = offset % columns
  const lastRow = Math.floor((span.size - 1) / columns)
  if (down && row < lastRow) return span.start + Math.min((row + 1) * columns + col, span.size - 1)
  if (!down && row > 0) return span.start + (row - 1) * columns + col
  const next = spans[at + (down ? 1 : -1)]
  if (!next) return index
  const nextRow = down ? 0 : Math.floor((next.size - 1) / columns)
  return next.start + Math.min(nextRow * columns + col, next.size - 1)
}

/** The index an arrow key moves to from `index`, over `count` items. */
export function neighbourIndex(
  layout: ItemLayout,
  count: number,
  index: number,
  direction: MoveDirection
): number {
  if (count <= 0) return -1
  if (direction === 'home') return 0
  if (direction === 'end') return count - 1
  if (direction === 'left') return Math.max(0, index - 1)
  if (direction === 'right') return Math.min(count - 1, index + 1)
  if (layout.kind === 'list') {
    return direction === 'up' ? Math.max(0, index - 1) : Math.min(count - 1, index + 1)
  }
  const columns = Math.max(1, Math.floor(layout.columns))
  return gridStep(spansOf(layout.sections, count), columns, index, direction === 'down')
}

/**
 * An arrow key: move the focus and select it alone, or (`extend`, Shift) select
 * the range from the anchor to it. With no focus yet, the first item (the last
 * for End).
 */
export function moveFocus(
  state: Selection,
  visible: readonly ItemKey[],
  layout: ItemLayout,
  direction: MoveDirection,
  extend: boolean
): Selection {
  if (visible.length === 0) return state
  const current = state.focus === null ? -1 : visible.indexOf(state.focus)
  const target =
    current < 0
      ? direction === 'end'
        ? visible.length - 1
        : 0
      : neighbourIndex(layout, visible.length, current, direction)
  const key = visible[target]
  if (!extend) return selectOne(key)
  const anchor =
    state.anchor !== null && visible.includes(state.anchor)
      ? state.anchor
      : current >= 0
        ? visible[current]
        : key
  return { selected: rangeKeys(visible, anchor, key), anchor, focus: key }
}

/** The number of tracks in a computed `grid-template-columns` (`"230px 230px 230px"`). */
export function columnCountOf(gridTemplateColumns: string | null | undefined): number {
  const value = (gridTemplateColumns ?? '').trim()
  if (value === '' || value === 'none') return 1
  return Math.max(1, value.split(/\s+/).length)
}
