/**
 * The sidebar's folder rows: the tree in name order, a folder's subfolders
 * shown only while it is expanded (or while the folder on show is inside it),
 * and orphan ids after the tree.
 */

import { describe, expect, test } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { EMPTY_OVERRIDES } from './collectionTypes'
import { ROOT_LOCATION, folderLocation } from './libraryLocation'
import { expandedWith, sidebarRows, toggledExpanded, unfiledCount } from './librarySidebar'

function folder(id: string, name: string, parent_id: string | null = null): CollectionSummary {
  return {
    id,
    name,
    slots: {},
    overrides: EMPTY_OVERRIDES,
    createdAt: '',
    updatedAt: '',
    members: 0,
    parent_id,
    total_members: 0,
    path: [name],
  }
}

const TREE = [
  folder('tutorials', 'Tutorials'),
  folder('events', 'Events'),
  folder('uck26', 'UCK26', 'events'),
  folder('day-1', 'Day 1', 'uck26'),
  folder('meetups', 'Meetups', 'events'),
]

const VIDEOS = [
  { collection_id: null },
  { collection_id: null },
  { collection_id: 'uck26' },
  { collection_id: 'old-event' },
]

const shape = (rows: ReturnType<typeof sidebarRows>) =>
  rows.map((r) => [r.entry.id, r.depth, r.hasChildren, r.expanded])

describe('sidebarRows', () => {
  test('collapsed: the top-level folders by name, then orphans', () => {
    expect(shape(sidebarRows(TREE, VIDEOS, [], ROOT_LOCATION))).toEqual([
      ['events', 1, true, false],
      ['tutorials', 1, false, false],
      ['old-event', 1, false, false],
    ])
  })

  test('an expanded folder shows its subfolders, indented, and theirs only when expanded too', () => {
    expect(shape(sidebarRows(TREE, VIDEOS, ['events'], ROOT_LOCATION))).toEqual([
      ['events', 1, true, true],
      ['meetups', 2, false, false],
      ['uck26', 2, true, false],
      ['tutorials', 1, false, false],
      ['old-event', 1, false, false],
    ])
  })

  test('the folder on show is revealed: every folder above it opens', () => {
    const rows = sidebarRows(TREE, VIDEOS, [], folderLocation('day-1'))
    expect(rows.map((r) => r.entry.id)).toEqual([
      'events',
      'meetups',
      'uck26',
      'day-1',
      'tutorials',
      'old-event',
    ])
  })

  test('an orphan is marked as one', () => {
    const orphan = sidebarRows(TREE, VIDEOS, [], ROOT_LOCATION).at(-1)
    expect(orphan?.entry).toMatchObject({ id: 'old-event', orphan: true, videoCount: 1 })
  })

  test('before the folders load there are no rows', () => {
    expect(sidebarRows(null, VIDEOS, [], ROOT_LOCATION)).toEqual([])
  })
})

describe('expanded state', () => {
  test('toggling adds or removes one id, never mutating', () => {
    const before = ['events']
    expect(toggledExpanded(before, 'uck26')).toEqual(['events', 'uck26'])
    expect(toggledExpanded(before, 'events')).toEqual([])
    expect(before).toEqual(['events'])
  })

  test('expandedWith opens an id once', () => {
    expect(expandedWith(['a'], 'a')).toEqual(['a'])
    expect(expandedWith(['a'], 'b')).toEqual(['a', 'b'])
  })
})

describe('unfiledCount', () => {
  test('the videos in no folder', () => {
    expect(unfiledCount(VIDEOS)).toBe(2)
  })
})
