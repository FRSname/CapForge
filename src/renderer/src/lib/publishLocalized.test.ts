/**
 * The Localized editor's pure core. The load-bearing rule: **a `localized`
 * write names only the languages the user changed** (plus `null` for a
 * removal), composed against the latest record at send time — the backend
 * merges per language, so a stale whole dict would put back or erase a
 * language an agent wrote meanwhile.
 */

import { describe, expect, test } from 'vitest'
import type { LocalizedFields, LocalizedMap } from './publishMediaTypes'
import { EMPTY_LOCALIZED } from './publishMediaTypes'
import {
  addLanguage,
  addableLanguages,
  alignedChapterTitles,
  applyLocalizedDraft,
  composeLocalizedPatch,
  editableLanguages,
  extraChapterTitles,
  isStarted,
  localizedDraft,
  packageLanguages,
  removeLanguage,
  setChapterTitle,
  setLocalizedField,
  survivingLocalized,
  withLocalizedDraft,
  withLocalizedRestore,
} from './publishLocalized'

function fields(over: Partial<LocalizedFields> = {}): LocalizedFields {
  return { ...EMPTY_LOCALIZED, ...over }
}

const PL = fields({ title: 'Tytuł' })
const DE = fields({ title: 'Titel' })

describe('the language list', () => {
  const record = { language: 'en', languages: ['en', 'pl', 'fr'], localized: { de: DE } }

  test('record languages, then localized keys, then draft-only languages — never the source', () => {
    expect(editableLanguages(record)).toEqual(['pl', 'fr', 'de'])
    expect(editableLanguages(record, { de: DE, es: fields() })).toEqual(['pl', 'fr', 'de', 'es'])
    // The source language is excluded however it is cased, even as a stored key.
    expect(editableLanguages({ ...record, language: 'EN', localized: { en: PL } })).toEqual([
      'pl',
      'fr',
    ])
  })

  test('an unknown source language excludes nothing', () => {
    expect(editableLanguages({ language: '', languages: ['pl'], localized: {} })).toEqual(['pl'])
  })

  test('a track language without fields is not started', () => {
    expect(isStarted(record.localized, 'de')).toBe(true)
    expect(isStarted(record.localized, 'pl')).toBe(false)
  })

  test('Add language offers the table without the source and the languages already listed', () => {
    const codes = addableLanguages(record, record.localized).map((l) => l.code)
    expect(codes).not.toContain('en')
    expect(codes).not.toContain('pl')
    expect(codes).not.toContain('de')
    expect(codes).toContain('es')
  })
})

describe('the edits (immutable)', () => {
  test('setLocalizedField starts a language from empty and leaves the input alone', () => {
    const map: LocalizedMap = { de: DE }
    const next = setLocalizedField(map, 'pl', 'title', 'Nowy')

    expect(next.pl).toEqual(fields({ title: 'Nowy' }))
    expect(next.de).toBe(DE)
    expect(map).toEqual({ de: DE })
  })

  test('addLanguage keeps existing fields; removeLanguage drops the key on a copy', () => {
    const map: LocalizedMap = { pl: PL }
    expect(addLanguage(map, 'pl')).toBe(map)
    expect(addLanguage(map, 'de')).toEqual({ pl: PL, de: EMPTY_LOCALIZED })
    expect(removeLanguage(map, 'pl')).toEqual({})
    expect(map).toEqual({ pl: PL })
  })
})

describe('chapter titles', () => {
  const chapters = [
    { start_s: 0, title: 'Intro' },
    { start_s: 65, title: 'Setup' },
  ]

  test('one row per root chapter, the source title beside it', () => {
    expect(alignedChapterTitles(chapters, ['Wstęp'])).toEqual([
      { start_s: 0, sourceTitle: 'Intro', title: 'Wstęp' },
      { start_s: 65, sourceTitle: 'Setup', title: '' },
    ])
    expect(extraChapterTitles(chapters, ['a', 'b', 'c'])).toBe(1)
    expect(extraChapterTitles(chapters, [])).toBe(0)
  })

  test('setChapterTitle pads by index and trims trailing empties', () => {
    const titles = ['Wstęp']
    expect(setChapterTitle(titles, 2, 'Koniec')).toEqual(['Wstęp', '', 'Koniec'])
    expect(setChapterTitle(['Wstęp', '', 'Koniec'], 2, '')).toEqual(['Wstęp'])
    expect(titles).toEqual(['Wstęp'])
  })
})

describe('the draft delta', () => {
  test('keeps only changed languages, with null for a removal', () => {
    const base: LocalizedMap = { pl: PL, de: DE }
    const next = { pl: fields({ title: 'Zmieniony' }), de: DE, es: fields() }
    expect(localizedDraft(base, next)).toEqual({ pl: next.pl, es: fields() })
    expect(localizedDraft(base, { de: DE })).toEqual({ pl: null })
    expect(localizedDraft(base, base)).toEqual({})
  })

  test('applyLocalizedDraft overlays it, a null removing the language', () => {
    const base: LocalizedMap = { pl: PL, de: DE }
    const next = fields({ title: 'Neu' })
    expect(applyLocalizedDraft(base, { de: next, pl: null })).toEqual({ de: next })
    expect(applyLocalizedDraft(base, undefined)).toBe(base)
    expect(base).toEqual({ pl: PL, de: DE })
  })
})

describe('composeLocalizedPatch', () => {
  test('an agent added another language meanwhile: only the user’s language is sent', () => {
    // The user edited `pl` while the record had only `pl`…
    const draft = localizedDraft({ pl: PL }, { pl: fields({ title: 'Mój' }) })
    // …and the agent wrote `de` before the send.
    const latest = { localized: { pl: PL, de: DE } }

    const patch = composeLocalizedPatch(draft, latest)

    expect(Object.keys(patch)).toEqual(['pl'])
    expect(patch.pl?.title).toBe('Mój')
  })

  test('unwritten strings go out as null, as the schema stores them', () => {
    const patch = composeLocalizedPatch({ pl: fields({ title: 'T' }) }, { localized: {} })
    expect(patch.pl).toEqual({
      title: 'T',
      description: null,
      short_description: null,
      tags: [],
      hashtags: [],
      chapter_titles: [],
      shorts_caption: null,
    })
  })

  test('a removal is sent only while the latest record still holds the language', () => {
    expect(composeLocalizedPatch({ pl: null }, { localized: { pl: PL } })).toEqual({ pl: null })
    expect(composeLocalizedPatch({ pl: null }, { localized: {} })).toEqual({})
  })

  test('a language the latest record already matches is not re-sent', () => {
    expect(composeLocalizedPatch({ pl: PL }, { localized: { pl: PL } })).toEqual({})
  })
})

describe('withLocalizedDraft / withLocalizedRestore', () => {
  test('a patch without localized passes through by identity', () => {
    const patch = { title: 'x' }
    expect(withLocalizedDraft(patch, { localized: {} })).toBe(patch)
    expect(withLocalizedRestore(patch, { localized: {} })).toBe(patch)
  })

  test('a delta with nothing left to send drops the key, keeping the rest', () => {
    expect(
      withLocalizedDraft({ title: 'x', localized: { pl: PL } }, { localized: { pl: PL } })
    ).toEqual({ title: 'x' })
  })

  test('the draft path keeps null removals from the untyped patch value', () => {
    expect(withLocalizedDraft({ localized: { pl: null } }, { localized: { pl: PL } })).toEqual({
      localized: { pl: null },
    })
  })

  test('Revert restores a whole prev: removes what it lacks, re-sends what differs, nothing else', () => {
    const latest = { localized: { pl: fields({ title: 'Agent' }), de: DE } }
    const prev = { de: DE, fr: { title: 'Titre' } }

    const patch = withLocalizedRestore({ localized: prev }, latest)

    expect(patch.localized).toEqual({
      fr: expect.objectContaining({ title: 'Titre', description: null }),
      pl: null,
    })
  })
})

describe('survivingLocalized (an agent wrote the record)', () => {
  test('keeps the languages the agent left alone and drops the ones it wrote over', () => {
    const draft: LocalizedMap = { pl: fields({ title: 'Mój' }), de: null }
    const local: LocalizedMap = { pl: PL, de: DE }

    // The agent added `fr` only: the whole delta survives.
    expect(survivingLocalized(draft, local, { ...local, fr: fields() })).toEqual(draft)
    // The agent rewrote `pl`: the user's stale `pl` must not erase it.
    expect(survivingLocalized(draft, local, { pl: fields({ title: 'Agent' }), de: DE })).toEqual({
      de: null,
    })
    // The agent removed `de` and rewrote `pl`: nothing of the draft is left.
    expect(survivingLocalized(draft, local, { pl: fields({ title: 'Agent' }) })).toBeNull()
  })
})

describe('packageLanguages', () => {
  test('source first, then each stored localized language', () => {
    expect(packageLanguages({ language: 'en', localized: { pl: PL, 'pt-BR': fields() } })).toEqual([
      { lang: null, label: 'English (source)' },
      { lang: 'pl', label: 'Polish' },
      { lang: 'pt-BR', label: 'PT-BR' },
    ])
    expect(packageLanguages({ language: '', localized: {} })).toEqual([
      { lang: null, label: 'Source language' },
    ])
  })
})
