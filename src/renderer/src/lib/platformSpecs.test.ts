/**
 * Metering a post: each unit counts what the backend's `platforms.count`
 * counts, and `pastedText` measures what `validate_posts.pasted_text` measures.
 */

import { describe, expect, test } from 'vitest'
import { parsePlatformSpecs } from './channelTypes'
import {
  X_URL_WEIGHT,
  bodyFieldFor,
  countUnits,
  hasCoverField,
  limitFor,
  mergedHashtags,
  pastedText,
} from './platformSpecs'

const SERVED = parsePlatformSpecs({
  platforms: [
    {
      id: 'instagram',
      label: 'Instagram',
      fields: ['caption', 'hashtags', 'cover'],
      limits: [
        { field: 'caption', max: 2200, unit: 'chars', severity: 'hard' },
        { field: 'hashtags', max: 30, unit: 'items', severity: 'hard' },
      ],
    },
    {
      id: 'x',
      label: 'X',
      fields: ['text', 'hashtags'],
      limits: [{ field: 'text', max: 280, unit: 'weighted', severity: 'hard' }],
    },
  ],
})

describe('countUnits', () => {
  const emoji = 'A 🎬 clip'

  test('an emoji is one character, two UTF-16 units and four bytes', () => {
    expect(countUnits('chars', '🎬')).toBe(1)
    expect(countUnits('utf16', '🎬')).toBe(2)
    expect(countUnits('bytes', '🎬')).toBe(4)
    expect(countUnits('chars', emoji)).toBe(8)
    expect(countUnits('utf16', emoji)).toBe(9)
  })

  test('X weighs every URL at 23, whatever its length', () => {
    const text = 'See https://example.com/a/very/long/path/that/goes/on ok'
    expect(countUnits('weighted', text)).toBe('See '.length + X_URL_WEIGHT + ' ok'.length)
    expect(countUnits('weighted', 'no link here')).toBe(12)
  })

  test('items counts a list, and a list is a length whatever the unit', () => {
    expect(countUnits('items', ['#a', '#b'])).toBe(2)
    expect(countUnits('chars', ['#a', '#b'])).toBe(2)
    expect(countUnits('items', 'not a list')).toBe(0)
  })
})

describe('the served table', () => {
  test('limitFor finds one field’s limit, and nothing for a field without one', () => {
    expect(limitFor(SERVED, 'instagram', 'caption')).toEqual({
      field: 'caption',
      max: 2200,
      unit: 'chars',
      severity: 'hard',
    })
    expect(limitFor(SERVED, 'x', 'hashtags')).toBeNull()
    expect(limitFor(null, 'x', 'text')).toBeNull()
  })

  test('the body field is the platform’s own', () => {
    expect(bodyFieldFor('youtube')).toBe('description')
    expect(bodyFieldFor('tiktok')).toBe('caption')
    expect(bodyFieldFor('instagram')).toBe('caption')
    expect(bodyFieldFor('linkedin')).toBe('text')
    expect(bodyFieldFor('x')).toBe('text')
  })

  test('X has no cover — from the served field list, or the built-in answer', () => {
    expect(hasCoverField(SERVED, 'instagram')).toBe(true)
    expect(hasCoverField(SERVED, 'x')).toBe(false)
    expect(hasCoverField(null, 'x')).toBe(false)
    expect(hasCoverField(null, 'tiktok')).toBe(true)
  })
})

describe('what gets pasted', () => {
  test('the channel’s defaults lead, deduped case-insensitively and always #-prefixed', () => {
    expect(mergedHashtags(['ai', '#uck'], ['#AI', 'captions'])).toEqual([
      '#ai',
      '#uck',
      '#captions',
    ])
    expect(mergedHashtags([], ['  ', '##x'])).toEqual(['#x'])
  })

  test('body, a blank line, then the hashtag line', () => {
    expect(pastedText('Hello', ['captions'], ['#ai'])).toBe('Hello\n\n#ai #captions')
    expect(pastedText('Hello', [], [])).toBe('Hello')
    expect(pastedText('', ['#ai'], [])).toBe('#ai')
  })
})
