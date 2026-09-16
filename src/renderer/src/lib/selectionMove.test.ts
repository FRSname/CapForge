/**
 * "Move to…" for a selection: the videos through the one-video move path, the
 * folders by `parent_id`, a folder that cannot go there skipped and named, one
 * refresh and one summary — and what the picker checks.
 */

import { describe, expect, test, vi } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { folderMoveProblem, runMoveSelection, selectionMoveOptions } from './selectionMove'

function folder(id: string, name: string, parent_id: string | null = null): CollectionSummary {
  return {
    id,
    name,
    slots: {},
    overrides: {} as never,
    createdAt: '',
    updatedAt: '',
    members: 0,
    parent_id,
    total_members: 0,
    path: [name],
  }
}

const COLLECTIONS = [
  folder('events', 'Events'),
  folder('uck26', 'UCK 26', 'events'),
  folder('day1', 'Day 1', 'uck26'),
  folder('talks', 'Talks'),
]

const KEYNOTE = { id: 'v1', title: 'Keynote', sourcePath: '/m/k.mp4', collection_id: null }
const PANEL = { id: 'v2', title: 'Panel', sourcePath: '/m/p.mp4', collection_id: 'talks' }

function deps() {
  const calls: string[] = []
  return {
    calls,
    read: vi.fn((id: string) => {
      calls.push(`read ${id}`)
      return Promise.resolve({ rev: 1, collection_id: null as string | null })
    }),
    write: vi.fn((id: string, patch: { collection_id: string | null }) => {
      calls.push(`write ${id} ${patch.collection_id}`)
      return Promise.resolve({})
    }),
    patchFolder: vi.fn((id: string, patch: { parent_id: string | null }) => {
      calls.push(`folder ${id} ${patch.parent_id}`)
      return Promise.resolve({})
    }),
    refresh: vi.fn(() => {
      calls.push('refresh')
      return Promise.resolve()
    }),
    refreshCollections: vi.fn(() => {
      calls.push('refreshCollections')
      return Promise.resolve()
    }),
    notify: vi.fn(),
  }
}

describe('runMoveSelection', () => {
  test('videos then folders, then one refresh of the list and the folders', async () => {
    const d = deps()
    expect(await runMoveSelection([KEYNOTE], ['uck26'], 'talks', COLLECTIONS, d)).toBe(2)
    expect(d.calls).toEqual([
      'read v1',
      'write v1 talks',
      'folder uck26 talks',
      'refresh',
      'refreshCollections',
    ])
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('to the top level: null for both', async () => {
    const d = deps()
    d.read.mockImplementation(() => Promise.resolve({ rev: 1, collection_id: 'talks' }))
    await runMoveSelection([PANEL], ['uck26'], null, COLLECTIONS, d)
    expect(d.calls).toContain('write v2 null')
    expect(d.calls).toContain('folder uck26 null')
  })

  test('a folder cannot go inside itself or its subfolder: skipped, named in the one summary', async () => {
    const d = deps()
    const moved = await runMoveSelection([KEYNOTE], ['events', 'talks'], 'day1', COLLECTIONS, d)

    expect(moved).toBe(2)
    expect(d.patchFolder).toHaveBeenCalledTimes(1)
    expect(d.patchFolder).toHaveBeenCalledWith('talks', { parent_id: 'day1' })
    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledWith(
      "Couldn't move 1 of 3: Events can't go inside itself or one of its own folders."
    )
  })

  test('video and folder failures share one summary', async () => {
    const d = deps()
    d.write.mockImplementation(() => Promise.reject(new Error('Failed to fetch')))
    d.patchFolder.mockImplementation(() => Promise.reject(new Error('refused')))

    expect(await runMoveSelection([KEYNOTE], ['talks'], 'uck26', COLLECTIONS, d)).toBe(0)

    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledWith(
      "Couldn't move 2 of 2: Could not move Keynote to UCK 26: Failed to fetch (and 1 more)"
    )
    expect(d.refresh).toHaveBeenCalledTimes(1)
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('whatever is already there sends nothing', async () => {
    const d = deps()
    const inEvents = { ...PANEL, collection_id: 'events' }
    expect(await runMoveSelection([inEvents], ['uck26'], 'events', COLLECTIONS, d)).toBe(0)
    expect(d.calls).toEqual(['refresh', 'refreshCollections'])
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('nothing selected does nothing', async () => {
    const d = deps()
    expect(await runMoveSelection([], [], 'talks', COLLECTIONS, d)).toBe(0)
    expect(d.calls).toEqual([])
  })
})

describe('folderMoveProblem', () => {
  test('a legal move has none', () => {
    expect(folderMoveProblem(COLLECTIONS, 'talks', 'events')).toBeNull()
    expect(folderMoveProblem(COLLECTIONS, 'uck26', null)).toBeNull()
  })

  test('itself, a subfolder, an orphan id', () => {
    expect(folderMoveProblem(COLLECTIONS, 'events', 'events')).toMatch(/inside itself/)
    expect(folderMoveProblem(COLLECTIONS, 'events', 'day1')).toMatch(/inside itself/)
    expect(folderMoveProblem(COLLECTIONS, 'old-event', 'talks')).toBe(
      'old-event is not a folder yet, so it was not moved.'
    )
  })

  test('too deep', () => {
    const chain = Array.from({ length: 8 }, (_, i) =>
      folder(`l${i}`, `L${i}`, i === 0 ? null : `l${i - 1}`)
    )
    const tree = [...chain, folder('top', 'Top'), folder('child', 'Child', 'top')]
    expect(folderMoveProblem(tree, 'top', 'l7')).toBe(
      "Top can't go into L7: folders would nest too deep."
    )
  })
})

describe('selectionMoveOptions', () => {
  test('Top level, then the whole tree', () => {
    const options = selectionMoveOptions(COLLECTIONS, [KEYNOTE], [])
    expect(options.map((o) => o.label)).toEqual(['Top level', 'Events', 'UCK 26', 'Day 1', 'Talks'])
  })

  test('checks the place every selected item shares', () => {
    const options = selectionMoveOptions(COLLECTIONS, [PANEL], [])
    expect(options.filter((o) => o.checked).map((o) => o.id)).toEqual(['talks'])
    const top = selectionMoveOptions(COLLECTIONS, [KEYNOTE], ['events'])
    expect(top.filter((o) => o.checked).map((o) => o.id)).toEqual([null])
  })

  test('checks nothing when they are in different places', () => {
    const options = selectionMoveOptions(COLLECTIONS, [KEYNOTE, PANEL], [])
    expect(options.some((o) => o.checked)).toBe(false)
  })
})
