/**
 * What the library's folder actions do with the backend's answers: rename
 * refuses a blank name before any request, a refusal is shown with its human
 * copy (never swallowed), and every change re-reads the folders once.
 */

import { describe, expect, test, vi } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { EMPTY_OVERRIDES } from './collectionTypes'
import { CollectionInvalidError, CollectionRefusedError } from './collectionsApi'
import { runAdoptOrphan, runDeleteFolder, runMoveFolder, runRenameFolder } from './folderActions'

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

const EVENTS = folder('events', 'Events')
const UCK = folder('uck26', 'UCK 26', 'events')
const TREE = [EVENTS, UCK]

function deps() {
  return {
    create: vi.fn((input: { id?: string; name: string }) =>
      Promise.resolve(folder(input.id ?? 'new', input.name))
    ),
    patch: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve()),
    refreshCollections: vi.fn(() => Promise.resolve()),
    notify: vi.fn(),
    inform: vi.fn(),
  }
}

describe('runRenameFolder', () => {
  test('writes the trimmed name and re-reads the folders', async () => {
    const d = deps()
    expect(await runRenameFolder(UCK, '  Day 1 ', d)).toEqual({ kind: 'renamed' })
    expect(d.patch).toHaveBeenCalledWith('uck26', { name: 'Day 1' })
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('a blank name is refused inline and never sent', async () => {
    const d = deps()
    expect(await runRenameFolder(UCK, '  ', d)).toEqual({
      kind: 'invalid',
      message: 'A folder needs a name.',
    })
    expect(d.patch).not.toHaveBeenCalled()
  })

  test('the same name sends nothing', async () => {
    const d = deps()
    expect(await runRenameFolder(UCK, 'UCK 26', d)).toEqual({ kind: 'renamed' })
    expect(d.patch).not.toHaveBeenCalled()
  })

  test('a 422 stays inline; anything else is toasted', async () => {
    const d = deps()
    d.patch.mockImplementationOnce(() => Promise.reject(new CollectionInvalidError('Too long')))
    expect(await runRenameFolder(UCK, 'x', d)).toEqual({ kind: 'invalid', message: 'Too long' })
    expect(d.notify).not.toHaveBeenCalled()

    d.patch.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    expect(await runRenameFolder(UCK, 'x', d)).toEqual({ kind: 'failed' })
    expect(d.notify).toHaveBeenCalledWith('Could not rename UCK 26: Failed to fetch')
  })
})

describe('runMoveFolder', () => {
  test('PATCHes parent_id, null for the top level', async () => {
    const d = deps()
    expect(await runMoveFolder(UCK, null, TREE, d)).toBe(true)
    expect(d.patch).toHaveBeenCalledWith('uck26', { parent_id: null })
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('a nesting refusal is toasted with its human copy, and the folders re-read', async () => {
    const d = deps()
    d.patch.mockImplementationOnce(() =>
      Promise.reject(new CollectionRefusedError({ kind: 'collection_cycle' }))
    )
    expect(await runMoveFolder(EVENTS, 'uck26', TREE, d)).toBe(false)
    expect(d.notify).toHaveBeenCalledWith(
      'Could not move Events into UCK 26: A folder can’t move inside itself or one of its subfolders.'
    )
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('the top level is named as such in a failure', async () => {
    const d = deps()
    d.patch.mockImplementationOnce(() => Promise.reject(new Error('nope')))
    await runMoveFolder(UCK, null, TREE, d)
    expect(d.notify).toHaveBeenCalledWith('Could not move UCK 26 to the top level: nope')
  })
})

describe('runDeleteFolder', () => {
  test('deletes, confirms and re-reads', async () => {
    const d = deps()
    expect(await runDeleteFolder(UCK, d)).toBe(true)
    expect(d.remove).toHaveBeenCalledWith('uck26')
    expect(d.inform).toHaveBeenCalledWith('Deleted the folder UCK 26')
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('a refusal (the list was stale) is toasted and the folders re-read', async () => {
    const d = deps()
    d.remove.mockImplementationOnce(() =>
      Promise.reject(new CollectionRefusedError({ kind: 'collection_has_children', children: 2 }))
    )
    expect(await runDeleteFolder(EVENTS, d)).toBe(false)
    expect(d.notify.mock.calls[0][0]).toBe(
      'Could not delete Events: 2 subfolders are still inside this folder — move or delete them first.'
    )
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
    expect(d.inform).not.toHaveBeenCalled()
  })
})

describe('runAdoptOrphan', () => {
  test('creates a folder with that exact id, named by it', async () => {
    const d = deps()
    expect(await runAdoptOrphan('old-event', d)).toBe(true)
    expect(d.create).toHaveBeenCalledWith({ id: 'old-event', name: 'old-event' })
    expect(d.inform).toHaveBeenCalledWith('Created the folder old-event')
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })

  test('a failure is toasted', async () => {
    const d = deps()
    d.create.mockImplementationOnce(() =>
      Promise.reject(new CollectionRefusedError({ kind: 'collection_exists' }))
    )
    expect(await runAdoptOrphan('old-event', d)).toBe(false)
    expect(d.notify.mock.calls[0][0]).toContain('Could not create the folder old-event: ')
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
  })
})
