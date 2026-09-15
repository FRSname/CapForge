/**
 * The channels boundary: what the renderer accepts from
 * `GET|POST|PATCH /api/library/channels[/{id}]`, `…/{id}/primary` and
 * `GET /api/library/platforms` (docs/plans/multi-channel-pr1-contract.md).
 *
 * A channel with no id or an unknown platform throws; a field the backend has
 * not grown degrades to a defined empty value. The profile reads its fields
 * exactly the way the brief does.
 */

import { describe, expect, test } from 'vitest'
import {
  CHANNEL_SHAPE_MESSAGE,
  CHANNELS_LIST_SHAPE_MESSAGE,
  PLATFORMS_SHAPE_MESSAGE,
  parseChannel,
  parseChannelsList,
  parsePlatformSpecs,
} from './channelTypes'
import { parseBrief } from './publishTypes'

const RAW = {
  id: 'update-conference',
  platform: 'youtube',
  name: 'Update Conference',
  handle: '@updateconf',
  url: 'https://youtube.com/@updateconf',
  language: 'en',
  context: {
    about: 'Talks from Update Conference, Prague.',
    audience: 'Developers',
    voice: 'Plain',
    title_style: 'Speaker — Talk',
    example_titles: ['Jane Doe — Shipping AI', 7],
    naming: 'uck26-<slug>',
    example_slugs: ['uck26-shipping-ai'],
    keywords: ['dotnet', 'ai'],
    notes: 'No emoji.',
  },
  profile: {
    footer: 'Thanks for watching',
    default_hashtags: ['#uck26'],
    link_rows: [{ label: 'Site', url: 'https://update.cz' }],
    house_rules: { no_em_dashes: true },
    slots: { event: 'UCK 26', broken: 3 },
  },
  createdAt: '2026-09-15T08:00:00Z',
  updatedAt: '2026-09-15T09:00:00Z',
  primary: true,
}

describe('parseChannel', () => {
  test('reads a full channel', () => {
    const channel = parseChannel(RAW)

    expect(channel.id).toBe('update-conference')
    expect(channel.platform).toBe('youtube')
    expect(channel.handle).toBe('@updateconf')
    expect(channel.primary).toBe(true)
    expect(channel.context.example_titles).toEqual(['Jane Doe — Shipping AI'])
    expect(channel.context.keywords).toEqual(['dotnet', 'ai'])
    expect(channel.profile.slots).toEqual({ event: 'UCK 26' })
    expect(channel.profile.link_rows).toEqual([{ label: 'Site', url: 'https://update.cz' }])
    expect(channel.updatedAt).toBe('2026-09-15T09:00:00Z')
  })

  test('fills defaults for every missing string and list', () => {
    const channel = parseChannel({ id: 'filip-ig', platform: 'instagram' })

    expect(channel.name).toBe('filip-ig')
    expect(channel.handle).toBe('')
    expect(channel.url).toBe('')
    expect(channel.language).toBe('')
    expect(channel.primary).toBe(false)
    expect(channel.context).toEqual({
      about: '',
      audience: '',
      voice: '',
      title_style: '',
      example_titles: [],
      naming: '',
      example_slugs: [],
      keywords: [],
      notes: '',
    })
    expect(channel.createdAt).toBe('')
  })

  test('the profile reads like the brief, house-rule defaults included', () => {
    const channel = parseChannel({ id: 'a', platform: 'youtube', profile: RAW.profile })
    const brief = parseBrief(RAW.profile)

    expect(channel.profile.house_rules).toEqual(brief.house_rules)
    expect(channel.profile.house_rules.hook_first_150).toBe(true)
    expect(channel.profile.description_template).toBe('')
    expect(channel.profile.recorded_at_line).toBe('')
    expect(channel.profile.speaker_block).toBe('')
    expect(Object.keys(channel.profile).sort()).toEqual(
      [
        'default_hashtags',
        'description_template',
        'footer',
        'house_rules',
        'link_rows',
        'recorded_at_line',
        'slots',
        'speaker_block',
      ].sort()
    )
  })

  test.each([
    ['no body', null],
    ['no id', { platform: 'youtube' }],
    ['a blank id', { id: '  ', platform: 'youtube' }],
    ['an unknown platform', { id: 'a', platform: 'myspace' }],
    ['no platform', { id: 'a' }],
  ])('throws for %s', (_label, body) => {
    expect(() => parseChannel(body)).toThrow(CHANNEL_SHAPE_MESSAGE)
  })
})

describe('parseChannelsList', () => {
  test('parses every channel and marks the primary by primary_id', () => {
    const list = parseChannelsList({
      primary_id: 'update-conference',
      channels: [
        { ...RAW, primary: undefined },
        { id: 'filip', platform: 'youtube', name: 'Filip', primary: true },
        { id: 'filip-ig', platform: 'instagram', name: 'Filip IG' },
      ],
    })

    expect(list.primary_id).toBe('update-conference')
    expect(list.channels.map((c) => c.id)).toEqual(['update-conference', 'filip', 'filip-ig'])
    expect(list.channels.map((c) => c.primary)).toEqual([true, false, false])
  })

  test('keeps the rows’ own flags when primary_id is missing', () => {
    const list = parseChannelsList({ channels: [RAW] })
    expect(list.primary_id).toBe('')
    expect(list.channels[0].primary).toBe(true)
  })

  test('throws without a channels array', () => {
    expect(() => parseChannelsList({ primary_id: 'x' })).toThrow(CHANNELS_LIST_SHAPE_MESSAGE)
    expect(() => parseChannelsList([])).toThrow(CHANNELS_LIST_SHAPE_MESSAGE)
  })

  test('throws when a row has an unknown platform', () => {
    expect(() =>
      parseChannelsList({ primary_id: '', channels: [{ id: 'a', platform: 'myspace' }] })
    ).toThrow(CHANNEL_SHAPE_MESSAGE)
  })
})

describe('parsePlatformSpecs', () => {
  test('reads the served table in order', () => {
    const specs = parsePlatformSpecs({
      platforms: [
        {
          id: 'youtube',
          label: 'YouTube',
          fields: ['title', 'description'],
          limits: [{ field: 'title', max: 100, unit: 'chars', severity: 'hard' }],
        },
        {
          id: 'linkedin',
          label: 'LinkedIn',
          fields: ['text', 'hashtags', 7],
          limits: [{ field: 'hashtags', max: 5, min: 3, unit: 'items', severity: 'style' }],
        },
      ],
    })

    expect(specs.map((s) => s.id)).toEqual(['youtube', 'linkedin'])
    expect(specs[0].limits).toEqual([{ field: 'title', max: 100, unit: 'chars', severity: 'hard' }])
    expect(specs[1].fields).toEqual(['text', 'hashtags'])
    expect(specs[1].limits[0]).toEqual({
      field: 'hashtags',
      max: 5,
      min: 3,
      unit: 'items',
      severity: 'style',
    })
  })

  test('drops a platform the renderer does not know, and limits with an unknown unit', () => {
    const specs = parsePlatformSpecs({
      platforms: [
        { id: 'myspace', label: 'MySpace' },
        {
          id: 'x',
          limits: [
            { field: 'text', max: 280, unit: 'weighted' },
            { field: 'text', max: 1, unit: 'furlongs' },
            { field: 'text', unit: 'chars' },
          ],
        },
      ],
    })

    expect(specs).toHaveLength(1)
    expect(specs[0].label).toBe('X')
    expect(specs[0].fields).toEqual([])
    expect(specs[0].limits).toEqual([
      { field: 'text', max: 280, unit: 'weighted', severity: 'hard' },
    ])
  })

  test('throws without a platforms array', () => {
    expect(() => parsePlatformSpecs({})).toThrow(PLATFORMS_SHAPE_MESSAGE)
  })
})
