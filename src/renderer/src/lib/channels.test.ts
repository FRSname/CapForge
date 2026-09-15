/**
 * The pure half of Settings → Channels: which profile fields a platform shows,
 * the one-per-line list editors, platform labels before and after the served
 * table loads, the primary/delete guards, the refusals the API maps, and how a
 * landed write is adopted without clobbering what is still being typed.
 */

import { describe, expect, test } from 'vitest'
import type { Channel, PlatformSpec } from './channelTypes'
import { parseChannel } from './channelTypes'
import {
  adoptPatched,
  canDeleteChannel,
  canMakePrimary,
  channelRefusal,
  channelRefusalMessage,
  linesToList,
  listToLines,
  platformGlyph,
  platformLabel,
  platformOptions,
  profileFieldsFor,
  removeChannel,
  replaceChannel,
  sameValue,
  showsMakePrimary,
} from './channels'

function channel(over: Record<string, unknown> = {}): Channel {
  return parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK', ...over })
}

const SPECS: PlatformSpec[] = [
  { id: 'youtube', label: 'YouTube (served)', fields: [], limits: [] },
  { id: 'x', label: 'X', fields: [], limits: [] },
]

describe('profileFieldsFor', () => {
  test('YouTube shows all eight profile fields', () => {
    expect(profileFieldsFor('youtube')).toEqual([
      'recorded_at_line',
      'speaker_block',
      'footer',
      'description_template',
      'slots',
      'default_hashtags',
      'link_rows',
      'house_rules',
    ])
  })

  test.each(['tiktok', 'instagram', 'linkedin', 'x'] as const)(
    '%s shows only default hashtags and link rows',
    (platform) => {
      expect(profileFieldsFor(platform)).toEqual(['default_hashtags', 'link_rows'])
    }
  )
})

describe('list editors', () => {
  test('linesToList trims, drops empties and keeps order', () => {
    expect(linesToList('  Jane — AI \n\n\r\nBob — Rust\n   ')).toEqual(['Jane — AI', 'Bob — Rust'])
  })

  test('linesToList keeps commas inside a line', () => {
    expect(linesToList('ai, captions')).toEqual(['ai, captions'])
  })

  test('an empty text is an empty list, and back', () => {
    expect(linesToList('')).toEqual([])
    expect(listToLines([])).toBe('')
  })

  test('listToLines joins one per line and round-trips', () => {
    const list = ['uck26-shipping-ai', 'uck26-rust']
    expect(listToLines(list)).toBe('uck26-shipping-ai\nuck26-rust')
    expect(linesToList(listToLines(list))).toEqual(list)
  })
})

describe('platform labels', () => {
  test('uses the served label once the table has loaded', () => {
    expect(platformLabel('youtube', SPECS)).toBe('YouTube (served)')
  })

  test('falls back before the table loads, or for a platform it does not list', () => {
    expect(platformLabel('instagram', null)).toBe('Instagram')
    expect(platformLabel('tiktok', SPECS)).toBe('TikTok')
  })

  test('every platform has a short glyph', () => {
    for (const p of ['youtube', 'tiktok', 'instagram', 'linkedin', 'x'] as const) {
      expect(platformGlyph(p).length).toBeGreaterThan(0)
    }
  })

  test('platformOptions offers the served platforms, else every known one', () => {
    expect(platformOptions(SPECS)).toEqual([
      { id: 'youtube', label: 'YouTube (served)' },
      { id: 'x', label: 'X' },
    ])
    expect(platformOptions(null).map((o) => o.id)).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'linkedin',
      'x',
    ])
    expect(platformOptions([]).length).toBe(5)
  })
})

describe('primary and delete guards', () => {
  test('only a YouTube channel offers Make primary', () => {
    expect(showsMakePrimary(channel())).toBe(true)
    expect(showsMakePrimary(channel({ platform: 'instagram' }))).toBe(false)
  })

  test('Make primary is disabled once the channel is primary', () => {
    expect(canMakePrimary(channel())).toBe(true)
    expect(canMakePrimary(channel({ primary: true }))).toBe(false)
    expect(canMakePrimary(channel({ platform: 'x' }))).toBe(false)
  })

  test('the primary channel cannot be deleted', () => {
    expect(canDeleteChannel(channel({ primary: true }))).toBe(false)
    expect(canDeleteChannel(channel())).toBe(true)
  })
})

describe('channelRefusal', () => {
  test.each([
    [409, { reason: 'channel_exists', detail: 'taken' }, 'channel_exists'],
    [409, { detail: { reason: 'channel_is_primary' } }, 'channel_is_primary'],
    [422, { reason: 'primary_not_youtube', detail: 'no' }, 'primary_not_youtube'],
  ] as const)('%i %j → %s', (status, body, kind) => {
    expect(channelRefusal(status, body)).toEqual({ kind })
  })

  test('anything else is not a refusal', () => {
    expect(channelRefusal(404, { reason: 'channel_exists' })).toBeNull()
    expect(channelRefusal(422, { detail: [{ loc: ['body', 'name'], msg: 'x' }] })).toBeNull()
    expect(channelRefusal(409, { reason: 'collection_in_use' })).toBeNull()
    expect(channelRefusal(409, 'nope')).toBeNull()
  })

  test('every refusal reads as a sentence a user can act on', () => {
    expect(channelRefusalMessage({ kind: 'channel_exists' })).toMatch(/already exists/)
    expect(channelRefusalMessage({ kind: 'channel_is_primary' })).toMatch(/primary/)
    expect(channelRefusalMessage({ kind: 'primary_not_youtube' })).toMatch(/YouTube/)
  })
})

describe('list updates are immutable', () => {
  test('replaceChannel swaps the row by id and leaves the input alone', () => {
    const list = [channel(), channel({ id: 'ig', platform: 'instagram' })]
    const next = replaceChannel(list, channel({ name: 'Renamed' }))

    expect(next[0].name).toBe('Renamed')
    expect(next[1]).toBe(list[1])
    expect(list[0].name).toBe('UCK')
  })

  test('removeChannel drops the row by id', () => {
    const list = [channel(), channel({ id: 'ig', platform: 'instagram' })]
    expect(removeChannel(list, 'uck').map((c) => c.id)).toEqual(['ig'])
    expect(list).toHaveLength(2)
  })
})

describe('adoptPatched', () => {
  test('takes only the patched fields from the answer, so other drafts survive', () => {
    const draft = channel({
      name: 'Being typed',
      context: { about: 'saved about', voice: 'typing voice…' },
    })
    const answer = channel({
      name: 'UCK',
      handle: '@uck',
      context: { about: 'saved about!', voice: 'old voice' },
      updatedAt: 'later',
      primary: true,
    })

    const next = adoptPatched(draft, answer, { handle: '@uck', context: { about: 'saved about!' } })

    expect(next.handle).toBe('@uck')
    expect(next.context.about).toBe('saved about!')
    expect(next.name).toBe('Being typed')
    expect(next.context.voice).toBe('typing voice…')
    expect(next.updatedAt).toBe('later')
    expect(next.primary).toBe(true)
    expect(draft.handle).toBe('')
  })

  test('adopts patched profile fields', () => {
    const draft = channel({ profile: { footer: 'draft footer' } })
    const answer = channel({ profile: { footer: 'x', default_hashtags: ['#a'] } })

    const next = adoptPatched(draft, answer, { profile: { default_hashtags: ['#a'] } })

    expect(next.profile.default_hashtags).toEqual(['#a'])
    expect(next.profile.footer).toBe('draft footer')
  })
})

describe('sameValue', () => {
  test('compares by structure', () => {
    expect(sameValue(['a'], ['a'])).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameValue('x', 'x')).toBe(true)
  })
})
