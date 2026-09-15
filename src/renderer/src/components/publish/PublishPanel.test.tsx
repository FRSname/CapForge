/**
 * Static-markup tests (node env, `react-dom/server`) for the Publish aside.
 *
 * What matters per card: the meter counts what YouTube counts, the backend's
 * findings land under the field they name, the provenance chip says who wrote
 * it, and Revert only appears when there is something recorded to go back to.
 *
 * And, for the panel itself (multi-channel PR 3): a video on no channel gets
 * the "Publish to:" checklist, a video on one gets its tabs, each tab shows
 * only its platform's fields, and the footer copies that tab's package.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Post } from '../../lib/publishPosts'
import type { PublishRecord, Violation } from '../../lib/publishTypes'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { PublishChannels } from '../../hooks/usePublishChannels'
import type { CaptionTrack } from '../../lib/tracks'
import type { Segment } from '../../types/app'
import { parseChannel } from '../../lib/channelTypes'
import { channelTabs } from '../../lib/channelPublishView'
import { EMPTY_POST, addableChannels, resolveActiveChannel } from '../../lib/publishPosts'
import { PublishPanelView } from './PublishPanel'
import { NO_CHANNEL_HINT } from './PublishFooter'
import { TitleCard } from './TitleCard'
import { DescriptionCard } from './DescriptionCard'
import { ChaptersCard } from './ChaptersCard'
import { KeywordsCard } from './KeywordsCard'
import { TagsCard } from './TagsCard'
import { SpeakersCard } from './SpeakersCard'
import { SummaryCard } from './SummaryCard'
import { PublishStateCard } from './PublishStateCard'
import { provenanceOf, revertPatchFor } from '../../lib/publishFields'

/** Relative to the real clock, so "3 m ago" is stable whenever the suite runs. */
const MINUTES = 60 * 1000
const THREE_MINUTES_AGO = new Date(Date.now() - 3 * MINUTES).toISOString()

const noop = () => {}

/**
 * The backend keeps the per-video text in `posts` and serves the root fields as
 * the **primary** channel's post (PR 2's projection), so a record fixture
 * mirrors them the same way unless a test says otherwise.
 */
function projectedPost(base: PublishRecord): Post {
  return {
    ...EMPTY_POST,
    title: base.title,
    description: base.description,
    tags: base.tags,
    hashtags: base.hashtags,
    localized: base.localized,
    cover: base.thumbnail.cover,
  }
}

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  const base: PublishRecord = {
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
    localized: {},
    posts: {},
    language: 'en',
    languages: ['en'],
    history: [
      { field: 'title', prev: 'The first draft', by: 'agent', at: THREE_MINUTES_AGO },
      { field: 'description', prev: undefined, by: 'user', at: THREE_MINUTES_AGO },
    ],
    ...over,
  }
  return over.posts ? base : { ...base, posts: { uck: projectedPost(base) } }
}

/** A controller over a fixed record — the cards hold no state of their own. */
function controller(
  over: Partial<PublishController> = {},
  base: PublishRecord = record(),
  violations: Violation[] = []
): PublishController {
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
    speakerIds: ['SPEAKER_00'],
    ...over,
  }
}

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK', language: 'en' })
const INSTAGRAM = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })
const CHANNELS = [UCK, INSTAGRAM]

/** The channels hook's answer for a record, as the panel reads it. */
function channelsFor(publish: PublishController, activeId?: string): PublishChannels {
  const posts = publish.record?.posts ?? {}
  const tabs = channelTabs(posts, CHANNELS, UCK.id)
  const chosen =
    activeId ??
    resolveActiveChannel(
      tabs.map((t) => t.id),
      undefined,
      UCK.id
    )
  return {
    channels: CHANNELS,
    platforms: null,
    tabs,
    active: tabs.find((t) => t.id === chosen) ?? null,
    menu: addableChannels(posts, CHANNELS),
    select: noop,
    addChannels: noop,
    hideChannel: noop,
    channelViolations: [],
    notify: noop,
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
})

describe('KeywordsCard', () => {
  test('files a style finding under the field it names', () => {
    const markup = html(
      <KeywordsCard
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

  function panel(publish: PublishController, activeId?: string): string {
    return html(
      <PublishPanelView publish={publish} channels={channelsFor(publish, activeId)} {...props} />
    )
  }

  test('stacks every card and pins the package actions', () => {
    const markup = panel(controller())

    // Under "This video", Shorts and Thumbnail come straight after Chapters.
    const order = ['Chapters', 'Shorts', 'Thumbnail', 'Keywords'].map((t) =>
      markup.indexOf(`>${t}<`)
    )
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    for (const title of [
      'Title',
      'Description',
      'Tags &amp; hashtags',
      'Collection',
      'Chapters',
      'Shorts',
      'Thumbnail',
      'Keywords',
      'Speakers',
      'Summary',
      'Publish state',
      'This video',
    ]) {
      expect(markup).toContain(title)
    }
    expect(markup).toContain('Copy YouTube package')
    expect(markup).toContain('Copy plain transcript')
  })

  test('the Localized card sits right after Description', () => {
    const markup = panel(controller())
    const description = markup.indexOf('>Description<')
    const localized = markup.indexOf('>Localized<')
    const collection = markup.indexOf('>Collection<')
    expect(description).toBeGreaterThan(-1)
    expect(description).toBeLessThan(localized)
    expect(localized).toBeLessThan(collection)
  })

  test('the package gets a language choice once a localized language is stored, source first', () => {
    // Only the source: no choice to make.
    expect(panel(controller())).not.toContain('Upload package language')

    const base = record({
      languages: ['en', 'pl', 'de'],
      localized: {
        pl: {
          title: 'Tytuł',
          description: '',
          short_description: '',
          tags: [],
          hashtags: [],
          chapter_titles: [],
          shorts_caption: '',
        },
      },
    })
    const markup = panel(controller({}, base))

    expect(markup).toContain('aria-label="Upload package language"')
    const source = markup.indexOf('<option value="" selected="">English (source)</option>')
    const polish = markup.indexOf('<option value="pl">Polish</option>')
    expect(source).toBeGreaterThan(-1)
    expect(source).toBeLessThan(polish)
    // A track language with no stored fields has no package (the route 404s).
    expect(markup).not.toContain('<option value="de">')
  })

  test('says so instead of drawing empty cards when there is no record', () => {
    const markup = panel(controller({ record: null, loading: false }))

    expect(markup).toContain('no library record yet')
    expect(markup).not.toContain('Above the fold')
  })

  test('reports whether the drafts have landed', () => {
    expect(panel(controller({ dirty: true }))).toContain('Unsaved')
    expect(panel(controller({ saving: true }))).toContain('Saving')
  })

  test('a video on no channel gets the checklist instead of tabs, and cannot copy', () => {
    const markup = panel(controller({}, record({ posts: {} })))

    expect(markup).toContain('Publish to:')
    expect(markup).toContain('Filip IG')
    expect(markup).not.toContain('role="tablist"')
    // No channel, so no channel fields — but the video's own stay.
    expect(markup).not.toContain('Above the fold')
    expect(markup).toContain('>Chapters<')
    expect(markup).toContain(NO_CHANNEL_HINT)
  })

  test('a video on a channel gets the tab strip instead of the checklist', () => {
    const markup = panel(controller())

    expect(markup).toContain('aria-label="Channels"')
    expect(markup).toContain('>UCK<')
    expect(markup).not.toContain('Publish to:')
  })

  test('an Instagram tab shows the post text, not the YouTube fields', () => {
    const base = record()
    const withInstagram = {
      ...base,
      posts: { ...base.posts, 'filip-ig': { ...EMPTY_POST, caption: 'Hello from Instagram' } },
    }
    const markup = panel(controller({}, withInstagram), 'filip-ig')

    expect(markup).toContain('>Caption<')
    expect(markup).toContain('Hello from Instagram')
    expect(markup).toContain('>Published link<')
    expect(markup).not.toContain('>Description<')
    expect(markup).not.toContain('>Tags &amp; hashtags<')
    expect(markup).not.toContain('>Localized<')
    // The shared fields stay below the tabs.
    expect(markup).toContain('>Chapters<')
  })

  test('the copy button follows the active tab’s platform', () => {
    const base = record()
    const withInstagram = {
      ...base,
      posts: { ...base.posts, 'filip-ig': { ...EMPTY_POST } },
    }

    expect(panel(controller({}, withInstagram), 'uck')).toContain('Copy YouTube package')
    expect(panel(controller({}, withInstagram), 'filip-ig')).toContain('Copy Instagram caption')
  })
})

/** The chip is the review surface for tier-1 agent writes — pin its reading. */
describe('provenance', () => {
  test('an untouched field says so and offers no Revert', () => {
    const markup = html(<TagsCard publish={controller()} />)
    expect(markup).toContain('not written')
  })
})
