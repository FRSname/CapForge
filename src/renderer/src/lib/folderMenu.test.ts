/**
 * The library folder menu's decisions: which items are disabled and why (the
 * reason is shown, never a silently dead item), and what "Move to…" offers.
 */

import { describe, expect, test } from 'vitest'
import type { CollectionSummary } from './collectionTypes'
import { EMPTY_OVERRIDES } from './collectionTypes'
import { MAX_COLLECTION_DEPTH } from './collectionTree'
import { folderMenuModel, renameProblem } from './folderMenu'

function folder(id: string, parent_id: string | null, members = 0): CollectionSummary {
  return {
    id,
    name: id.toUpperCase(),
    slots: {},
    overrides: EMPTY_OVERRIDES,
    createdAt: '',
    updatedAt: '',
    members,
    parent_id,
    total_members: members,
    path: [id],
  }
}

const TREE = [
  folder('events', null),
  folder('uck26', 'events', 2),
  folder('day-1', 'uck26'),
  folder('tutorials', null),
]

describe('folderMenuModel', () => {
  test('an empty leaf folder can be deleted and take a new folder', () => {
    const model = folderMenuModel('day-1', TREE)
    expect(model.deleteBlocker).toBeNull()
    expect(model.newInsideBlocker).toBeNull()
  })

  test('delete is disabled while the folder holds videos, saying so first', () => {
    expect(folderMenuModel('uck26', TREE).deleteBlocker).toContain('2 videos belong to this folder')
  })

  test('delete is disabled while the folder holds subfolders', () => {
    expect(folderMenuModel('events', TREE).deleteBlocker).toContain(
      '1 subfolder is inside this folder'
    )
  })

  test('a folder at the depth limit cannot take a new folder, and says why', () => {
    const chain = Array.from({ length: MAX_COLLECTION_DEPTH }, (_, i) =>
      folder(`f${i}`, i === 0 ? null : `f${i - 1}`)
    )
    const deepest = `f${MAX_COLLECTION_DEPTH - 1}`
    expect(folderMenuModel(deepest, chain).newInsideBlocker).toContain(
      `at most ${MAX_COLLECTION_DEPTH} levels`
    )
    expect(folderMenuModel('f0', chain).newInsideBlocker).toBeNull()
  })

  test('Move to… offers Top level and every legal target by path, the parent checked', () => {
    const options = folderMenuModel('day-1', TREE).moveOptions
    expect(options.map((o) => [o.id, o.label, o.checked])).toEqual([
      [null, 'Top level', false],
      ['events', 'EVENTS', false],
      ['uck26', 'EVENTS › UCK26', true],
      ['tutorials', 'TUTORIALS', false],
    ])
  })

  test('Move to… never offers the folder itself or anything inside it', () => {
    const ids = folderMenuModel('events', TREE).moveOptions.map((o) => o.id)
    expect(ids).toEqual([null, 'tutorials'])
    expect(folderMenuModel('events', TREE).moveOptions[0].checked).toBe(true)
  })
})

describe('renameProblem', () => {
  test('an empty or blank name is refused inline', () => {
    expect(renameProblem('')).toBe('A folder needs a name.')
    expect(renameProblem('   ')).toBe('A folder needs a name.')
    expect(renameProblem(' Day 1 ')).toBeNull()
  })
})
