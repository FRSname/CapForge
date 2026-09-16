/**
 * Arrow keys over the library: the index math for the list and for a grid of
 * two sections (folders, then videos) with ragged last rows, and how a move
 * selects or extends from the anchor.
 */

import { describe, expect, test } from 'vitest'
import type { ItemLayout } from './libraryNavigation'
import { columnCountOf, moveFocus, neighbourIndex } from './libraryNavigation'
import type { Selection } from './librarySelection'
import { EMPTY_SELECTION, selectOne, visibleKeys } from './librarySelection'

const LIST: ItemLayout = { kind: 'list' }

/**
 * Three columns. Folders 0–4 (a ragged row of 2), videos 5–11 (a ragged row of 1):
 *
 *   0 1 2
 *   3 4
 *   5 6 7
 *   8 9 10
 *   11
 */
const GRID: ItemLayout = { kind: 'grid', columns: 3, sections: [5, 7] }
const COUNT = 12

describe('neighbourIndex: left, right, home, end', () => {
  test.each([
    ['left', 4, 3],
    ['left', 5, 4],
    ['left', 0, 0],
    ['right', 4, 5],
    ['right', 11, 11],
    ['home', 7, 0],
    ['end', 2, 11],
  ] as const)('%s from %i is %i, in the grid and the list', (direction, from, to) => {
    expect(neighbourIndex(GRID, COUNT, from, direction)).toBe(to)
    expect(neighbourIndex(LIST, COUNT, from, direction)).toBe(to)
  })

  test('no items: nowhere', () => {
    expect(neighbourIndex(GRID, 0, 0, 'right')).toBe(-1)
  })
})

describe('neighbourIndex: list up and down', () => {
  test.each([
    ['up', 3, 2],
    ['up', 0, 0],
    ['down', 3, 4],
    ['down', 11, 11],
  ] as const)('%s from %i is %i', (direction, from, to) => {
    expect(neighbourIndex(LIST, COUNT, from, direction)).toBe(to)
  })
})

describe('neighbourIndex: grid up and down', () => {
  test.each([
    // Inside a section, one row.
    ['down', 0, 3],
    ['down', 1, 4],
    ['up', 4, 1],
    ['down', 6, 9],
    ['up', 10, 7],
    // A column past a ragged row lands on its last item.
    ['down', 2, 4],
    ['down', 9, 11],
    ['down', 10, 11],
    // Across the section boundary, same column.
    ['down', 3, 5],
    ['down', 4, 6],
    ['up', 5, 3],
    ['up', 6, 4],
    // Up from the videos into a ragged last folder row: its last item.
    ['up', 7, 4],
    // The edges stay put.
    ['up', 0, 0],
    ['up', 2, 2],
    ['down', 11, 11],
  ] as const)('%s from %i is %i', (direction, from, to) => {
    expect(neighbourIndex(GRID, COUNT, from, direction)).toBe(to)
  })

  test('an empty folder section is skipped', () => {
    const layout: ItemLayout = { kind: 'grid', columns: 2, sections: [0, 5] }
    expect(neighbourIndex(layout, 5, 1, 'down')).toBe(3)
    expect(neighbourIndex(layout, 5, 3, 'down')).toBe(4)
    expect(neighbourIndex(layout, 5, 0, 'up')).toBe(0)
  })

  test('a last row of one, reached from every column above it', () => {
    const layout: ItemLayout = { kind: 'grid', columns: 4, sections: [0, 5] }
    expect([0, 1, 2, 3].map((i) => neighbourIndex(layout, 5, i, 'down'))).toEqual([4, 4, 4, 4])
    expect(neighbourIndex(layout, 5, 4, 'up')).toBe(0)
  })

  test('sections that do not add up are read as one', () => {
    const layout: ItemLayout = { kind: 'grid', columns: 3, sections: [2, 2] }
    expect(neighbourIndex(layout, 6, 1, 'down')).toBe(4)
  })

  test('a column count below one is read as one', () => {
    const layout: ItemLayout = { kind: 'grid', columns: 0, sections: [0, 3] }
    expect(neighbourIndex(layout, 3, 0, 'down')).toBe(1)
  })
})

describe('moveFocus', () => {
  const visible = visibleKeys([{ id: 'f' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  const [F, A, B, C] = visible

  test('with no focus, any arrow selects the first item; End the last', () => {
    expect(moveFocus(EMPTY_SELECTION, visible, LIST, 'down', false)).toEqual(selectOne(F))
    expect(moveFocus(EMPTY_SELECTION, visible, LIST, 'left', false)).toEqual(selectOne(F))
    expect(moveFocus(EMPTY_SELECTION, visible, LIST, 'end', false)).toEqual(selectOne(C))
  })

  test('a plain arrow selects the next item alone', () => {
    const state: Selection = { selected: [A, B], anchor: A, focus: B }
    expect(moveFocus(state, visible, LIST, 'right', false)).toEqual(selectOne(C))
  })

  test('Shift extends from the anchor, both ways', () => {
    const down = moveFocus(
      moveFocus(selectOne(A), visible, LIST, 'down', true),
      visible,
      LIST,
      'down',
      true
    )
    expect(down).toEqual({ selected: [A, B, C], anchor: A, focus: C })
    const back = moveFocus(down, visible, LIST, 'home', true)
    expect(back).toEqual({ selected: [F, A], anchor: A, focus: F })
  })

  test('Shift with no anchor starts from the focus', () => {
    const state: Selection = { selected: [], anchor: null, focus: A }
    expect(moveFocus(state, visible, LIST, 'down', true)).toEqual({
      selected: [A, B],
      anchor: A,
      focus: B,
    })
  })

  test('nothing on show: unchanged', () => {
    const state = selectOne(A)
    expect(moveFocus(state, [], LIST, 'down', false)).toBe(state)
  })
})

describe('columnCountOf', () => {
  test.each([
    ['230px 230px 230px', 3],
    ['  140px ', 1],
    ['200.5px 200.5px', 2],
    ['none', 1],
    ['', 1],
  ])('%j has %i columns', (value, count) => {
    expect(columnCountOf(value)).toBe(count)
  })

  test('nothing measured is one column', () => {
    expect(columnCountOf(undefined)).toBe(1)
    expect(columnCountOf(null)).toBe(1)
  })
})
