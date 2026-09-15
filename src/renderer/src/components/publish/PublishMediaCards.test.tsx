/**
 * Static-markup tests (node env, `react-dom/server`) for the Shorts and
 * Thumbnail cards.
 *
 * What matters: each card explains itself when empty, draws what the agent
 * wrote, rings the cover, asks before deleting a frame, and files every
 * backend finding under the control it names — a row's under that row, and a
 * finding no control claims still shown rather than lost.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishController } from '../../hooks/usePublishRecord'
import { EMPTY_FIELDS } from '../../lib/publishDrafts'
import { violationsForField } from '../../lib/publishViolations'
import type { PublishRecord, Violation } from '../../lib/publishTypes'
import { ShortsCard } from './ShortsCard'
import { ThumbnailCardView } from './ThumbnailCard'
import type { ThumbnailCardViewProps } from './ThumbnailCard'

const noop = () => {}
const A = `${'a'.repeat(32)}.jpg`
const B = `${'b'.repeat(32)}.jpg`

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    ...EMPTY_FIELDS,
    id: 'f'.repeat(32),
    rev: 3,
    duration: 600,
    status: 'captioned',
    hasProject: true,
    links: [],
    history: [],
    language: 'en',
    languages: ['en'],
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
    // The real routing, so dotted and indexed fields reach the card as in the app.
    violationsFor: (field) => violationsForField(violations, field),
    provenance: () => null,
    canRevert: () => false,
    revert: noop,
    setField: noop,
    setCollection: noop,
    flushDrafts: () => Promise.resolve(),
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

function finding(field: string, rule: string, severity: Violation['severity'] = 'hard'): Violation {
  return { field, rule, message: `${rule} message`, severity }
}

describe('ShortsCard', () => {
  const props = { segments: [], onSeek: noop, getPlayhead: () => 0 }

  test('explains itself when nothing is written, and offers to add a clip', () => {
    const markup = renderToStaticMarkup(<ShortsCard publish={controller(record())} {...props} />)

    expect(markup).toContain('>Shorts<')
    expect(markup).toContain('aria-label="Shorts caption"')
    expect(markup).toContain('No clip suggestions yet')
    expect(markup).toContain('Add clip at playhead')
  })

  test('draws the caption and each clip with its ends, length and why', () => {
    const shorts = {
      caption: 'The one-minute version',
      clip_suggestions: [
        { start_s: 12, end_s: 42, why: 'The punchline' },
        { start_s: 3725, end_s: 3800.5, why: 'The demo' },
      ],
    }
    const markup = renderToStaticMarkup(
      <ShortsCard publish={controller(record({ shorts }))} {...props} />
    )

    expect(markup).toContain('The one-minute version')
    expect(markup).toContain('00:12')
    expect(markup).toContain('00:42')
    expect(markup).toContain('1:02:05')
    expect(markup).toContain('30.0 s')
    expect(markup).toContain('75.5 s')
    expect(markup).toContain('value="The punchline"')
    expect(markup).toContain('⇤ playhead')
    expect(markup).toContain('playhead ⇥')
    expect(markup).not.toContain('No clip suggestions yet')
  })

  test('files a row’s findings under that row, and keeps the ones no row claims', () => {
    const shorts = {
      caption: '',
      clip_suggestions: [
        { start_s: 10, end_s: 90, why: 'first' },
        { start_s: 50, end_s: 20, why: 'second' },
      ],
    }
    const violations = [
      finding('shorts.clip_suggestions[0]', 'shorts_clip_length', 'style'),
      finding('shorts.clip_suggestions[1]', 'clip_order'),
      finding('shorts.clip_suggestions[9]', 'clip_past_end'),
      finding('shorts.caption', 'caption_rule'),
    ]
    const markup = renderToStaticMarkup(
      <ShortsCard publish={controller(record({ shorts }), violations)} {...props} />
    )

    const first = markup.indexOf('value="first"')
    const second = markup.indexOf('value="second"')
    const length = markup.indexOf('shorts_clip_length message')
    const order = markup.indexOf('clip_order message')
    expect(first).toBeLessThan(length)
    expect(length).toBeLessThan(second)
    expect(second).toBeLessThan(order)
    expect(markup).toContain('clip_past_end message')
    expect(markup.indexOf('caption_rule message')).toBeLessThan(first)
    // Style is amber, hard is danger.
    expect(markup).toContain('var(--color-amber-2)')
    expect(markup).toContain('var(--color-danger)')
  })
})

describe('ThumbnailCardView', () => {
  function view(
    base: PublishRecord,
    over: Partial<ThumbnailCardViewProps> = {},
    v: Violation[] = []
  ) {
    return renderToStaticMarkup(
      <ThumbnailCardView
        publish={controller(base, v)}
        busy={false}
        confirming={null}
        onConfirm={noop}
        onGrab={noop}
        onUpload={noop}
        onDelete={noop}
        onSaveCover={noop}
        onAssetError={noop}
        {...over}
      />
    )
  }

  test('the empty state explains frames; Save cover waits for a cover', () => {
    const markup = view(record())

    expect(markup).toContain('>Thumbnail<')
    expect(markup).toContain('No frames yet')
    expect(markup).toContain('upload an image')
    expect(markup).toContain('>Grab frame<')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Save cover…<\/button>/)
    expect(markup).toContain('No thumbnail ideas yet')
  })

  test('offers an image upload through a hidden picker limited to the accepted formats', () => {
    const markup = view(record())

    expect(markup).toMatch(/<button[^>]*title="[^"]+"[^>]*>Upload image…<\/button>/)
    const input = markup.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? ''
    expect(input).toContain('accept="image/jpeg,image/png,image/webp"')
    expect(input).toContain('hidden=""')
  })

  test('the upload waits while a frame call is in flight', () => {
    expect(view(record(), { busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Upload image…<\/button>/
    )
  })

  test('draws a tile per frame and rings the cover', () => {
    const markup = view(record({ thumbnail: { ideas: [], candidates: [A, B], cover: B } }))

    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1)
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(markup).toContain('2px solid var(--color-brand)')
    expect(markup).toContain('>Cover<')
    expect(markup).not.toContain('No frames yet')
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Save cover…<\/button>/)
  })

  test('asks inline before deleting — only for the frame whose × was clicked', () => {
    const base = record({ thumbnail: { ideas: [], candidates: [A, B], cover: null } })

    expect(view(base)).not.toContain('Delete this frame?')
    const markup = view(base, { confirming: A })
    expect(markup.match(/Delete this frame\?/g)).toHaveLength(1)
    // The other tile still offers its ×.
    expect(markup.match(/aria-label="Delete this frame"/g)).toHaveLength(1)
  })

  test('draws the ideas with their type and the recommended mark', () => {
    const ideas = [
      { label: 'Shock', type: 'face', headline: 'It broke', recommended: false },
      {
        label: 'Explain',
        type: 'diagram',
        headline: 'How it works',
        subtext: 'in 60s',
        visual_suggestion: 'arrows',
        recommended: true,
      },
    ]
    const markup = view(record({ thumbnail: { ideas, candidates: [], cover: null } }))

    expect(markup).toContain('value="It broke"')
    expect(markup).toContain('value="in 60s"')
    expect(markup).toContain('value="arrows"')
    expect(markup).toContain('<option value="diagram" selected="">diagram</option>')
    expect(markup.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1)
  })

  test('the cover finding lands under the strip, the ideas finding under the ideas', () => {
    const base = record({
      thumbnail: {
        ideas: [{ label: 'x', type: 'text', headline: 'h', recommended: false }],
        candidates: [A],
        cover: null,
      },
    })
    const markup = view(base, {}, [
      finding('thumbnail.ideas', 'thumbnail_recommended', 'style'),
      finding('thumbnail.cover', 'cover_not_a_candidate'),
    ])

    const cover = markup.indexOf('cover_not_a_candidate message')
    const grab = markup.indexOf('>Grab frame<')
    const ideasLabel = markup.indexOf('>Ideas<')
    const recommended = markup.indexOf('thumbnail_recommended message')
    expect(cover).toBeGreaterThan(-1)
    expect(cover).toBeLessThan(grab)
    expect(ideasLabel).toBeLessThan(recommended)
  })
})
