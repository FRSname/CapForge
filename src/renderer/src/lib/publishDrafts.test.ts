/**
 * The draft bookkeeping and the chapter transforms — the two pure modules the
 * Publish hook is built on.
 */

import { describe, expect, test } from 'vitest'
import type { Chapter, Moment, PublishRecord } from './publishTypes'
import type { Word } from '../types/app'
import {
  EMPTY_FIELDS,
  lockedField,
  mergeDrafts,
  remainingDrafts,
  survivingDrafts,
  withoutDraft,
} from './publishDrafts'
import { EMPTY_LOCALIZED } from './publishMediaTypes'
import { composeLocalizedPatch, localizedDraft } from './publishLocalized'
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
    language: 'en',
    languages: ['en'],
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

  test('a thumbnail draft shows the record’s current frames, never the list it was edited over', () => {
    const [a, b] = [`${'a'.repeat(32)}.jpg`, `${'b'.repeat(32)}.jpg`]
    const saved = record({ thumbnail: { ideas: [], candidates: [a, b], cover: null } })
    const draft = { ideas: [], candidates: [a], cover: a }

    expect(mergeDrafts(saved, { thumbnail: draft }).thumbnail).toEqual({
      ideas: [],
      candidates: [a, b],
      cover: a,
    })
  })
})

describe('the localized draft is a delta, never a stale whole dict', () => {
  const pl = { ...EMPTY_LOCALIZED, title: 'Tytuł' }
  const de = { ...EMPTY_LOCALIZED, title: 'Titel' }
  const agentDe = { ...EMPTY_LOCALIZED, title: 'Vom Agenten' }

  test('mergeDrafts lays the changed languages over the record; null removes', () => {
    const saved = record({ localized: { pl, de } })
    const mine = { ...pl, title: 'Mój' }

    expect(mergeDrafts(saved, { localized: { pl: mine } }).localized).toEqual({ pl: mine, de })
    expect(mergeDrafts(saved, { localized: { de: null } }).localized).toEqual({ pl })
  })

  test('an agent added a language meanwhile: the draft survives and the agent’s language shows', () => {
    const local = record({ localized: { pl } })
    const remote = record({ rev: 2, localized: { pl, de: agentDe } })
    const drafts = { localized: localizedDraft(local.localized, { pl: { ...pl, title: 'Mój' } }) }

    const surviving = survivingDrafts(drafts, local, remote, null)

    expect(surviving).toEqual(drafts)
    const shown = mergeDrafts(remote, surviving).localized
    expect(shown.de).toEqual(agentDe)
    // And the send names only the user's language — never resurrecting or erasing `de`.
    expect(Object.keys(composeLocalizedPatch(surviving.localized ?? {}, remote))).toEqual(['pl'])
  })

  test('an agent rewrote the drafted language: that language is the agent’s, the rest stay', () => {
    const local = record({ localized: { pl, de } })
    const remote = record({ rev: 2, localized: { pl, de: agentDe } })
    const drafts = { localized: { de: { ...de, title: 'Mein' }, pl: null }, title: 'typing' }

    expect(survivingDrafts(drafts, local, remote, null)).toEqual({
      localized: { pl: null },
      title: 'typing',
    })
  })

  test('an agent removed the drafted language: a stale draft does not resurrect it', () => {
    const local = record({ localized: { pl, de } })
    const remote = record({ rev: 2, localized: { pl } })
    const drafts = { localized: { de: { ...de, title: 'Mein' } } }

    const surviving = survivingDrafts(drafts, local, remote, null)
    expect(surviving).toEqual({})
    expect(mergeDrafts(remote, surviving).localized).toEqual({ pl })
  })

  test('the locked localized field keeps its whole delta for the banner to settle', () => {
    const local = record({ localized: { pl, de } })
    const remote = record({ rev: 2, localized: { pl, de: agentDe } })
    const drafts = { localized: { de: { ...de, title: 'Mein' } } }

    expect(survivingDrafts(drafts, local, remote, 'localized')).toEqual(drafts)
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

describe('survivingDrafts (an agent wrote the record)', () => {
  test('keeps a draft on a field the agent left alone', () => {
    // The agent wrote tags; the unsaved chapter list (a Suggest result the
    // validator refused) is still the user's and must not vanish with it.
    const local = record({ tags: [] })
    const remote = record({ rev: 2, tags: ['captions'] })
    const drafts = { chapters: [{ start_s: 4, title: 'They' }], title: 'typing' }

    expect(survivingDrafts(drafts, local, remote, null)).toEqual(drafts)
  })

  test('drops a draft the agent wrote over, unless it is the locked field', () => {
    const local = record({ title: 'old', description: 'old' })
    const remote = record({ rev: 2, title: 'agent', description: 'agent' })
    const drafts = { title: 'mine', description: 'mine' }

    expect(survivingDrafts(drafts, local, remote, 'title')).toEqual({ title: 'mine' })
    expect(survivingDrafts(drafts, local, remote, null)).toEqual({})
    // Nothing was mutated.
    expect(drafts).toEqual({ title: 'mine', description: 'mine' })
  })

  test('a grabbed frame alone does not throw away an unsaved thumbnail edit', () => {
    const [a, b] = [`${'a'.repeat(32)}.jpg`, `${'b'.repeat(32)}.jpg`]
    const local = record({ thumbnail: { ideas: [], candidates: [a], cover: null } })
    const remote = record({ rev: 2, thumbnail: { ideas: [], candidates: [a, b], cover: null } })
    const drafts = { thumbnail: { ideas: [], candidates: [a], cover: a } }

    expect(survivingDrafts(drafts, local, remote, null)).toEqual(drafts)
    // But a cover the backend changed (the frame was deleted) is the backend's now.
    const cleared = record({ rev: 3, thumbnail: { ideas: [], candidates: [], cover: null } })
    const withCover = record({ thumbnail: { ideas: [], candidates: [a], cover: a } })
    expect(survivingDrafts(drafts, withCover, cleared, null)).toEqual({})
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
