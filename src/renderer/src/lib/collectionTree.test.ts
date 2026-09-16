/**
 * The collection tree helpers: building the forest from the flat list, the
 * ancestor/descendant walks, and the renderer's copy of the backend's move rules
 * (docs/plans/library-finder.md §2.2, §4.1).
 */

import { describe, expect, test } from 'vitest'
import {
  MAX_COLLECTION_DEPTH,
  PATH_SEPARATOR,
  ancestorsOf,
  buildTree,
  canCreateInside,
  canMoveInto,
  depthOf,
  descendantIds,
  flattenTree,
  moveTargets,
  pathLabel,
  subtreeHeight,
} from './collectionTree'

interface Row {
  id: string
  name: string
  parent_id: string | null
}

function row(id: string, parent_id: string | null = null, name = id): Row {
  return { id, name, parent_id }
}

/** events › uck26 › (day-1, day-2); events › meetups; solo */
const TREE: Row[] = [
  row('solo', null, 'Solo'),
  row('day-2', 'uck26', 'Day 2'),
  row('events', null, 'Events'),
  row('uck26', 'events', 'UCK 2026'),
  row('day-1', 'uck26', 'Day 1'),
  row('meetups', 'events', 'Meetups'),
]

/** `level-1` › `level-2` › … › `level-n`. */
function chain(n: number, prefix = 'level'): Row[] {
  return Array.from({ length: n }, (_, i) =>
    row(`${prefix}-${i + 1}`, i === 0 ? null : `${prefix}-${i}`)
  )
}

function display(rows: Row[], compare?: (a: Row, b: Row) => number): string[] {
  return flattenTree(buildTree(rows, compare)).map(({ item, depth }) => `${depth}:${item.id}`)
}

describe('MAX_COLLECTION_DEPTH', () => {
  test('mirrors the backend limit', () => {
    expect(MAX_COLLECTION_DEPTH).toBe(8)
  })
})

describe('buildTree / flattenTree', () => {
  test('nests children under their parent in input order, pre-order', () => {
    expect(display(TREE)).toEqual([
      '1:solo',
      '1:events',
      '2:uck26',
      '3:day-2',
      '3:day-1',
      '2:meetups',
    ])
  })

  test('sorts siblings at every level when given a compare', () => {
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name)
    expect(display(TREE, byName)).toEqual([
      '1:events',
      '2:meetups',
      '2:uck26',
      '3:day-1',
      '3:day-2',
      '1:solo',
    ])
  })

  test('an empty list is an empty forest', () => {
    expect(buildTree([])).toEqual([])
  })

  test('a row whose parent is unknown shows at the top level', () => {
    expect(display([row('a', 'ghost'), row('b', 'a')])).toEqual(['1:a', '2:b'])
  })

  test('a cycle never loops and never hides a folder', () => {
    const rows = [row('top'), row('a', 'b'), row('b', 'a'), row('c', 'a')]
    const shown = display(rows)
    expect(shown).toHaveLength(rows.length)
    expect(shown[0]).toBe('1:top')
    expect(new Set(shown.map((s) => s.split(':')[1]))).toEqual(new Set(['top', 'a', 'b', 'c']))
  })

  test('never mutates the input rows', () => {
    const rows = [row('a', 'b'), row('b', 'a')]
    const before = JSON.stringify(rows)
    buildTree(rows)
    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('ancestorsOf', () => {
  test('lists the folders above, top level first', () => {
    expect(ancestorsOf(TREE, 'day-1').map((r) => r.id)).toEqual(['events', 'uck26'])
  })

  test('a top-level or unknown id has none', () => {
    expect(ancestorsOf(TREE, 'events')).toEqual([])
    expect(ancestorsOf(TREE, 'nope')).toEqual([])
  })

  test('stops at a dangling parent and at a cycle', () => {
    expect(ancestorsOf([row('a', 'ghost')], 'a')).toEqual([])
    expect(ancestorsOf([row('a', 'b'), row('b', 'a')], 'a').map((r) => r.id)).toEqual(['b'])
  })
})

describe('descendantIds', () => {
  test('collects every depth, never the folder itself', () => {
    expect(descendantIds(TREE, 'events')).toEqual(new Set(['uck26', 'day-1', 'day-2', 'meetups']))
    expect(descendantIds(TREE, 'uck26')).toEqual(new Set(['day-1', 'day-2']))
    expect(descendantIds(TREE, 'day-1')).toEqual(new Set())
    expect(descendantIds(TREE, 'nope')).toEqual(new Set())
  })

  test('terminates on a cycle', () => {
    expect(descendantIds([row('a', 'b'), row('b', 'a')], 'a')).toEqual(new Set(['b']))
  })
})

describe('depthOf / subtreeHeight', () => {
  test('a top-level folder is depth 1, an unknown id 0', () => {
    expect(['events', 'uck26', 'day-1'].map((id) => depthOf(TREE, id))).toEqual([1, 2, 3])
    expect(depthOf(TREE, 'nope')).toBe(0)
  })

  test('height counts the folder itself', () => {
    expect(['events', 'uck26', 'day-1', 'solo'].map((id) => subtreeHeight(TREE, id))).toEqual([
      3, 2, 1, 1,
    ])
  })
})

describe('canMoveInto', () => {
  test('the top level is always allowed for a known folder', () => {
    expect(canMoveInto(TREE, 'day-1', null)).toBe(true)
    expect(canMoveInto(TREE, 'nope', null)).toBe(false)
  })

  test('another folder, or the current parent, is allowed', () => {
    expect(canMoveInto(TREE, 'solo', 'day-1')).toBe(true)
    expect(canMoveInto(TREE, 'day-1', 'uck26')).toBe(true)
  })

  test('refuses itself, its own subfolders and an unknown target', () => {
    expect(canMoveInto(TREE, 'events', 'events')).toBe(false)
    expect(canMoveInto(TREE, 'events', 'uck26')).toBe(false)
    expect(canMoveInto(TREE, 'events', 'day-2')).toBe(false)
    expect(canMoveInto(TREE, 'solo', 'ghost')).toBe(false)
  })

  test('counts the whole subtree against the depth limit', () => {
    const rows = [...chain(6, 'deep'), ...chain(3, 'sub')]
    // sub-1 has height 3: under deep-5 the deepest lands at 8, under deep-6 at 9.
    expect(canMoveInto(rows, 'sub-1', 'deep-5')).toBe(true)
    expect(canMoveInto(rows, 'sub-1', 'deep-6')).toBe(false)
    expect(canMoveInto(rows, 'sub-3', 'deep-6')).toBe(true)
  })
})

describe('moveTargets', () => {
  test('lists every folder but the moving one and its subfolders, in tree order', () => {
    expect(moveTargets(TREE, 'uck26').map(({ item, depth }) => `${depth}:${item.id}`)).toEqual([
      '1:solo',
      '1:events',
      '2:meetups',
    ])
  })

  test('leaves out a folder the subtree would overflow', () => {
    const rows = [...chain(MAX_COLLECTION_DEPTH, 'deep'), row('leaf')]
    const ids = moveTargets(rows, 'leaf').map(({ item }) => item.id)
    expect(ids).toContain(`deep-${MAX_COLLECTION_DEPTH - 1}`)
    expect(ids).not.toContain(`deep-${MAX_COLLECTION_DEPTH}`)
  })
})

describe('canCreateInside', () => {
  test('allows the top level and any folder above the deepest level', () => {
    const rows = chain(MAX_COLLECTION_DEPTH)
    expect(canCreateInside(rows, null)).toBe(true)
    expect(canCreateInside(rows, `level-${MAX_COLLECTION_DEPTH - 1}`)).toBe(true)
    expect(canCreateInside(rows, `level-${MAX_COLLECTION_DEPTH}`)).toBe(false)
    expect(canCreateInside(rows, 'ghost')).toBe(false)
  })
})

describe('pathLabel', () => {
  test('joins the names from the top level down', () => {
    expect(pathLabel(TREE, 'day-1')).toBe(['Events', 'UCK 2026', 'Day 1'].join(PATH_SEPARATOR))
    expect(pathLabel(TREE, 'solo')).toBe('Solo')
  })

  test('an unknown id is shown as itself', () => {
    expect(pathLabel(TREE, 'orphan')).toBe('orphan')
  })
})
