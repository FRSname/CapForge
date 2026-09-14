/**
 * `lib/publishFields.ts` — the Publish panel's pure decisions.
 *
 * Every rule the panel follows lives here rather than in a card, because the
 * vitest environment is plain node: a component only renders to static markup,
 * so anything with a decision in it has to be testable without one.
 */

import { describe, expect, test } from 'vitest'
import type { PublishRecord } from './publishTypes'
import type { Segment } from '../types/app'
import {
  PUBLISH_FIELDS,
  authoredFields,
  byteLength,
  fieldLabel,
  first150,
  hashtagsLine,
  mergeAgentUpdate,
  parseHashtags,
  parseTagsLine,
  provenanceOf,
  relativeTime,
  revertPatchFor,
  speakersFromTranscript,
  tagsLine,
  violationsForField,
} from './publishFields'

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    id: 'vid_1',
    rev: 1,
    duration: 600,
    status: 'captioned',
    hasProject: true,
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
    publish: { youtube: null, pushes: [] },
    history: [],
    ...over,
  }
}

function segment(id: string, speaker?: string): Segment {
  return { id, start: 0, end: 1, text: 't', words: [], ...(speaker ? { speaker } : {}) }
}

describe('PUBLISH_FIELDS', () => {
  test('files every authored field on exactly one card', () => {
    const ids = PUBLISH_FIELDS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'title_options',
      'title',
      'description',
      'chapters',
      'tags',
      'keywords',
      'hashtags',
      'speakers',
      'summary_md',
      'publish',
    ])
  })

  test('authoredFields sends the authored half and nothing else', () => {
    const payload = authoredFields(record({ title: 'Talk', tags: ['a'] }))

    const wire = PUBLISH_FIELDS.map((f) => f.id).filter((id) => id !== 'publish')
    expect(Object.keys(payload).sort()).toEqual(wire.sort())
    expect(payload.title).toBe('Talk')
    // The system fields are not validated and must not ride along.
    expect(payload).not.toHaveProperty('rev')
    expect(payload).not.toHaveProperty('history')
  })

  test('labels a field the backend names, and falls back to the raw id', () => {
    expect(fieldLabel('summary_md')).toBe('Summary')
    expect(fieldLabel('short_description')).toBe('short_description')
  })
})

describe('provenanceOf', () => {
  test('reports the newest writer of a field', () => {
    const r = record({
      history: [
        { field: 'title', prev: 'Old', by: 'user', at: '2026-09-14T10:00:00Z' },
        { field: 'title', prev: 'Older', by: 'agent', at: '2026-09-14T12:00:00Z' },
        { field: 'description', prev: '', by: 'agent', at: '2026-09-14T13:00:00Z' },
      ],
    })

    expect(provenanceOf(r, 'title')).toEqual({ by: 'agent', at: '2026-09-14T12:00:00Z' })
  })

  test('is null for a field nobody has written', () => {
    expect(provenanceOf(record(), 'tags')).toBeNull()
  })
})

describe('revertPatchFor', () => {
  test('restores the newest recorded previous value', () => {
    const r = record({
      title: 'Claude wrote this',
      history: [
        { field: 'title', prev: 'First draft', by: 'user', at: '2026-09-14T10:00:00Z' },
        { field: 'title', prev: 'Second draft', by: 'agent', at: '2026-09-14T12:00:00Z' },
      ],
    })

    expect(revertPatchFor(r, 'title')).toEqual({ title: 'Second draft' })
  })

  test('offers nothing when the field has no history, or none with a previous value', () => {
    expect(revertPatchFor(record(), 'title')).toBeNull()
    const firstWrite = record({
      history: [{ field: 'title', prev: undefined, by: 'agent', at: '2026-09-14T12:00:00Z' }],
    })
    expect(revertPatchFor(firstWrite, 'title')).toBeNull()
  })

  test('a recorded empty string IS revertable — it is a value, not an absence', () => {
    const r = record({
      history: [{ field: 'description', prev: '', by: 'agent', at: '2026-09-14T12:00:00Z' }],
    })
    expect(revertPatchFor(r, 'description')).toEqual({ description: '' })
  })
})

describe('the meters', () => {
  test('byteLength counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    // An em dash is three bytes; an emoji four. The 5000 limit is in bytes.
    expect(byteLength('—')).toBe(3)
    expect(byteLength('🎬')).toBe(4)
  })

  test('first150 is the above-the-fold slice', () => {
    const long = 'x'.repeat(200)
    expect(first150(long)).toHaveLength(150)
    expect(first150('short')).toBe('short')
  })
})

describe('the list <-> line bridges', () => {
  test('tags round-trip through a comma-separated line', () => {
    expect(tagsLine(['whisper', 'captions'])).toBe('whisper, captions')
    expect(parseTagsLine(' whisper ,, captions , ')).toEqual(['whisper', 'captions'])
    expect(parseTagsLine('')).toEqual([])
  })

  test('hashtags round-trip with exactly one # each', () => {
    expect(hashtagsLine(['ai', '#captions'])).toBe('#ai #captions')
    expect(parseHashtags('ai, ##captions  #video')).toEqual(['#ai', '#captions', '#video'])
    expect(parseHashtags('  ')).toEqual([])
  })
})

describe('mergeAgentUpdate (the soft lock)', () => {
  test('keeps the field being typed and takes everything else', () => {
    const local = record({ title: 'What I am typing', description: 'stale' })
    const remote = record({ rev: 5, title: 'Claude wrote this', description: 'Claude wrote this' })

    const merged = mergeAgentUpdate(local, remote, 'title')

    expect(merged.title).toBe('What I am typing')
    expect(merged.description).toBe('Claude wrote this')
    expect(merged.rev).toBe(5)
    // Neither side was mutated.
    expect(local.title).toBe('What I am typing')
    expect(remote.title).toBe('Claude wrote this')
  })

  test('takes the whole remote record when nothing is being edited', () => {
    const remote = record({ rev: 5, title: 'Claude wrote this' })
    expect(mergeAgentUpdate(record(), remote, null)).toBe(remote)
  })
})

describe('violationsForField', () => {
  test('a finding on a row of the field is drawn under the field', () => {
    const violations = [
      {
        field: 'chapters[0]',
        rule: 'chapters_start_at_zero',
        message: 'first at 00:00',
        severity: 'hard' as const,
      },
      { field: 'chapters', rule: 'chapters_min', message: 'at least 3', severity: 'hard' as const },
      { field: 'title', rule: 'title_max_chars', message: 'too long', severity: 'hard' as const },
    ]

    expect(violationsForField(violations, 'chapters').map((v) => v.rule)).toEqual([
      'chapters_start_at_zero',
      'chapters_min',
    ])
    expect(violationsForField(violations, 'title').map((v) => v.rule)).toEqual(['title_max_chars'])
    // A prefix is not a row: `chapters` never picks up a hypothetical `chapters_extra`.
    expect(violationsForField([{ ...violations[2], field: 'titles' }], 'title')).toEqual([])
  })
})

describe('speakersFromTranscript', () => {
  test('lists the distinct diarized ids in order of first appearance', () => {
    const segments = [
      segment('1', 'SPEAKER_01'),
      segment('2', 'SPEAKER_00'),
      segment('3', 'SPEAKER_01'),
      segment('4'),
    ]

    expect(speakersFromTranscript(segments)).toEqual(['SPEAKER_01', 'SPEAKER_00'])
  })

  test('an undiarized transcript has no speaker rows', () => {
    expect(speakersFromTranscript([segment('1'), segment('2')])).toEqual([])
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-09-14T12:00:00Z')

  test('says how recently, coarsely', () => {
    expect(relativeTime('2026-09-14T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-09-14T11:57:00Z', now)).toBe('3 m ago')
    expect(relativeTime('2026-09-14T10:00:00Z', now)).toBe('2 h ago')
    expect(relativeTime('2026-09-09T12:00:00Z', now)).toBe('5 d ago')
  })

  test('says nothing at all about an unparseable timestamp', () => {
    expect(relativeTime('', now)).toBe('')
    expect(relativeTime('whenever', now)).toBe('')
  })
})

describe('authoredFields wire shape', () => {
  test('never sends publish — its nullable youtube block would be refused by the backend', () => {
    const payload = authoredFields(record({ title: 'Talk' }))
    expect('publish' in payload).toBe(false)
    expect(payload.title).toBe('Talk')
  })
})
