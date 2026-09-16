/**
 * Library drag and drop (docs/plans/library-finder.md §4.3): which drag this
 * is, its payload read at the boundary, and whether a target accepts it. The
 * load-bearing case is `dragKind`: an internal drag must never be mistaken for
 * a file drop, or dragging a card would import nothing and swallow the move.
 */

import { describe, expect, test } from 'vitest'
import type { DragPayload } from './libraryDrag'
import {
  COLLECTION_DRAG_TYPE,
  VIDEOS_DRAG_TYPE,
  canDrop,
  dragKind,
  encodeVideoIds,
  parseCollectionId,
  parseVideoIds,
  readDragPayload,
} from './libraryDrag'

const TREE = [
  { id: 'events', parent_id: null },
  { id: 'uck26', parent_id: 'events' },
  { id: 'day-1', parent_id: 'uck26' },
  { id: 'tutorials', parent_id: null },
]

const VIDEOS = [
  { id: 'loose', collection_id: null },
  { id: 'keynote', collection_id: 'uck26' },
  { id: 'panel', collection_id: 'uck26' },
]

describe('dragKind', () => {
  test('files from the OS', () => {
    expect(dragKind(['Files'])).toBe('files')
  })

  test('the two internal kinds', () => {
    expect(dragKind([VIDEOS_DRAG_TYPE])).toBe('videos')
    expect(dragKind([COLLECTION_DRAG_TYPE])).toBe('collection')
  })

  test('an internal type wins over Files in a mixed list, so it never imports', () => {
    expect(dragKind(['Files', VIDEOS_DRAG_TYPE])).toBe('videos')
    expect(dragKind([COLLECTION_DRAG_TYPE, 'Files', 'text/plain'])).toBe('collection')
  })

  test('both internal types at once are ambiguous', () => {
    expect(dragKind([VIDEOS_DRAG_TYPE, COLLECTION_DRAG_TYPE])).toBeNull()
  })

  test('text, links and nothing are not ours', () => {
    expect(dragKind([])).toBeNull()
    expect(dragKind(['text/plain', 'text/uri-list'])).toBeNull()
  })
})

describe('payloads', () => {
  test('video ids round-trip as a JSON array', () => {
    expect(parseVideoIds(encodeVideoIds(['a', 'b']))).toEqual(['a', 'b'])
  })

  test.each(['', 'nope', '{}', '"a"', '[]', '[1]', '["a", 2]', '[""]', 'null'])(
    'video payload %j is refused',
    (raw) => {
      expect(parseVideoIds(raw)).toBeNull()
    }
  )

  test('duplicate ids are read once', () => {
    expect(parseVideoIds('["a","a","b"]')).toEqual(['a', 'b'])
  })

  test('a collection id is a non-empty string', () => {
    expect(parseCollectionId('uck26')).toBe('uck26')
    expect(parseCollectionId('  ')).toBeNull()
    expect(parseCollectionId('')).toBeNull()
  })

  test('readDragPayload reads the type its kind names', () => {
    const data: Record<string, string> = {
      [VIDEOS_DRAG_TYPE]: '["keynote"]',
      [COLLECTION_DRAG_TYPE]: 'events',
    }
    const get = (type: string) => data[type] ?? ''
    expect(readDragPayload('videos', get)).toEqual({ kind: 'videos', ids: ['keynote'] })
    expect(readDragPayload('collection', get)).toEqual({ kind: 'collection', id: 'events' })
    expect(readDragPayload('files', get)).toBeNull()
    expect(readDragPayload(null, get)).toBeNull()
    expect(readDragPayload('videos', () => 'garbage')).toBeNull()
  })
})

describe('canDrop', () => {
  const videos = (...ids: string[]): DragPayload => ({ kind: 'videos', ids })
  const folder = (id: string): DragPayload => ({ kind: 'collection', id })

  test('a video goes into another folder or back to the Library root', () => {
    expect(canDrop('videos', videos('keynote'), 'tutorials', TREE, VIDEOS)).toBe(true)
    expect(canDrop('videos', videos('keynote'), null, TREE, VIDEOS)).toBe(true)
    expect(canDrop('videos', videos('loose'), 'events', TREE, VIDEOS)).toBe(true)
  })

  test('a video onto the folder it is already in shows no affordance', () => {
    expect(canDrop('videos', videos('keynote'), 'uck26', TREE, VIDEOS)).toBe(false)
    expect(canDrop('videos', videos('loose'), null, TREE, VIDEOS)).toBe(false)
  })

  test('several videos are accepted when any of them would move', () => {
    expect(canDrop('videos', videos('keynote', 'loose'), 'uck26', TREE, VIDEOS)).toBe(true)
    expect(canDrop('videos', videos('keynote', 'panel'), 'uck26', TREE, VIDEOS)).toBe(false)
  })

  test('an unknown video, or a folder that does not exist, is refused', () => {
    expect(canDrop('videos', videos('ghost'), 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop('videos', videos('keynote'), 'old-event', TREE, VIDEOS)).toBe(false)
  })

  test('a folder moves into another folder or to the top level', () => {
    expect(canDrop('collection', folder('tutorials'), 'events', TREE, VIDEOS)).toBe(true)
    expect(canDrop('collection', folder('uck26'), null, TREE, VIDEOS)).toBe(true)
  })

  test('a folder onto itself, its descendant or its current parent shows no affordance', () => {
    expect(canDrop('collection', folder('events'), 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop('collection', folder('events'), 'day-1', TREE, VIDEOS)).toBe(false)
    expect(canDrop('collection', folder('uck26'), 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop('collection', folder('events'), null, TREE, VIDEOS)).toBe(false)
  })

  test('files, nothing, and a kind that disagrees with the payload are refused', () => {
    expect(canDrop('files', videos('keynote'), 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop(null, null, 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop('videos', null, 'events', TREE, VIDEOS)).toBe(false)
    expect(canDrop('collection', videos('keynote'), 'events', TREE, VIDEOS)).toBe(false)
  })
})
