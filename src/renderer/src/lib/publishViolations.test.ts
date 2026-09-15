/**
 * Where a backend finding is drawn. The backend names a `field`; a card asks
 * for a field and gets that field, its rows (`chapters[0]`) and its sub-fields
 * (`thumbnail.cover`), then splits the list between its controls.
 */

import { describe, expect, test } from 'vitest'
import type { Violation } from './publishTypes'
import { partitionViolations, violationsForField } from './publishViolations'

function v(field: string, rule = field): Violation {
  return { field, rule, message: rule, severity: 'hard' }
}

describe('violationsForField', () => {
  test('matches the field, its rows and its dotted sub-fields — never a prefix', () => {
    const all = [
      v('thumbnail.cover'),
      v('thumbnail.ideas'),
      v('thumbnail'),
      v('thumbnails'),
      v('shorts.clip_suggestions[1]'),
      v('shorts.clip_suggestions[1].end_s'),
    ]

    expect(violationsForField(all, 'thumbnail').map((x) => x.field)).toEqual([
      'thumbnail.cover',
      'thumbnail.ideas',
      'thumbnail',
    ])
    expect(violationsForField(all, 'shorts.clip_suggestions[1]').map((x) => x.field)).toEqual([
      'shorts.clip_suggestions[1]',
      'shorts.clip_suggestions[1].end_s',
    ])
  })
})

describe('partitionViolations', () => {
  test('files each finding under the first group that claims it, the rest unplaced', () => {
    const all = [
      v('shorts.caption'),
      v('shorts.clip_suggestions[0]', 'clip_order'),
      v('shorts.clip_suggestions[1]', 'shorts_clip_length'),
      v('shorts.clip_suggestions[7]', 'clip_past_end'),
      v('shorts'),
    ]

    const { placed, unplaced } = partitionViolations(all, [
      ['shorts.caption'],
      ['shorts.clip_suggestions[0]'],
      ['shorts.clip_suggestions[1]'],
    ])

    expect(placed.map((group) => group.map((x) => x.rule))).toEqual([
      ['shorts.caption'],
      ['clip_order'],
      ['shorts_clip_length'],
    ])
    // A row the panel no longer has, and a list-level finding, are still shown.
    expect(unplaced.map((x) => x.rule)).toEqual(['clip_past_end', 'shorts'])
  })

  test('a group may claim several fields, and nothing is filed twice', () => {
    const all = [v('thumbnail.cover'), v('thumbnail.candidates'), v('thumbnail.ideas[0]')]
    const { placed, unplaced } = partitionViolations(all, [
      ['thumbnail.cover', 'thumbnail.candidates'],
      ['thumbnail.ideas', 'thumbnail'],
    ])
    expect(placed[0].map((x) => x.field)).toEqual(['thumbnail.cover', 'thumbnail.candidates'])
    expect(placed[1].map((x) => x.field)).toEqual(['thumbnail.ideas[0]'])
    expect(unplaced).toEqual([])
  })
})
