/**
 * The collections boundary: what the renderer accepts from
 * `GET|POST|PATCH /api/library/collections[/{cid}]`.
 *
 * Same rule as `publishTypes.ts` — a body that cannot be addressed (no `id`)
 * throws with a message a user can act on; a field the backend has not grown
 * degrades to a defined empty value. An override is `null` ("inherit the
 * channel") unless the backend sent a value.
 */

import { describe, expect, test } from 'vitest'
import {
  BRIEF_OVERRIDE_FIELDS,
  COLLECTION_DETAIL_SHAPE_MESSAGE,
  COLLECTION_SHAPE_MESSAGE,
  COLLECTIONS_LIST_SHAPE_MESSAGE,
  EMPTY_OVERRIDES,
  parseBriefOverrides,
  parseCollection,
  parseCollectionDetail,
  parseCollectionsList,
} from './collectionTypes'
import { parseBrief } from './publishTypes'

const RAW = {
  id: 'uck26',
  name: 'UCK 26',
  slots: { event: 'UCK 26', city: 'Prague', broken: 7 },
  overrides: { footer: 'Thanks to {{sponsor}}', default_hashtags: ['#uck26'], voice: null },
  createdAt: '2026-09-15T08:00:00Z',
  updatedAt: '2026-09-15T09:00:00Z',
  members: 3,
}

describe('BRIEF_OVERRIDE_FIELDS', () => {
  test('is every Brief field except slots, once', () => {
    const briefFields = Object.keys(parseBrief({})).filter((k) => k !== 'slots')
    expect([...BRIEF_OVERRIDE_FIELDS].sort()).toEqual(briefFields.sort())
    expect(new Set(BRIEF_OVERRIDE_FIELDS).size).toBe(BRIEF_OVERRIDE_FIELDS.length)
  })

  test('EMPTY_OVERRIDES inherits everything', () => {
    for (const field of BRIEF_OVERRIDE_FIELDS) expect(EMPTY_OVERRIDES[field]).toBeNull()
  })
})

describe('parseBriefOverrides', () => {
  test('keeps what was sent, parsed like the brief, and nulls the rest', () => {
    const overrides = parseBriefOverrides({
      footer: 'F',
      link_rows: [{ label: 'Site', url: 'https://x' }, 'junk'],
      house_rules: { no_em_dashes: true, description_chars: [1, 2] },
      audience: null,
    })

    expect(overrides.footer).toBe('F')
    expect(overrides.link_rows).toEqual([{ label: 'Site', url: 'https://x' }])
    expect(overrides.house_rules).toEqual({
      no_em_dashes: true,
      description_chars: [1, 2],
      keywords_terms: null,
      hook_first_150: true,
    })
    expect(overrides.audience).toBeNull()
    expect(overrides.description_template).toBeNull()
  })

  test('an empty string is an override, not an inherit', () => {
    expect(parseBriefOverrides({ footer: '' }).footer).toBe('')
  })

  test('a missing or malformed body inherits everything', () => {
    expect(parseBriefOverrides(undefined)).toEqual(EMPTY_OVERRIDES)
    expect(parseBriefOverrides([1, 2])).toEqual(EMPTY_OVERRIDES)
  })
})

describe('parseCollection', () => {
  test('reads a list row with its member count', () => {
    const collection = parseCollection(RAW)

    expect(collection.id).toBe('uck26')
    expect(collection.name).toBe('UCK 26')
    expect(collection.slots).toEqual({ event: 'UCK 26', city: 'Prague' })
    expect(collection.overrides.footer).toBe('Thanks to {{sponsor}}')
    expect(collection.overrides.default_hashtags).toEqual(['#uck26'])
    expect(collection.overrides.voice).toBeNull()
    expect(collection.members).toBe(3)
    expect(collection.updatedAt).toBe('2026-09-15T09:00:00Z')
  })

  test('defaults a missing name to the id and a bad member count to zero', () => {
    const collection = parseCollection({ id: 'x', members: -2 })
    expect(collection.name).toBe('x')
    expect(collection.members).toBe(0)
    expect(collection.slots).toEqual({})
  })

  test('throws when there is no id to address it by', () => {
    expect(() => parseCollection({ name: 'n' })).toThrow(COLLECTION_SHAPE_MESSAGE)
    expect(() => parseCollection(null)).toThrow(COLLECTION_SHAPE_MESSAGE)
  })
})

describe('parseCollectionsList', () => {
  test('reads collections and orphans', () => {
    const list = parseCollectionsList({
      collections: [RAW],
      orphans: [{ id: 'old-event', members: 2 }, { members: 1 }],
    })

    expect(list.collections.map((c) => c.id)).toEqual(['uck26'])
    expect(list.orphans).toEqual([{ id: 'old-event', members: 2 }])
  })

  test('an envelope without orphans still lists the collections', () => {
    expect(parseCollectionsList({ collections: [] }).orphans).toEqual([])
  })

  test('throws when the envelope is not a list', () => {
    expect(() => parseCollectionsList({})).toThrow(COLLECTIONS_LIST_SHAPE_MESSAGE)
  })
})

describe('parseCollectionDetail', () => {
  test('carries the effective brief', () => {
    const detail = parseCollectionDetail({
      ...RAW,
      effective_brief: { channel: 'CapForge', footer: 'Thanks', slots: { event: 'UCK 26' } },
    })

    expect(detail.members).toBe(3)
    expect(detail.effective_brief.channel).toBe('CapForge')
    expect(detail.effective_brief.slots).toEqual({ event: 'UCK 26' })
  })

  test('throws without an effective brief — defaults would misreport the channel', () => {
    expect(() => parseCollectionDetail(RAW)).toThrow(COLLECTION_DETAIL_SHAPE_MESSAGE)
  })
})
