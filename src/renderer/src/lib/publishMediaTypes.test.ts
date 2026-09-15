/**
 * The `shorts` / `thumbnail` boundary: a field the backend has not grown yet
 * degrades to a defined empty value, rows that cannot be used are dropped, and
 * `candidates` is kept **verbatim** — it is sent back unchanged, so a guard
 * that rewrote it would make every thumbnail write a `candidates_managed` 422.
 */

import { describe, expect, test } from 'vitest'
import {
  EMPTY_LOCALIZED,
  EMPTY_SHORTS,
  EMPTY_THUMBNAIL,
  parseLocalized,
  parseShorts,
  parseThumbnail,
} from './publishMediaTypes'

describe('parseShorts', () => {
  test('defaults a missing or malformed block to nothing written', () => {
    for (const value of [undefined, null, 'x', 7, []]) {
      expect(parseShorts(value)).toEqual(EMPTY_SHORTS)
    }
  })

  test('reads the caption and the clip rows, dropping rows that are not objects', () => {
    const shorts = parseShorts({
      caption: 'Watch this',
      clip_suggestions: [
        { start_s: 12.5, end_s: 40, why: 'The punchline' },
        'nonsense',
        { start_s: 60 },
      ],
    })

    expect(shorts).toEqual({
      caption: 'Watch this',
      clip_suggestions: [
        { start_s: 12.5, end_s: 40, why: 'The punchline' },
        { start_s: 60, end_s: 0, why: '' },
      ],
    })
  })
})

describe('parseThumbnail', () => {
  test('defaults a missing or malformed block to no ideas, no frames, no cover', () => {
    for (const value of [undefined, null, 'x', []]) {
      expect(parseThumbnail(value)).toEqual(EMPTY_THUMBNAIL)
    }
  })

  test('reads ideas, keeping the optional texts only when they were written', () => {
    const thumbnail = parseThumbnail({
      ideas: [
        { label: 'A', type: 'face', headline: 'Wow', subtext: 'sub', recommended: true },
        { label: 'B', type: 'diagram', headline: 'How', visual_suggestion: 'arrows' },
        null,
      ],
    })

    expect(thumbnail.ideas).toEqual([
      { label: 'A', type: 'face', headline: 'Wow', subtext: 'sub', recommended: true },
      {
        label: 'B',
        type: 'diagram',
        headline: 'How',
        visual_suggestion: 'arrows',
        recommended: false,
      },
    ])
  })

  test('keeps an idea type it does not know rather than rewriting the agent’s word', () => {
    expect(parseThumbnail({ ideas: [{ type: 'photo' }] }).ideas[0].type).toBe('photo')
    expect(parseThumbnail({ ideas: [{ type: 3 }] }).ideas[0].type).toBe('face')
  })

  test('keeps candidates verbatim and the cover only when it is a non-empty string', () => {
    const names = ['a'.repeat(32) + '.jpg', 'b'.repeat(32) + '.jpg']
    expect(parseThumbnail({ candidates: [...names, 7], cover: names[1] })).toEqual({
      ideas: [],
      candidates: names,
      cover: names[1],
    })
    expect(parseThumbnail({ cover: '' }).cover).toBeNull()
    expect(parseThumbnail({ cover: 3 }).cover).toBeNull()
  })
})

describe('parseLocalized', () => {
  test('a missing or malformed block is no languages at all', () => {
    for (const value of [undefined, null, 'x', 7, []]) {
      expect(parseLocalized(value)).toEqual({})
    }
  })

  test('reads each language, the backend’s nulls reading as nothing written', () => {
    const localized = parseLocalized({
      pl: {
        title: 'Tytuł',
        description: null,
        tags: ['napisy', 3],
        chapter_titles: ['Wstęp', ''],
        shorts_caption: 'Zobacz',
      },
      de: {},
    })

    expect(localized.pl).toEqual({
      ...EMPTY_LOCALIZED,
      title: 'Tytuł',
      tags: ['napisy'],
      chapter_titles: ['Wstęp', ''],
      shorts_caption: 'Zobacz',
    })
    expect(localized.de).toEqual(EMPTY_LOCALIZED)
  })

  test('drops a language whose value is not an object (a null is a removal, not a language)', () => {
    expect(Object.keys(parseLocalized({ pl: null, de: 'x', fr: { title: 'Titre' } }))).toEqual([
      'fr',
    ])
  })
})
