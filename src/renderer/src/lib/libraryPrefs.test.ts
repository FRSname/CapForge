/**
 * The remembered library view (`app-state` key `libraryView`). What matters: a
 * value from an older build, a hand edit or nothing at all never breaks the
 * screen — each field falls back to its own default on its own, and the icon
 * size can never leave the slider's range.
 */

import { describe, expect, test } from 'vitest'
import {
  DEFAULT_LIBRARY_VIEW_PREFS,
  LIBRARY_TILE_DEFAULT_PX,
  LIBRARY_TILE_MAX_PX,
  LIBRARY_TILE_MIN_PX,
  LIBRARY_VIEW_KEY,
  clampTileSize,
  parseLibraryViewPrefs,
} from './libraryPrefs'

describe('the stored key and defaults', () => {
  test('one key, grid at today’s card size, newest first', () => {
    expect(LIBRARY_VIEW_KEY).toBe('libraryView')
    expect(LIBRARY_TILE_MIN_PX).toBe(140)
    expect(LIBRARY_TILE_MAX_PX).toBe(360)
    expect(LIBRARY_TILE_DEFAULT_PX).toBe(230)
    expect(DEFAULT_LIBRARY_VIEW_PREFS).toEqual({
      layout: 'grid',
      tileSize: 230,
      sort: { key: 'modified', direction: 'desc' },
    })
  })
})

describe('parseLibraryViewPrefs', () => {
  test('a well-formed value comes back as it was', () => {
    const stored = { layout: 'list', tileSize: 300, sort: { key: 'name', direction: 'asc' } }
    expect(parseLibraryViewPrefs(stored)).toEqual(stored)
  })

  test.each([undefined, null, 'grid', 7, [], true])('%s is the defaults', (stored) => {
    expect(parseLibraryViewPrefs(stored)).toEqual(DEFAULT_LIBRARY_VIEW_PREFS)
  })

  test('an unknown layout falls back alone', () => {
    expect(
      parseLibraryViewPrefs({ layout: 'columns', tileSize: 200, sort: { key: 'name', direction: 'desc' } })
    ).toEqual({ layout: 'grid', tileSize: 200, sort: { key: 'name', direction: 'desc' } })
  })

  test('the tile size is clamped to the slider range and rounded', () => {
    expect(parseLibraryViewPrefs({ tileSize: 20 }).tileSize).toBe(LIBRARY_TILE_MIN_PX)
    expect(parseLibraryViewPrefs({ tileSize: 9000 }).tileSize).toBe(LIBRARY_TILE_MAX_PX)
    expect(parseLibraryViewPrefs({ tileSize: 250.6 }).tileSize).toBe(251)
  })

  test.each(['250', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'a tile size of %s is the default',
    (tileSize) => {
      expect(parseLibraryViewPrefs({ layout: 'list', tileSize }).tileSize).toBe(
        LIBRARY_TILE_DEFAULT_PX
      )
    }
  )

  test('an unknown sort key falls back, keeping a valid direction', () => {
    expect(parseLibraryViewPrefs({ sort: { key: 'size', direction: 'asc' } }).sort).toEqual({
      key: 'modified',
      direction: 'asc',
    })
  })

  test('an unknown direction takes the key’s natural one', () => {
    expect(parseLibraryViewPrefs({ sort: { key: 'name', direction: 'up' } }).sort).toEqual({
      key: 'name',
      direction: 'asc',
    })
    expect(parseLibraryViewPrefs({ sort: 'name' }).sort).toEqual(DEFAULT_LIBRARY_VIEW_PREFS.sort)
  })

  test('keys it does not know (a later build’s sidebar state) are dropped, not fatal', () => {
    expect(parseLibraryViewPrefs({ layout: 'list', sidebarCollapsed: true })).toEqual({
      ...DEFAULT_LIBRARY_VIEW_PREFS,
      layout: 'list',
    })
  })
})

describe('clampTileSize', () => {
  test('holds the slider value inside the range', () => {
    expect(clampTileSize(LIBRARY_TILE_MIN_PX - 1)).toBe(LIBRARY_TILE_MIN_PX)
    expect(clampTileSize(LIBRARY_TILE_MAX_PX + 1)).toBe(LIBRARY_TILE_MAX_PX)
    expect(clampTileSize(200)).toBe(200)
    expect(clampTileSize(Number.NaN)).toBe(LIBRARY_TILE_DEFAULT_PX)
  })
})
