/**
 * The import "Publish to:" choice: what is remembered, what each outcome
 * sends, and what the sheet calls the batch.
 *
 * The load-bearing one is `channelsBody`: an empty choice must add **no**
 * `channels` key, or every import request stops being byte-identical to the
 * one CapForge sent before the sheet existed.
 */

import { describe, expect, test } from 'vitest'
import { parseChannel } from './channelTypes'
import type { ImportPlan } from './libraryImport'
import {
  SKIPPED,
  channelsBody,
  hasChannelsToPick,
  importButtonText,
  importWhatLabel,
  rememberedChannels,
  toggleChannel,
} from './importChannels'

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
const IG = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })

const plan = (overrides: Partial<ImportPlan> = {}): ImportPlan => ({
  folders: [],
  media: [],
  mediaTruncated: false,
  projects: [],
  skipped: [],
  ...overrides,
})

describe('rememberedChannels', () => {
  test('pre-ticks what was picked last time', () => {
    expect(rememberedChannels(['uck', 'filip-ig'], [UCK, IG])).toEqual(['uck', 'filip-ig'])
  })

  test('drops an id Settings no longer has — a deleted channel can never come back', () => {
    expect(rememberedChannels(['uck', 'gone'], [UCK, IG])).toEqual(['uck'])
  })

  test('remembers nothing while the channels are still loading, or from a junk value', () => {
    expect(rememberedChannels(['uck'], null)).toEqual([])
    expect(rememberedChannels('uck', [UCK])).toEqual([])
    expect(rememberedChannels([1, null, 'uck'], [UCK])).toEqual(['uck'])
    expect(rememberedChannels(undefined, [UCK])).toEqual([])
  })
})

describe('hasChannelsToPick', () => {
  test('only a non-empty list is worth a sheet', () => {
    expect(hasChannelsToPick([UCK])).toBe(true)
    expect(hasChannelsToPick([])).toBe(false)
    expect(hasChannelsToPick(null)).toBe(false)
  })
})

describe('channelsBody — what each outcome sends', () => {
  test('ticked channels ride as their own key, copied not shared', () => {
    const ids = ['uck', 'filip-ig']
    const body = channelsBody(ids)
    expect(body).toEqual({ channels: ['uck', 'filip-ig'] })
    expect(body.channels).not.toBe(ids)
  })

  test('Skip (a deliberate empty choice) sends NO key at all', () => {
    expect(channelsBody(SKIPPED.channelIds)).toEqual({})
    expect(Object.keys(channelsBody([]))).toEqual([])
  })

  test('no choice at all sends no key either', () => {
    expect(channelsBody(undefined)).toEqual({})
  })
})

describe('toggleChannel', () => {
  test('ticks, unticks, and never mutates what it was given', () => {
    const ticked = ['uck']
    expect(toggleChannel(ticked, 'filip-ig')).toEqual(['uck', 'filip-ig'])
    expect(toggleChannel(ticked, 'uck')).toEqual([])
    expect(ticked).toEqual(['uck'])
  })
})

describe('importWhatLabel', () => {
  test('names every part of the batch, in request order', () => {
    expect(importWhatLabel(plan({ media: ['/a.mp4', '/b.mp4'] }))).toBe('2 videos')
    expect(importWhatLabel(plan({ folders: ['/r'] }))).toBe('1 folder')
    expect(
      importWhatLabel(plan({ folders: ['/r'], media: ['/a.mp4'], projects: ['/p.capforge'] }))
    ).toBe('1 folder + 1 video + 1 project')
  })

  test('a plan with only skipped files still has something to call itself', () => {
    expect(importWhatLabel(plan({ skipped: ['notes.txt'] }))).toBe('this import')
  })
})

describe('importButtonText', () => {
  test('names how many channels are ticked', () => {
    expect(importButtonText([])).toBe('Import')
    expect(importButtonText(['uck'])).toBe('Import to 1 channel')
    expect(importButtonText(['uck', 'filip-ig'])).toBe('Import to 2 channels')
  })
})
