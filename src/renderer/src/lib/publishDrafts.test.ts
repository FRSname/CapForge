/**
 * The draft bookkeeping and the chapter transforms — the two pure modules the
 * Publish hook is built on.
 */

import { describe, expect, test } from 'vitest'
import type { Chapter, Moment, PublishRecord } from './publishTypes'
import type { Word } from '../types/app'
import { EMPTY_FIELDS, lockedField, mergeDrafts, remainingDrafts, withoutDraft } from './publishDrafts'
import {
  insertChapter,
  removeChapter,
  renameChapter,
  sortChapters,
  withSuggestions,
} from './publishChapters'

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    ...EMPTY_FIELDS,
    id: 'vid_1',
    rev: 1,
    duration: 600,
    status: 'drafted',
    hasProject: true,
    links: [],
    history: [],
    ...over,
  }
}

describe('mergeDrafts', () => {
  test('lays the unsaved drafts over the record', () => {
    const merged = mergeDrafts(record({ title: 'Saved', description: 'Saved' }), {
      title: 'Typing',
    })

    expect(merged.title).toBe('Typing')
    expect(merged.description).toBe('Saved')
  })

  test('with no record at all, every field has a defined empty value', () => {
    expect(mergeDrafts(null, {})).toEqual(EMPTY_FIELDS)
  })
})

describe('remainingDrafts', () => {
  test('drops a field the PATCH carried, and only that field', () => {
    const drafts = { title: 'Sent', description: 'Not sent' }

    expect(remainingDrafts(drafts, { title: 'Sent' })).toEqual({ description: 'Not sent' })
  })

  test('keeps a field that was typed in again while the PATCH was in flight', () => {
    // Sent "Old", the user has since typed "New": the field is still dirty and
    // the next debounce must send the newer text.
    expect(remainingDrafts({ title: 'New' }, { title: 'Old' })).toEqual({ title: 'New' })
  })
})

describe('withoutDraft and lockedField', () => {
  test('withoutDraft returns a copy without the field', () => {
    const drafts = { title: 'a', description: 'b' }
    const next = withoutDraft(drafts, 'title')

    expect(next).toEqual({ description: 'b' })
    expect(drafts).toEqual({ title: 'a', description: 'b' })
  })

  test('a field is only locked while it actually holds unsaved text', () => {
    expect(lockedField('title', { title: 'typing' })).toBe('title')
    // Focus alone is not a lock — an agent write into an untouched field lands.
    expect(lockedField('title', {})).toBeNull()
    expect(lockedField(null, { title: 'typing' })).toBeNull()
  })
})

describe('the chapter transforms', () => {
  const chapters: Chapter[] = [
    { start_s: 0, title: 'Intro' },
    { start_s: 120, title: 'Middle' },
  ]
  const words: Word[] = [
    { word: 'a', start: 0, end: 1 },
    { word: 'b', start: 59.2, end: 60 },
  ]

  test('insertChapter snaps back to a word start and keeps the list in order', () => {
    const next = insertChapter(chapters, 60, words)

    expect(next.map((c) => c.start_s)).toEqual([0, 59.2, 120])
    expect(next[1].title).toBe('')
    // The input was not mutated.
    expect(chapters).toHaveLength(2)
  })

  test('removeChapter and renameChapter address by index', () => {
    expect(removeChapter(chapters, 0)).toEqual([{ start_s: 120, title: 'Middle' }])
    expect(renameChapter(chapters, 1, 'Renamed')[1].title).toBe('Renamed')
    expect(chapters[1].title).toBe('Middle')
  })

  test('sortChapters is by time, on a copy', () => {
    const unsorted: Chapter[] = [
      { start_s: 30, title: 'b' },
      { start_s: 0, title: 'a' },
    ]
    expect(sortChapters(unsorted).map((c) => c.title)).toEqual(['a', 'b'])
    expect(unsorted[0].title).toBe('b')
  })

  test('withSuggestions folds candidates in, and says so when there are none', () => {
    const moment = (start: number, text: string): Moment => ({
      text,
      start,
      end: start + 1,
      word_id: `w${start}`,
    })

    const next = withSuggestions(chapters, [moment(300, 'A new topic')])
    expect(next?.map((c) => c.start_s)).toEqual([0, 120, 300])

    // Everything on offer is inside an existing chapter's minimum gap.
    expect(withSuggestions(chapters, [moment(122, 'too close')])).toBeNull()
  })
})
