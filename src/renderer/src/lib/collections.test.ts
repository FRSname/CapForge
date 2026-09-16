/**
 * The pure half of Collections: slot names, the id preview, the override
 * count, template insertion, the refusal mapping and the package preview.
 *
 * The backend is the authority on every one of these (names, ids, the
 * template itself); what is pinned here is that the hints never contradict it
 * — `BUILTIN_SLOTS` is asserted against the fixture the backend reads too.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { EMPTY_OVERRIDES } from './collectionTypes'
import type { CollectionSummary } from './collectionTypes'
import {
  BUILTIN_SLOTS,
  briefValueSummary,
  videoCount,
  PACKAGE_DESCRIPTION_FIELD,
  collectionLabel,
  collectionRefusal,
  collectionRefusalMessage,
  inheritedFrom,
  insertSlotToken,
  overriddenFields,
  overridesSummary,
  packageDescriptionViolations,
  paletteSlots,
  slotNameProblem,
  slotRows,
  slotsFromRows,
  slugPreview,
  subfolderCount,
} from './collections'

const BUILTIN_SLOTS_FIXTURE = join(process.cwd(), 'backend/tests/fixtures/builtin_slots.json')

describe('BUILTIN_SLOTS', () => {
  test('equals the shared fixture', () => {
    const fixture = JSON.parse(readFileSync(BUILTIN_SLOTS_FIXTURE, 'utf-8')) as {
      slots: string[]
    }
    expect([...BUILTIN_SLOTS]).toEqual(fixture.slots)
    expect(new Set(BUILTIN_SLOTS).size).toBe(BUILTIN_SLOTS.length)
  })
})

describe('slotNameProblem', () => {
  test.each(['event', 'city_2', 'a', 'x'.repeat(32)])('accepts %s', (name) => {
    expect(slotNameProblem(name)).toBeNull()
  })

  test.each(['', '2event', 'Event', 'my-slot', 'has space', 'x'.repeat(33)])(
    'rejects %j',
    (name) => {
      expect(slotNameProblem(name)).toMatch(/.+/)
    }
  )

  test('refuses to shadow a built-in slot', () => {
    expect(slotNameProblem('footer')).toContain('built-in')
  })

  test('refuses a duplicate among the other rows', () => {
    expect(slotNameProblem('event', ['city', 'event'])).toContain('twice')
  })
})

describe('slugPreview', () => {
  test.each([
    ['UCK 26', 'uck-26'],
    ['  Prague — Summit!  ', 'prague-summit'],
    ['Café Crème', 'cafe-creme'],
    ['---', ''],
  ])('%j → %j', (name, slug) => {
    expect(slugPreview(name)).toBe(slug)
  })

  test('never exceeds the id length the backend accepts', () => {
    const slug = slugPreview('word '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('overriddenFields and overridesSummary', () => {
  test('lists only the fields that do not inherit, in field order', () => {
    const overrides = {
      ...EMPTY_OVERRIDES,
      footer: '',
      default_hashtags: ['#a'],
      channel: 'X',
    }
    expect(overriddenFields(overrides)).toEqual(['channel', 'footer', 'default_hashtags'])
    expect(overriddenFields(EMPTY_OVERRIDES)).toEqual([])
  })

  test('says how many, with the collection name', () => {
    expect(overridesSummary(3, 'UCK 26')).toBe('Uses 3 overrides from UCK 26')
    expect(overridesSummary(1, 'UCK 26')).toBe('Uses 1 override from UCK 26')
    expect(overridesSummary(0, 'UCK 26')).toBe('UCK 26 inherits the channel brief')
  })
})

describe('insertSlotToken', () => {
  test('replaces the selection and puts the caret after the token', () => {
    expect(insertSlotToken('Hello  world', 'event', 6, 6)).toEqual({
      text: 'Hello {{event}} world',
      caret: 15,
    })
    expect(insertSlotToken('abc', 'x', 1, 2)).toEqual({ text: 'a{{x}}c', caret: 6 })
  })

  test('clamps an out-of-range caret to the end', () => {
    expect(insertSlotToken('abc', 'x', 99, 99).text).toBe('abc{{x}}')
  })
})

describe('paletteSlots', () => {
  test('built-ins first, then custom names once, never a built-in twice', () => {
    expect(paletteSlots({ event: 'a', footer: 'x' }, { city: 'b', event: 'c' })).toEqual([
      ...BUILTIN_SLOTS,
      'event',
      'city',
    ])
  })
})

describe('slotRows and slotsFromRows', () => {
  test('round trip, trimming keys and dropping blank ones', () => {
    expect(slotRows({ event: 'UCK', city: 'Prague' })).toEqual([
      { key: 'event', value: 'UCK' },
      { key: 'city', value: 'Prague' },
    ])
    expect(
      slotsFromRows([
        { key: ' event ', value: 'UCK' },
        { key: '', value: 'lost' },
      ])
    ).toEqual({ event: 'UCK' })
  })
})

describe('collectionLabel', () => {
  const collections = [{ id: 'uck26', name: 'UCK 26' }] as CollectionSummary[]

  test('names a known collection, falls back to the id for an orphan', () => {
    expect(collectionLabel(collections, 'uck26')).toBe('UCK 26')
    expect(collectionLabel(collections, 'old')).toBe('old')
    expect(collectionLabel(collections, null)).toBeNull()
  })
})

describe('collectionRefusal', () => {
  test.each([
    [409, { reason: 'collection_exists' }, { kind: 'collection_exists' }],
    [409, { detail: { reason: 'collection_exists' } }, { kind: 'collection_exists' }],
    [409, { reason: 'collection_in_use', members: 4 }, { kind: 'collection_in_use', members: 4 }],
    [
      409,
      { detail: { reason: 'collection_in_use', members: 2 } },
      { kind: 'collection_in_use', members: 2 },
    ],
    [
      409,
      { reason: 'collection_has_children', children: 3 },
      { kind: 'collection_has_children', children: 3 },
    ],
    [
      409,
      { detail: { reason: 'collection_has_children', children: 1 } },
      { kind: 'collection_has_children', children: 1 },
    ],
    [422, { reason: 'unknown_parent', detail: 'x' }, { kind: 'unknown_parent' }],
    [422, { detail: { reason: 'collection_cycle' } }, { kind: 'collection_cycle' }],
    [422, { reason: 'collection_too_deep', max_depth: 8 }, { kind: 'collection_too_deep' }],
  ])('%s %j', (status, body, refusal) => {
    expect(collectionRefusal(status, body)).toEqual(refusal)
  })

  test('anything else is not a refusal', () => {
    expect(collectionRefusal(409, { detail: 'nope' })).toBeNull()
    expect(collectionRefusal(422, { reason: 'collection_exists' })).toBeNull()
    expect(collectionRefusal(409, { reason: 'unknown_parent' })).toBeNull()
    expect(collectionRefusal(422, { detail: [{ loc: ['body'], msg: 'bad' }] })).toBeNull()
  })

  test('the folder refusals speak of folders and say what to do', () => {
    expect(collectionRefusalMessage({ kind: 'collection_has_children', children: 1 })).toBe(
      '1 subfolder is still inside this folder — move or delete it first.'
    )
    expect(collectionRefusalMessage({ kind: 'collection_has_children', children: 2 })).toContain(
      '2 subfolders are still inside'
    )
    expect(collectionRefusalMessage({ kind: 'unknown_parent' })).toContain('pick another location')
    expect(collectionRefusalMessage({ kind: 'collection_cycle' })).toContain('inside itself')
    expect(collectionRefusalMessage({ kind: 'collection_too_deep' })).toContain('8 levels')
  })

  test('messages say what to do', () => {
    expect(collectionRefusalMessage({ kind: 'collection_exists' })).toContain('already exists')
    expect(collectionRefusalMessage({ kind: 'collection_in_use', members: 1 })).toContain('1 video')
    expect(collectionRefusalMessage({ kind: 'collection_in_use', members: 3 })).toContain(
      '3 videos'
    )
  })
})

describe('subfolderCount', () => {
  test('is singular for one', () => {
    expect(subfolderCount(1)).toBe('1 subfolder')
    expect(subfolderCount(0)).toBe('0 subfolders')
  })
})

describe('inheritedFrom', () => {
  const folder = (name: string, footer: string | null = null) => ({
    name,
    overrides: { ...EMPTY_OVERRIDES, footer },
  })

  test('names the deepest folder above that sets the field, by its path', () => {
    const ancestors = [folder('Events', 'E'), folder('UCK 2026', 'U'), folder('Day 1')]
    expect(inheritedFrom(ancestors, 'footer')).toBe('Events › UCK 2026')
  })

  test('skips folders that inherit, through two levels', () => {
    expect(inheritedFrom([folder('Events', 'E'), folder('UCK'), folder('Day 1')], 'footer')).toBe(
      'Events'
    )
  })

  test('is null when the value comes from the channel', () => {
    expect(inheritedFrom([folder('Events'), folder('UCK')], 'footer')).toBeNull()
    expect(inheritedFrom([], 'footer')).toBeNull()
  })

  test('an empty override is still a source', () => {
    expect(inheritedFrom([folder('Events', '')], 'footer')).toBe('Events')
  })
})

describe('packageDescriptionViolations', () => {
  test('keeps only the assembled-description findings', () => {
    const found = packageDescriptionViolations([
      { field: PACKAGE_DESCRIPTION_FIELD, rule: 'unknown_slot', message: 'm', severity: 'hard' },
      { field: 'title', rule: 'r', message: 'm', severity: 'hard' },
    ])
    expect(found.map((v) => v.rule)).toEqual(['unknown_slot'])
  })
})

describe('briefValueSummary', () => {
  test('says what an inherited field holds, in one short line', () => {
    expect(briefValueSummary('  Thanks for watching\nSecond line')).toBe('Thanks for watching…')
    expect(briefValueSummary('')).toBe('empty')
    expect(briefValueSummary(['#a', '#b'])).toBe('#a #b')
    expect(briefValueSummary([])).toBe('empty')
    expect(briefValueSummary([{ label: 'Site', url: 'u' }])).toBe('1 link row')
    expect(
      briefValueSummary({
        no_em_dashes: true,
        hook_first_150: true,
        description_chars: null,
        keywords_terms: null,
      })
    ).toBe('the channel’s house rules')
  })

  test('truncates a long line', () => {
    const summary = briefValueSummary('x'.repeat(200))
    expect(summary.length).toBeLessThanOrEqual(81)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('videoCount', () => {
  test('singular and plural', () => {
    expect(videoCount(1)).toBe('1 video')
    expect(videoCount(0)).toBe('0 videos')
    expect(videoCount(4)).toBe('4 videos')
  })
})
