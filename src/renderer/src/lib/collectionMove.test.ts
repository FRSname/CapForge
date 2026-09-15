/**
 * Moving one video into a collection from its library card: the list has no
 * `rev`, so the write reads the record first, PATCHes with `If-Match`, and on a
 * `409` re-reads and retries exactly once. Plus what each failure tells the user
 * and what the sub-list offers.
 */

import { describe, expect, test, vi } from 'vitest'
import { StaleRecordError, ValidationRefusedError } from './api'
import type { CollectionSummary } from './collectionTypes'
import {
  assignCollection,
  moveFailureOf,
  moveMenuOptions,
  moveTargetLabel,
  runMoveToCollection,
} from './collectionMove'

const VIDEO = { id: 'vid_1', title: 'Keynote', sourcePath: '/media/Keynote.mp4' }

function collection(id: string, name: string): CollectionSummary {
  return {
    id,
    name,
    slots: {},
    overrides: {} as never,
    createdAt: '',
    updatedAt: '',
    members: 0,
  }
}

const COLLECTIONS = [collection('uck26', 'UCK 26'), collection('meetup', 'Meetup')]

function stale(): StaleRecordError {
  return new StaleRecordError('Record changed', null)
}

function unknownCollection(): ValidationRefusedError {
  return new ValidationRefusedError('1 violation', [
    {
      field: 'collection_id',
      rule: 'unknown_collection',
      message: "No collection has the id 'uck26'",
      severity: 'hard',
    },
  ])
}

describe('assignCollection', () => {
  test('reads the rev, then PATCHes collection_id with it', async () => {
    const read = vi.fn(() => Promise.resolve({ rev: 4, collection_id: null }))
    const write = vi.fn(() => Promise.resolve({}))

    const outcome = await assignCollection('vid_1', 'uck26', { read, write })

    expect(outcome).toBe('moved')
    expect(read).toHaveBeenCalledWith('vid_1')
    expect(write).toHaveBeenCalledWith('vid_1', { collection_id: 'uck26' }, 4)
  })

  test('None writes an explicit null', async () => {
    const read = vi.fn(() => Promise.resolve({ rev: 2, collection_id: 'uck26' }))
    const write = vi.fn(() => Promise.resolve({}))

    await assignCollection('vid_1', null, { read, write })

    expect(write).toHaveBeenCalledWith('vid_1', { collection_id: null }, 2)
  })

  test('a 409 re-reads and retries once with the fresh rev', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ rev: 4, collection_id: null })
      .mockResolvedValueOnce({ rev: 5, collection_id: null })
    const write = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValueOnce({})

    const outcome = await assignCollection('vid_1', 'uck26', { read, write })

    expect(outcome).toBe('moved')
    expect(read).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(2, 'vid_1', { collection_id: 'uck26' }, 5)
  })

  test('a second 409 is not retried again: it propagates', async () => {
    const read = vi.fn(() => Promise.resolve({ rev: 4, collection_id: null }))
    const write = vi.fn(() => Promise.reject(stale()))

    await expect(assignCollection('vid_1', 'uck26', { read, write })).rejects.toBeInstanceOf(
      StaleRecordError
    )
    expect(write).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('a non-409 failure is never retried', async () => {
    const read = vi.fn(() => Promise.resolve({ rev: 4, collection_id: null }))
    const write = vi.fn(() => Promise.reject(unknownCollection()))

    await expect(assignCollection('vid_1', 'uck26', { read, write })).rejects.toBeInstanceOf(
      ValidationRefusedError
    )
    expect(write).toHaveBeenCalledTimes(1)
  })

  test('a record already in the collection is not written', async () => {
    const read = vi.fn(() => Promise.resolve({ rev: 4, collection_id: 'uck26' }))
    const write = vi.fn()

    expect(await assignCollection('vid_1', 'uck26', { read, write })).toBe('unchanged')
    expect(write).not.toHaveBeenCalled()
  })

  test('if the re-read shows someone already made the move, the retry is skipped', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ rev: 4, collection_id: null })
      .mockResolvedValueOnce({ rev: 5, collection_id: 'uck26' })
    const write = vi.fn().mockRejectedValueOnce(stale())

    expect(await assignCollection('vid_1', 'uck26', { read, write })).toBe('unchanged')
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('moveFailureOf', () => {
  test('a deleted collection is recognised by its rule', () => {
    const failure = moveFailureOf(unknownCollection(), 'Keynote', 'UCK 26')
    expect(failure.kind).toBe('unknown_collection')
    expect(failure.message).toContain('UCK 26')
    expect(failure.message).toContain('Keynote')
  })

  test('two collisions in a row say to try again', () => {
    const failure = moveFailureOf(stale(), 'Keynote', 'UCK 26')
    expect(failure.kind).toBe('failed')
    expect(failure.message).toContain('try again')
  })

  test('anything else names the video, the target and the reason', () => {
    const failure = moveFailureOf(new Error('Failed to fetch'), 'Keynote', 'UCK 26')
    expect(failure).toEqual({
      kind: 'failed',
      message: 'Could not move Keynote to UCK 26: Failed to fetch',
    })
  })
})

describe('moveTargetLabel', () => {
  test('None, a named collection, or the bare id', () => {
    expect(moveTargetLabel(COLLECTIONS, null)).toBe('no collection')
    expect(moveTargetLabel(COLLECTIONS, 'uck26')).toBe('UCK 26')
    expect(moveTargetLabel(COLLECTIONS, 'gone')).toBe('gone')
  })
})

describe('moveMenuOptions', () => {
  test('None first, then every collection, with the current one checked', () => {
    expect(moveMenuOptions(COLLECTIONS, 'meetup')).toEqual([
      { id: null, label: 'None', checked: false },
      { id: 'uck26', label: 'UCK 26', checked: false },
      { id: 'meetup', label: 'Meetup', checked: true },
    ])
  })

  test('a record in no collection has None checked', () => {
    expect(moveMenuOptions(COLLECTIONS, null)[0]).toEqual({
      id: null,
      label: 'None',
      checked: true,
    })
  })

  test('an orphan id the record carries is kept, checked, and said to be missing', () => {
    const options = moveMenuOptions(COLLECTIONS, 'old-event')
    expect(options).toHaveLength(4)
    expect(options[3]).toEqual({
      id: 'old-event',
      label: 'old-event (no such collection)',
      checked: true,
    })
  })
})

describe('runMoveToCollection', () => {
  function moveDeps(write: () => Promise<unknown>) {
    return {
      read: vi.fn(() => Promise.resolve({ rev: 1, collection_id: null })),
      write: vi.fn(write),
      refresh: vi.fn(() => Promise.resolve()),
      refreshCollections: vi.fn(() => Promise.resolve()),
      notify: vi.fn(),
    }
  }

  test('on success the library list is refreshed and nothing is toasted', async () => {
    const d = moveDeps(() => Promise.resolve({}))

    expect(await runMoveToCollection(VIDEO, 'uck26', COLLECTIONS, d)).toBe(true)

    expect(d.refresh).toHaveBeenCalledTimes(1)
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('a deleted collection refreshes the collections and toasts', async () => {
    const d = moveDeps(() => Promise.reject(unknownCollection()))

    expect(await runMoveToCollection(VIDEO, 'uck26', COLLECTIONS, d)).toBe(false)

    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.refresh).not.toHaveBeenCalled()
  })

  test('a failed read is toasted too', async () => {
    const d = moveDeps(() => Promise.resolve({}))
    d.read.mockImplementation(() => Promise.reject(new Error('404 Not Found')))

    expect(await runMoveToCollection(VIDEO, null, COLLECTIONS, d)).toBe(false)

    expect(d.notify.mock.calls[0][0]).toBe('Could not move Keynote to no collection: 404 Not Found')
    expect(d.refreshCollections).not.toHaveBeenCalled()
  })
})
