/**
 * Creating a folder (a collection) from the library screen: what the name
 * form shows, which failures stay inline under the input and which are
 * toasted, and where the "New folder…" affordance is offered.
 */

import { describe, expect, test, vi } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { CollectionInvalidError, CollectionRefusedError } from './collectionsApi'
import {
  canCreateCollection,
  collectionCreatedMessage,
  createInlineError,
  newCollectionHint,
  newCollectionPlacement,
  runCreateCollection,
} from './collectionCreate'

const CREATED: CollectionSummary = {
  id: 'uck-26',
  name: 'UCK 26',
  slots: {},
  overrides: {} as never,
  createdAt: '',
  updatedAt: '',
  members: 0,
  parent_id: null,
  total_members: 0,
  path: ['UCK 26'],
}

function deps(create: () => Promise<CollectionSummary>) {
  return {
    create: vi.fn(create),
    refreshCollections: vi.fn(() => Promise.resolve()),
    notify: vi.fn(),
    inform: vi.fn(),
  }
}

describe('newCollectionHint', () => {
  test('previews the slug the backend will probably pick', () => {
    expect(newCollectionHint('  UCK 26 ')).toContain('uck-26')
  })

  test('says nothing until the name has something to slug', () => {
    expect(newCollectionHint('')).toBeNull()
    expect(newCollectionHint('   ')).toBeNull()
  })
})

describe('canCreateCollection', () => {
  test('needs a non-blank name and no request in flight', () => {
    expect(canCreateCollection('UCK', false)).toBe(true)
    expect(canCreateCollection('   ', false)).toBe(false)
    expect(canCreateCollection('UCK', true)).toBe(false)
  })
})

describe('createInlineError', () => {
  test('an existing id stays under the input', () => {
    const err = new CollectionRefusedError({ kind: 'collection_exists' })
    expect(createInlineError(err)).toContain('already exists')
  })

  test('a 422 stays under the input, with the backend message', () => {
    const err = new CollectionInvalidError('name: String should have at most 120 characters')
    expect(createInlineError(err)).toBe('name: String should have at most 120 characters')
  })

  test('a place the tree cannot take stays under the input too', () => {
    const deep = new CollectionRefusedError({ kind: 'collection_too_deep' })
    expect(createInlineError(deep)).toContain('levels deep')
    const gone = new CollectionRefusedError({ kind: 'unknown_parent' })
    expect(createInlineError(gone)).toContain('no longer exists')
  })

  test('anything else is not inline (it is toasted)', () => {
    expect(createInlineError(new Error('Failed to fetch'))).toBeNull()
    expect(
      createInlineError(new CollectionRefusedError({ kind: 'collection_in_use', members: 2 }))
    ).toBeNull()
  })
})

describe('runCreateCollection', () => {
  test('creates by the trimmed name, refreshes the list and confirms', async () => {
    const d = deps(() => Promise.resolve(CREATED))

    const result = await runCreateCollection('  UCK 26  ', d)

    expect(result).toEqual({ kind: 'created', collection: CREATED })
    expect(d.create).toHaveBeenCalledWith({ name: 'UCK 26' })
    expect(d.refreshCollections).toHaveBeenCalledTimes(1)
    expect(d.inform).toHaveBeenCalledWith(collectionCreatedMessage('UCK 26'))
    expect(d.notify).not.toHaveBeenCalled()
  })

  test('an inline refusal is returned, not toasted, and nothing is refreshed', async () => {
    const d = deps(() => Promise.reject(new CollectionInvalidError('name: too long')))

    const result = await runCreateCollection('x', d)

    expect(result).toEqual({ kind: 'invalid', message: 'name: too long' })
    expect(d.notify).not.toHaveBeenCalled()
    expect(d.refreshCollections).not.toHaveBeenCalled()
  })

  test('any other failure is toasted with its reason', async () => {
    const d = deps(() => Promise.reject(new Error('Failed to fetch')))

    const result = await runCreateCollection('UCK', d)

    expect(result).toEqual({ kind: 'failed' })
    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.notify.mock.calls[0][0]).toContain('Failed to fetch')
  })

  test('inside a folder, the parent rides the body; at the top level the key is absent', async () => {
    const d = deps(() => Promise.resolve(CREATED))

    await runCreateCollection('Day 1', d, 'uck-26')
    await runCreateCollection('Day 2', d, null)

    expect(d.create).toHaveBeenNthCalledWith(1, { name: 'Day 1', parent_id: 'uck-26' })
    expect(d.create).toHaveBeenNthCalledWith(2, { name: 'Day 2' })
  })

  test('a blank name never reaches the backend', async () => {
    const d = deps(() => Promise.resolve(CREATED))

    const result = await runCreateCollection('   ', d)

    expect(result.kind).toBe('invalid')
    expect(d.create).not.toHaveBeenCalled()
  })
})

describe('newCollectionPlacement', () => {
  test('in the sidebar whenever the library has videos', () => {
    expect(newCollectionPlacement(3, [])).toBe('sidebar')
    expect(newCollectionPlacement(3, [CREATED])).toBe('sidebar')
    expect(newCollectionPlacement(3, null)).toBe('sidebar')
  })

  test('with no videos: the sidebar if folders exist, the empty state once loaded empty', () => {
    expect(newCollectionPlacement(0, [])).toBe('empty-state')
    expect(newCollectionPlacement(0, null)).toBe('none')
    expect(newCollectionPlacement(0, [CREATED])).toBe('sidebar')
  })
})
