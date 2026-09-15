/**
 * One channel tab's view of the Publish controller: where a field's write
 * lands, where its findings are drawn, and what Revert and Mark published send.
 */

import { describe, expect, test } from 'vitest'
import type { ChannelTab } from './channelPublishView'
import {
  NOT_A_YOUTUBE_URL_MESSAGE,
  NO_POST_URL_MESSAGE,
  channelPublishController,
  channelTabs,
  postFieldFor,
  postRevertPatch,
  publishedValue,
  unclaimedPostViolations,
} from './channelPublishView'
import { parseChannel } from './channelTypes'
import { EMPTY_LOCALIZED } from './publishMediaTypes'
import { EMPTY_PUBLISHED } from './publishPosts'
import type { PublishRecord, Violation } from './publishTypes'
import { publishHarness, testPost, testRecord } from './publishHarness.testutil'

function tab(over: Partial<ChannelTab> = {}): ChannelTab {
  return {
    id: 'uck',
    name: 'UCK',
    platform: 'youtube',
    primary: true,
    published: false,
    language: 'en',
    defaultHashtags: [],
    ...over,
  }
}

const PRIMARY = tab()
const SECOND = tab({ id: 'yt2', name: 'Second channel', primary: false })
const INSTAGRAM = tab({ id: 'ig', name: 'Filip IG', platform: 'instagram', primary: false })

function record(over: Partial<PublishRecord> = {}): PublishRecord {
  return testRecord({
    title: 'Library name',
    description: 'Primary description',
    tags: ['a'],
    posts: {
      uck: testPost({ title: 'Library name', description: 'Primary description', tags: ['a'] }),
      yt2: testPost({ description: 'The second channel’s take' }),
      ig: testPost({ caption: 'IG caption' }),
    },
    ...over,
  })
}

function view(
  base: PublishRecord,
  on: ChannelTab,
  violations: Violation[] = [],
  channelViolations: Violation[] = []
) {
  const harness = publishHarness(base, violations)
  const notify = (message: string) => harness.notes.push(message)
  return {
    harness,
    controller: channelPublishController(harness.publish(), on, null, channelViolations, notify),
  }
}

function finding(field: string, message = 'm', severity: Violation['severity'] = 'hard'): Violation {
  return { field, rule: 'r', message, severity }
}

describe('channelTabs', () => {
  test('names each tab, marks the primary and the published, and keeps orphans', () => {
    const uck = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
    const posts = {
      gone: testPost(),
      uck: testPost({ published: { url: 'https://youtu.be/x', id: 'x', at: null } }),
    }

    expect(channelTabs(posts, [uck], 'uck')).toEqual([
      {
        id: 'uck',
        name: 'UCK',
        platform: 'youtube',
        primary: true,
        published: true,
        language: '',
        defaultHashtags: [],
      },
      {
        id: 'gone',
        name: 'gone',
        platform: null,
        primary: false,
        published: false,
        language: '',
        defaultHashtags: [],
      },
    ])
  })
})

describe('what a tab shows', () => {
  test('the record is that channel’s post', () => {
    const { controller } = view(record(), SECOND)

    expect(controller.fields.description).toBe('The second channel’s take')
    // The post has no title of its own yet, so the library name stands in.
    expect(controller.fields.title).toBe('Library name')
    expect(controller.post.caption).toBe('')
  })

  test('the primary tab shows the root title being typed', () => {
    const { harness } = view(record(), PRIMARY)
    harness.publish().setField('title', 'A new name')

    const controller = channelPublishController(harness.publish(), PRIMARY, null, [], () => {})
    expect(controller.fields.title).toBe('A new name')
  })
})

describe('where a write lands', () => {
  test('the primary tab’s Title is the root title; every other field is the post', () => {
    const { harness, controller } = view(record(), PRIMARY)
    controller.setField('title', 'A new name')
    controller.setField('description', 'A new description')

    expect(harness.drafts().title).toBe('A new name')
    expect(harness.drafts().posts).toEqual({ uck: { description: 'A new description' } })
  })

  test('a non-primary tab’s Title is that post’s title', () => {
    const { harness, controller } = view(record(), SECOND)
    controller.setField('title', 'Another headline')

    expect(harness.drafts().title).toBeUndefined()
    expect(harness.drafts().posts).toEqual({ yt2: { title: 'Another headline' } })
  })

  test('the cover and the publish state are the post’s, never the root’s', () => {
    const frame = `${'a'.repeat(32)}.jpg`
    const base = record({
      thumbnail: { ideas: [], candidates: [frame], cover: null },
      posts: { ...record().posts, uck: testPost({ description: 'Primary description' }) },
    })
    const { harness, controller } = view(base, PRIMARY)
    controller.setField('thumbnail', { ideas: [], candidates: [frame], cover: frame })

    expect(harness.drafts().thumbnail).toBeUndefined()
    expect(harness.drafts().posts).toEqual({ uck: { cover: frame } })
  })

  test('a video-level field still writes its root field', () => {
    const { harness, controller } = view(record(), INSTAGRAM)
    controller.setField('keywords', ['subtitles'])

    expect(harness.drafts().keywords).toEqual(['subtitles'])
    expect(harness.drafts().posts).toBeUndefined()
  })

  test('a post field locks `posts`; a root field locks itself', () => {
    const { harness, controller } = view(record(), PRIMARY)
    controller.beginEdit('description')
    controller.beginEdit('title')
    controller.beginEdit('chapters')

    expect(harness.edits).toEqual(['posts', 'title', 'chapters'])
  })

  test('setPostField writes a field no root card has', () => {
    const { harness, controller } = view(record(), INSTAGRAM)
    controller.setPostField('caption', 'A new caption')

    expect(harness.drafts().posts).toEqual({ ig: { caption: 'A new caption' } })
  })

  test('postFieldFor: only the primary’s title stays a root write', () => {
    expect(postFieldFor('title', true)).toBeNull()
    expect(postFieldFor('title', false)).toBe('title')
    expect(postFieldFor('description', true)).toBe('description')
    expect(postFieldFor('thumbnail', true)).toBe('cover')
    expect(postFieldFor('publish', true)).toBe('published')
    expect(postFieldFor('chapters', false)).toBeNull()
  })
})

describe('where a finding is drawn', () => {
  const patchFindings = [
    finding('posts.uck.description', 'the description is too long'),
    finding('posts.uck.localized.pl.title', 'the Polish title is too long'),
    finding('chapters', 'chapters must start at 00:00'),
    finding('title', 'the title is too long'),
  ]
  const channelFindings = [
    // The same finding from the tab's own validation, plus one only it knows.
    finding('posts.uck.description', 'the description is too long'),
    finding('posts.uck.tags', 'the tags line is too long'),
  ]

  test('a post finding is readdressed to the field the card asked with, once', () => {
    const { controller } = view(record(), PRIMARY, patchFindings, channelFindings)

    expect(controller.violationsFor('description')).toEqual([
      finding('description', 'the description is too long'),
    ])
    expect(controller.violationsFor('tags')).toEqual([finding('tags', 'the tags line is too long')])
    expect(controller.violationsFor('localized')).toEqual([
      finding('localized.pl.title', 'the Polish title is too long'),
    ])
  })

  test('a video-level field keeps the record’s own findings', () => {
    const { controller } = view(record(), PRIMARY, patchFindings, channelFindings)
    expect(controller.violationsFor('chapters')).toEqual([
      finding('chapters', 'chapters must start at 00:00'),
    ])
  })

  test('the primary tab’s Title reads the root finding, a second channel’s its post’s', () => {
    const onPrimary = view(record(), PRIMARY, patchFindings, channelFindings).controller
    expect(onPrimary.violationsFor('title')).toEqual([finding('title', 'the title is too long')])

    const onSecond = view(record(), SECOND, [finding('posts.yt2.title', 'too long')], []).controller
    expect(onSecond.violationsFor('title')).toEqual([finding('title', 'too long')])
  })

  test('a finding no card claims is still listed', () => {
    const { controller } = view(
      record(),
      INSTAGRAM,
      [finding('posts.ig.caption', 'too long'), finding('posts.ig.title', 'not on Instagram')],
      []
    )

    expect(unclaimedPostViolations(controller, ['caption', 'hashtags'])).toEqual([
      finding('posts.ig.title', 'not on Instagram'),
    ])
  })
})

describe('provenance and Revert', () => {
  const at = '2026-09-16T09:00:00Z'
  const previous = testPost({ description: 'What it said before' })
  const base = record({
    history: [{ field: 'posts.yt2', prev: previous, by: 'agent', at }],
  })

  test('a post field reads the post’s history entry', () => {
    const { controller } = view(base, SECOND)
    expect(controller.provenance('description')).toEqual({ by: 'agent', at })
    expect(controller.canRevert('description')).toBe(true)
  })

  test('Revert sends the previous value back under `posts`', () => {
    const { harness, controller } = view(base, SECOND)
    controller.revert('description')

    expect(harness.patches).toEqual([{ posts: { yt2: { description: 'What it said before' } } }])
    // …and the field's draft is dropped, so the debounce cannot re-send it.
    expect(harness.drafts().posts).toEqual({})
  })

  test('a field that write did not change has nothing to revert', () => {
    const { harness, controller } = view(base, SECOND)
    expect(controller.canRevert('tags')).toBe(false)
    controller.revert('tags')

    expect(harness.patches).toEqual([])
    expect(harness.notes[0]).toContain('nothing to revert')
  })

  test('on the primary tab a root write is that post’s history too', () => {
    const rooted = record({
      history: [{ field: 'description', prev: 'The first draft', by: 'user', at }],
    })
    expect(postRevertPatch(rooted, PRIMARY, 'description')).toEqual({
      posts: { uck: { description: 'The first draft' } },
    })
    // A second channel never adopts the root field's history.
    expect(postRevertPatch(rooted, SECOND, 'description')).toBeNull()
  })

  test('reverting a post’s localized sends the language delta, not the whole map', () => {
    const before = testPost({ localized: { de: { ...EMPTY_LOCALIZED, title: 'Titel' } } })
    const now = record({
      posts: {
        ...record().posts,
        yt2: testPost({ localized: { pl: { ...EMPTY_LOCALIZED, title: 'Tytuł' } } }),
      },
      history: [{ field: 'posts.yt2', prev: before, by: 'agent', at }],
    })

    expect(postRevertPatch(now, SECOND, 'localized')).toEqual({
      posts: {
        yt2: {
          localized: {
            de: { ...EMPTY_LOCALIZED, title: 'Titel', description: null, short_description: null, shorts_caption: null },
            pl: null,
          },
        },
      },
    })
  })

  test('a video-level field passes Revert straight through', () => {
    const { harness, controller } = view(base, SECOND)
    controller.revert('chapters')
    expect(harness.rootReverts).toEqual(['chapters'])
  })
})

describe('marking a post published', () => {
  const now = '2026-09-16T10:00:00Z'

  test('a YouTube channel takes the video id from the URL and keeps the first date', () => {
    expect(publishedValue('youtube', EMPTY_PUBLISHED, ' https://youtu.be/dQw4w9WgXcQ ', now)).toEqual(
      { url: 'https://youtu.be/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ', at: now }
    )
    expect(
      publishedValue(
        'youtube',
        { url: 'https://youtu.be/old', id: 'old', at: '2026-01-01T00:00:00Z' },
        'https://youtu.be/dQw4w9WgXcQ',
        now
      )
    ).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      id: 'dQw4w9WgXcQ',
      at: '2026-01-01T00:00:00Z',
    })
  })

  test('any link is a link off YouTube; an empty one is not', () => {
    expect(publishedValue('instagram', EMPTY_PUBLISHED, 'https://instagram.com/p/1', now)).toEqual({
      url: 'https://instagram.com/p/1',
      id: null,
      at: now,
    })
    expect(publishedValue('youtube', EMPTY_PUBLISHED, 'https://example.com/x', now)).toBeNull()
    expect(publishedValue('instagram', EMPTY_PUBLISHED, '   ', now)).toBeNull()
  })

  test('the write goes under `posts`, and a refusal is said out loud', () => {
    const { harness, controller } = view(record(), INSTAGRAM)
    controller.markPublished('https://instagram.com/p/1')

    expect(harness.patches).toHaveLength(1)
    const patch = harness.patches[0] as { posts: Record<string, { published: { url: string } }> }
    expect(patch.posts.ig.published.url).toBe('https://instagram.com/p/1')

    controller.markPublished('  ')
    expect(harness.notes).toEqual([NO_POST_URL_MESSAGE])

    const youtube = view(record(), PRIMARY)
    youtube.controller.markPublished('https://example.com/x')
    expect(youtube.harness.notes).toEqual([NOT_A_YOUTUBE_URL_MESSAGE])
    expect(youtube.harness.patches).toEqual([])
  })
})
