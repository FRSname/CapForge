/**
 * The publish boundary: what the renderer accepts from the backend.
 *
 * The rule mirrors `lib/libraryTypes.ts` — a body that cannot be addressed
 * throws with a message a user can act on, while a field the backend has not
 * grown yet degrades to a defined empty value instead of blanking a card.
 */

import { describe, expect, test } from 'vitest'
import {
  BRIEF_SHAPE_MESSAGE,
  PACKAGE_SHAPE_MESSAGE,
  PUBLISH_RECORD_SHAPE_MESSAGE,
  parseBrief,
  parseMoments,
  parsePublishRecord,
  parseUploadPackage,
  parseViolations,
} from './publishTypes'

describe('parsePublishRecord', () => {
  test('reads the dossier and defaults everything unwritten', () => {
    const record = parsePublishRecord({ id: 'vid_1', rev: 4, duration: 612.5, status: 'drafted' })

    expect(record).toEqual({
      id: 'vid_1',
      rev: 4,
      duration: 612.5,
      status: 'drafted',
      hasProject: false,
      title_options: [],
      title: '',
      description: '',
      chapters: [],
      tags: [],
      keywords: [],
      hashtags: [],
      speakers: {},
      summary_md: '',
      links: [],
      publish: { youtube: null },
      history: [],
    })
  })

  test('keeps the structured fields it recognises and drops the rows it cannot use', () => {
    const record = parsePublishRecord({
      id: 'vid_1',
      chapters: [{ start_s: 0, title: 'Intro' }, 'nonsense', { title: 'no start' }],
      tags: ['whisper', 7],
      speakers: { SPEAKER_00: { name: 'Filip' }, SPEAKER_01: null },
      publish: { youtube: { videoId: 'abc', url: 'https://youtu.be/abc', publishedAt: 'now' } },
      history: [{ field: 'title', prev: 'Old', by: 'agent', at: 'then' }, { by: 'agent' }],
    })

    expect(record.chapters).toEqual([
      { start_s: 0, title: 'Intro' },
      { start_s: 0, title: 'no start' },
    ])
    expect(record.tags).toEqual(['whisper'])
    expect(record.speakers.SPEAKER_00.name).toBe('Filip')
    expect(record.speakers.SPEAKER_01).toEqual({ name: '', handle: '', url: '' })
    expect(record.publish.youtube?.videoId).toBe('abc')
    expect(record.history).toHaveLength(1)
  })

  test('a publish block with neither an id nor a URL is "not published"', () => {
    const record = parsePublishRecord({ id: 'v', publish: { youtube: { publishedAt: 'x' } } })
    expect(record.publish.youtube).toBeNull()
  })

  test('throws when the body cannot be addressed', () => {
    expect(() => parsePublishRecord(null)).toThrow(PUBLISH_RECORD_SHAPE_MESSAGE)
    expect(() => parsePublishRecord({ rev: 1 })).toThrow(PUBLISH_RECORD_SHAPE_MESSAGE)
  })
})

describe('parseBrief', () => {
  test('fills in the documented defaults for a brief that was never written', () => {
    const brief = parseBrief({})
    expect(brief.channel).toBe('')
    expect(brief.default_hashtags).toEqual([])
    expect(brief.house_rules).toEqual({
      no_em_dashes: false,
      description_chars: null,
      keywords_terms: null,
      hook_first_150: true,
    })
  })

  test('reads the house-rule ranges only when they are a usable pair', () => {
    const brief = parseBrief({
      house_rules: { description_chars: [1800, 2200], keywords_terms: [12] },
    })
    expect(brief.house_rules.description_chars).toEqual([1800, 2200])
    expect(brief.house_rules.keywords_terms).toBeNull()
  })

  test('throws on a body that is not an object at all', () => {
    expect(() => parseBrief('nope')).toThrow(BRIEF_SHAPE_MESSAGE)
  })
})

describe('parseViolations', () => {
  test('reads an envelope or a bare list, defaulting severity to the strict one', () => {
    expect(parseViolations({ violations: [{ field: 'title', rule: 'r', message: 'm' }] })).toEqual([
      { field: 'title', rule: 'r', message: 'm', severity: 'hard' },
    ])
    expect(parseViolations([{ field: 'f', rule: 'r', message: 'm', severity: 'style' }])).toEqual([
      { field: 'f', rule: 'r', message: 'm', severity: 'style' },
    ])
    expect(parseViolations(undefined)).toEqual([])
  })
})

describe('parseUploadPackage and parseMoments', () => {
  test('a package without text is unusable and throws', () => {
    expect(() => parseUploadPackage({ platform: 'youtube' })).toThrow(PACKAGE_SHAPE_MESSAGE)
  })

  test('moments keep their optional gap/speaker and drop untimed rows', () => {
    const moments = parseMoments({
      matches: [
        { text: 'a', start: 1, end: 2, word_id: 'w', gap: 0.9 },
        { text: 'b', start: 3, end: 4, word_id: 'w2', speaker: 'SPEAKER_01' },
        { text: 'c' },
      ],
    })
    expect(moments).toHaveLength(2)
    expect(moments[0].gap).toBe(0.9)
    expect(moments[1].speaker).toBe('SPEAKER_01')
    expect(parseMoments({})).toEqual([])
  })
})
