/**
 * Static-markup tests (node env, `react-dom/server`) for the Localized card.
 *
 * What matters: the card explains itself with no languages, lists a translated
 * track without fields as "not started" (and never the source language), meters
 * what YouTube counts, lines chapter titles up with the root chapters under the
 * source titles, asks before removing a language, and files each
 * `localized.<lang>…` finding under the control it names.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishController } from '../../hooks/usePublishRecord'
import { EMPTY_FIELDS } from '../../lib/publishDrafts'
import { EMPTY_LOCALIZED } from '../../lib/publishMediaTypes'
import { violationsForField } from '../../lib/publishViolations'
import type { PublishRecord, Violation } from '../../lib/publishTypes'
import { LocalizedCardView } from './LocalizedCard'
import type { LocalizedCardViewProps } from './LocalizedCard'

const noop = () => {}

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    ...EMPTY_FIELDS,
    id: 'f'.repeat(32),
    rev: 3,
    duration: 600,
    status: 'drafted',
    hasProject: true,
    links: [],
    history: [],
    language: 'en',
    languages: ['en'],
    title: 'The source title',
    chapters: [
      { start_s: 0, title: 'Intro' },
      { start_s: 65, title: 'Setup' },
    ],
    ...over,
  }
}

function controller(base: PublishRecord, violations: Violation[] = []): PublishController {
  return {
    record: base,
    fields: base,
    loading: false,
    saving: false,
    dirty: false,
    violationsFor: (field) => violationsForField(violations, field),
    provenance: () => null,
    canRevert: () => false,
    revert: noop,
    setField: noop,
    setCollection: noop,
    flushDrafts: () => Promise.resolve(),
    patchNow: () => Promise.resolve(),
    beginEdit: noop,
    endEdit: noop,
    pendingAgentUpdate: null,
    applyAgentUpdate: noop,
    keepMine: noop,
    markPublished: noop,
    suggestChapters: noop,
    insertChapterAt: noop,
    removeChapterAt: noop,
    renameChapter: noop,
    speakerIds: [],
  }
}

function view(
  base: PublishRecord,
  over: Partial<LocalizedCardViewProps> = {},
  violations: Violation[] = []
): string {
  return renderToStaticMarkup(
    <LocalizedCardView
      publish={controller(base, violations)}
      selected={null}
      confirmingRemove={false}
      onSelect={noop}
      onConfirmRemove={noop}
      {...over}
    />
  )
}

function finding(field: string, rule: string, severity: Violation['severity'] = 'hard'): Violation {
  return { field, rule, message: `${rule} message`, severity }
}

const polish = record({
  languages: ['en', 'pl'],
  localized: {
    pl: {
      ...EMPTY_LOCALIZED,
      title: 'Tytuł',
      description: 'Zażółć',
      chapter_titles: ['Wstęp'],
      shorts_caption: 'Zobacz to',
    },
  },
})

describe('LocalizedCardView', () => {
  test('with no other language it explains itself and offers to add one', () => {
    const markup = view(record())

    expect(markup).toContain('>Localized<')
    expect(markup).toContain('No other languages yet')
    expect(markup).toContain('aria-label="Add language"')
    expect(markup).toContain('<option value="pl">Polish · Polski</option>')
    // The source language is never offered: the root fields already are English.
    expect(markup).not.toContain('<option value="en">')
    expect(markup).not.toContain('Remove language')
  })

  test('one language: its chip, meters, aligned chapter titles, caption and Remove', () => {
    const markup = view(polish)

    expect(markup).toMatch(/aria-pressed="true"[^>]*>.*?Polish/)
    expect(markup).toContain('value="Tytuł"')
    expect(markup).toContain('5/100 chars')
    // "Zażółć" is 6 characters and 10 bytes.
    expect(markup).toContain('10/5000 bytes')
    expect(markup).toContain('placeholder="The source title"')
    // Chapter rows: a timestamp each, the source title as the placeholder.
    expect(markup).toContain('00:00')
    expect(markup).toContain('01:05')
    expect(markup).toContain('value="Wstęp"')
    expect(markup).toContain('placeholder="Setup"')
    expect(markup).toContain('Zobacz to')
    expect(markup).toContain('Remove language')
    expect(markup).not.toContain('<option value="pl">')
    expect(markup).not.toContain('No other languages yet')
  })

  test('a translated track without fields is a "not started" chip with an empty form', () => {
    const base = record({ ...polish, languages: ['en', 'pl', 'de'] })

    const markup = view(base)
    expect(markup).toContain('not started')
    // English is the source: never a chip.
    expect(markup).not.toMatch(/aria-pressed="[a-z]+"[^>]*>(<span>)?English/)

    const german = view(base, { selected: 'de' })
    expect(german).toContain('aria-label="Title (de)"')
    expect(german).toContain('Not started — typing starts it')
    expect(german).not.toContain('Remove language')
  })

  test('asks inline before removing a language', () => {
    expect(view(polish, { confirmingRemove: true })).toContain('Remove Polish and its fields?')
  })

  test('files each localized finding under the control it names', () => {
    const markup = view(polish, {}, [
      finding('localized.pl', 'localized_lang_code'),
      finding('localized.pl.title', 'title_too_long'),
      finding('localized.pl.description', 'description_too_long'),
      finding('localized.pl.chapter_titles', 'localized_chapter_count', 'style'),
      finding('localized.en', 'localized_is_source'),
    ])

    const header = markup.indexOf('localized_lang_code message')
    const titleInput = markup.indexOf('aria-label="Title (pl)"')
    const titleFinding = markup.indexOf('title_too_long message')
    const descriptionInput = markup.indexOf('aria-label="Description (pl)"')
    const descriptionFinding = markup.indexOf('description_too_long message')
    const chapterFinding = markup.indexOf('localized_chapter_count message')
    const captionInput = markup.indexOf('aria-label="Shorts caption (pl)"')

    expect(header).toBeGreaterThan(-1)
    expect(header).toBeLessThan(titleInput)
    expect(titleInput).toBeLessThan(titleFinding)
    expect(titleFinding).toBeLessThan(descriptionInput)
    expect(descriptionInput).toBeLessThan(descriptionFinding)
    expect(descriptionFinding).toBeLessThan(chapterFinding)
    expect(chapterFinding).toBeLessThan(captionInput)
    // A finding for a language that is not a chip (the source) is still shown.
    expect(markup).toContain('localized_is_source message')
    // The chip counts its language's findings.
    expect(markup).toContain('aria-label="4 finding(s)"')
  })
})
