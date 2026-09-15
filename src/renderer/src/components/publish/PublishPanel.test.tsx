/**
 * Static-markup tests (node env, `react-dom/server`) for the Publish aside.
 *
 * What matters per card: the meter counts what YouTube counts, the backend's
 * findings land under the field they name, the provenance chip says who wrote
 * it, and Revert only appears when there is something recorded to go back to.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishRecord, Violation } from '../../lib/publishTypes'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { CaptionTrack } from '../../lib/tracks'
import type { Segment } from '../../types/app'
import { PublishPanel } from './PublishPanel'
import { TitleCard } from './TitleCard'
import { DescriptionCard } from './DescriptionCard'
import { ChaptersCard } from './ChaptersCard'
import { TagsCard } from './TagsCard'
import { SpeakersCard } from './SpeakersCard'
import { SummaryCard } from './SummaryCard'
import { PublishStateCard } from './PublishStateCard'
import { provenanceOf, revertPatchFor } from '../../lib/publishFields'

/** Relative to the real clock, so "3 m ago" is stable whenever the suite runs. */
const MINUTES = 60 * 1000
const THREE_MINUTES_AGO = new Date(Date.now() - 3 * MINUTES).toISOString()

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    id: 'vid_1',
    rev: 4,
    duration: 1800,
    status: 'drafted',
    hasProject: true,
    title_options: ['A shorter option', 'A longer option that is still fine'],
    title: 'A shorter option',
    description: 'Hook sentence that sits above the fold.\n\nThen the rest of it.',
    chapters: [
      { start_s: 0, title: 'Intro' },
      { start_s: 3725, title: 'The render pipeline' },
    ],
    tags: ['whisper', 'captions'],
    keywords: ['subtitle editor'],
    hashtags: ['#ai'],
    speakers: { SPEAKER_00: { name: 'Filip', handle: '@filip', url: '' } },
    summary_md: '# Summary\n\nWhat happened.',
    collection_id: null,
    links: [],
    publish: { youtube: null, pushes: [] },
    shorts: { caption: '', clip_suggestions: [] },
    thumbnail: { ideas: [], candidates: [], cover: null },
    history: [
      { field: 'title', prev: 'The first draft', by: 'agent', at: THREE_MINUTES_AGO },
      { field: 'description', prev: undefined, by: 'user', at: THREE_MINUTES_AGO },
    ],
    ...over,
  }
}

/** A controller over a fixed record — the cards hold no state of their own. */
function controller(
  over: Partial<PublishController> = {},
  base: PublishRecord = record(),
  violations: Violation[] = []
): PublishController {
  const noop = () => {}
  return {
    record: base,
    fields: base,
    loading: false,
    saving: false,
    dirty: false,
    violationsFor: (field) => violations.filter((v) => v.field === field),
    provenance: (field) => provenanceOf(base, field),
    canRevert: (field) => revertPatchFor(base, field) !== null,
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
    speakerIds: ['SPEAKER_00'],
    ...over,
  }
}

function violation(field: string, message: string, severity: Violation['severity'] = 'hard') {
  return { field, rule: `${field.toUpperCase()}_RULE`, message, severity }
}

const segments: Segment[] = [
  { id: 's1', start: 0, end: 2, text: 'Hello there.', words: [], speaker: 'SPEAKER_00' },
]

const sourceTrack = {
  id: 'src',
  label: 'English',
  lang: 'en',
  isSource: true,
  segments,
  groups: [],
} as unknown as CaptionTrack

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

describe('TitleCard', () => {
  test('offers the options as radio rows and meters the chosen title', () => {
    const markup = html(<TitleCard publish={controller()} />)

    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('A longer option that is still fine')
    // 16 characters of a 100-character budget.
    expect(markup).toContain('16/100 chars')
    // Written by the agent three minutes ago, and revertable.
    expect(markup).toContain('edited 3 m ago')
    expect(markup).toContain('aria-label="Revert this field"')
  })

  test('renders the finding the backend filed against the title', () => {
    const markup = html(
      <TitleCard
        publish={controller({}, record(), [violation('title', 'Title is over 100 characters')])}
      />
    )

    expect(markup).toContain('Title is over 100 characters')
  })

  test('hides the options block when the agent has not written any', () => {
    const markup = html(<TitleCard publish={controller({}, record({ title_options: [] }))} />)

    expect(markup).not.toContain('Title options')
  })
})

describe('DescriptionCard', () => {
  test('meters bytes, not characters, and previews the first 150', () => {
    const emoji = 'A 🎬 description'
    const markup = html(
      <DescriptionCard publish={controller({}, record({ description: emoji }))} />
    )

    // 15 characters, 18 bytes: the emoji is four.
    expect(markup).toContain('18/5000 bytes')
    expect(markup).toContain('Above the fold')
  })

  test('shows no Revert when nothing previous was recorded', () => {
    // The description's only history entry has no `prev`.
    const markup = html(<DescriptionCard publish={controller()} />)
    const reverts = markup.match(/aria-label="Revert this field"/g) ?? []
    expect(reverts).toHaveLength(0)
  })
})

describe('ChaptersCard', () => {
  const props = { onSeek: () => {}, getPlayhead: () => 0 }

  test('formats MM:SS and H:MM:SS and offers both generators', () => {
    const markup = html(<ChaptersCard publish={controller()} {...props} />)

    expect(markup).toContain('00:00')
    expect(markup).toContain('1:02:05')
    expect(markup).toContain('Insert at playhead')
    expect(markup).toContain('Suggest')
  })

  test('says what to do when there are no chapters, and shows the findings', () => {
    const markup = html(
      <ChaptersCard
        publish={controller({}, record({ chapters: [] }), [
          violation('chapters', 'The first chapter must start at 00:00'),
        ])}
        {...props}
      />
    )

    expect(markup).toContain('No chapters yet')
    expect(markup).toContain('The first chapter must start at 00:00')
  })
})

describe('TagsCard', () => {
  test('renders one editable line per list and meters the joined tags', () => {
    const markup = html(<TagsCard publish={controller()} />)

    expect(markup).toContain('value="whisper, captions"')
    expect(markup).toContain('value="#ai"')
    // "whisper, captions" is 17 characters of the 500 YouTube counts.
    expect(markup).toContain('17/500 chars')
  })

  test('files a style finding under the field it names', () => {
    const markup = html(
      <TagsCard
        publish={controller({}, record(), [
          violation('keywords', 'The keyword line has 1 term, the brief asks for 12–20', 'style'),
        ])}
      />
    )

    expect(markup).toContain('The keyword line has 1 term')
    expect(markup).toContain('var(--color-amber-2)')
  })
})

describe('SpeakersCard', () => {
  test('renders a row per diarized id with what has been written for it', () => {
    const markup = html(<SpeakersCard publish={controller()} />)

    expect(markup).toContain('SPEAKER_00')
    expect(markup).toContain('value="Filip"')
    expect(markup).toContain('value="@filip"')
  })

  test('explains itself when the transcript was never diarized', () => {
    const markup = html(
      <SpeakersCard publish={controller({ speakerIds: [] }, record({ speakers: {} }))} />
    )

    expect(markup).toContain('no diarized speakers')
  })
})

describe('SummaryCard and PublishStateCard', () => {
  test('the summary is a plain markdown textarea', () => {
    const markup = html(<SummaryCard publish={controller()} />)
    expect(markup).toContain('aria-label="Summary"')
    expect(markup).toContain('# Summary')
  })

  test('publish state reads "not published" until a URL is recorded', () => {
    expect(html(<PublishStateCard publish={controller()} />)).toContain('Not published yet.')
  })

  test('publish state names the video and the status once it is', () => {
    const published = record({
      status: 'published',
      publish: {
        youtube: {
          videoId: 'dQw4w9WgXcQ',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          publishedAt: '2026-09-14T09:00:00Z',
        },
        pushes: [],
      },
    })

    const markup = html(<PublishStateCard publish={controller({}, published)} />)

    expect(markup).toContain('Published as dQw4w9WgXcQ')
    expect(markup).toContain('Status: published')
  })
})

describe('PublishPanel', () => {
  const props = {
    segments,
    tracks: [sourceTrack],
    outputDir: '',
    onSeek: () => {},
    getPlayhead: () => 0,
  }

  test('stacks every card and pins the package actions', () => {
    const markup = html(<PublishPanel publish={controller()} {...props} />)

    // Shorts and Thumbnail come straight after Chapters.
    const order = ['Chapters', 'Shorts', 'Thumbnail', 'Tags &amp; keywords'].map((t) =>
      markup.indexOf(`>${t}<`)
    )
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    for (const title of [
      'Title',
      'Description',
      'Collection',
      'Chapters',
      'Shorts',
      'Thumbnail',
      'Tags &amp; keywords',
      'Speakers',
      'Summary',
      'Publish state',
    ]) {
      expect(markup).toContain(title)
    }
    expect(markup).toContain('Copy upload package')
    expect(markup).toContain('Copy plain transcript')
  })

  test('says so instead of drawing empty cards when there is no record', () => {
    const markup = html(
      <PublishPanel publish={controller({ record: null, loading: false })} {...props} />
    )

    expect(markup).toContain('no library record yet')
    expect(markup).not.toContain('Above the fold')
  })

  test('reports whether the drafts have landed', () => {
    expect(html(<PublishPanel publish={controller({ dirty: true })} {...props} />)).toContain(
      'Unsaved'
    )
    expect(html(<PublishPanel publish={controller({ saving: true })} {...props} />)).toContain(
      'Saving'
    )
  })
})

/** The chip is the review surface for tier-1 agent writes — pin its reading. */
describe('provenance', () => {
  test('an untouched field says so and offers no Revert', () => {
    const markup = html(<TagsCard publish={controller()} />)
    expect(markup).toContain('not written')
  })
})
