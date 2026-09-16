/**
 * Remove / Delete for a multi-selection: each record in turn through its
 * one-record request, one refresh of the list and the folders at the end, one
 * failure summary — and the copy the selection bar shows.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  FOLDERS_BLOCK_BULK,
  NO_VIDEO_SELECTED,
  bulkBlocker,
  bulkConfirmPrompt,
  bulkFailedMessage,
  runBulkRecords,
} from './libraryBulk'

const KEYNOTE = { id: 'v1', title: 'Keynote', sourcePath: '/m/k.mp4' }
const PANEL = { id: 'v2', title: '', sourcePath: '/m/Panel.mp4' }
const QA = { id: 'v3', title: 'Q&A', sourcePath: '/m/q.mp4' }

function deps() {
  const calls: string[] = []
  return {
    calls,
    removeOne: vi.fn((video: { id: string }) => {
      calls.push(`remove ${video.id}`)
      return Promise.resolve()
    }),
    deleteOne: vi.fn((video: { id: string }) => {
      calls.push(`delete ${video.id}`)
      return Promise.resolve()
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

describe('runBulkRecords', () => {
  test('remove: each record in turn, then one refresh of the list and the folders', async () => {
    const d = deps()
    expect(await runBulkRecords('remove', [KEYNOTE, PANEL, QA], d)).toBe(3)
    expect(d.calls).toEqual([
      'remove v1',
      'remove v2',
      'remove v3',
      'refresh',
      'refreshCollections',
    ])
    expect(d.deleteOne).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('delete: the detach-and-trash path, never the remove one', async () => {
    const d = deps()
    expect(await runBulkRecords('delete', [KEYNOTE, PANEL], d)).toBe(2)
    expect(d.calls).toEqual(['delete v1', 'delete v2', 'refresh', 'refreshCollections'])
    expect(d.removeOne).not.toHaveBeenCalled()
  })

  test('a failure does not stop the rest, and every failure is one toast', async () => {
    const d = deps()
    d.deleteOne.mockImplementation((video: { id: string }) =>
      video.id === 'v1' ? Promise.resolve() : Promise.reject(new Error('Trash refused'))
    )

    expect(await runBulkRecords('delete', [KEYNOTE, PANEL, QA], d)).toBe(1)

    expect(d.deleteOne).toHaveBeenCalledTimes(3)
    expect(d.refresh).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledWith(
      "Couldn't delete 2 of 3: Could not delete Panel: Trash refused (and 1 more)"
    )
  })

  test('a non-Error rejection is still named', async () => {
    const d = deps()
    d.removeOne.mockImplementation(() => Promise.reject('offline'))
    await runBulkRecords('remove', [KEYNOTE], d)
    expect(d.notify).toHaveBeenCalledWith('Could not remove Keynote from the library: offline')
  })

  test('refreshes even when everything failed', async () => {
    const d = deps()
    d.removeOne.mockImplementation(() => Promise.reject(new Error('nope')))
    expect(await runBulkRecords('remove', [KEYNOTE, PANEL], d)).toBe(0)
    expect(d.refresh).toHaveBeenCalledTimes(1)
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('nothing selected does nothing', async () => {
    const d = deps()
    expect(await runBulkRecords('remove', [], d)).toBe(0)
    expect(d.calls).toEqual([])
    expect(d.notify).not.toHaveBeenCalled()
  })
})

describe('bulkFailedMessage', () => {
  test('one video alone keeps its own message', () => {
    expect(bulkFailedMessage('remove', ['Could not remove Keynote from the library: x'], 1)).toBe(
      'Could not remove Keynote from the library: x'
    )
  })

  test('a batch counts and names the first', () => {
    expect(bulkFailedMessage('remove', ['first'], 4)).toBe("Couldn't remove 1 of 4: first")
  })
})

describe('bulkBlocker', () => {
  test('videos only: nothing blocks', () => {
    expect(bulkBlocker({ folderIds: [], videoIds: ['a', 'b'] })).toBeNull()
  })

  test('a folder in the selection blocks, with the reason', () => {
    expect(bulkBlocker({ folderIds: ['events'], videoIds: ['a'] })).toBe(FOLDERS_BLOCK_BULK)
    expect(FOLDERS_BLOCK_BULK).toBe(
      "Folders can't be removed — deselect them or delete them from their menu."
    )
  })

  test('no video selected blocks too', () => {
    expect(bulkBlocker({ folderIds: [], videoIds: [] })).toBe(NO_VIDEO_SELECTED)
  })
})

describe('bulkConfirmPrompt', () => {
  test('names the count, and what happens to the files', () => {
    expect(bulkConfirmPrompt('remove', 3)).toBe(
      'Remove 3 videos from the library? Their files are kept.'
    )
    expect(bulkConfirmPrompt('delete', 1)).toBe(
      'Delete 1 video? Their library folders go to the Trash.'
    )
  })
})
