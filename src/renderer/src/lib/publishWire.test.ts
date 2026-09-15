/**
 * What a Publish write actually carries.
 *
 * The rule the whole PR rests on: the UI never sends a projected root field
 * (`description`, `tags`, `hashtags`, `localized`, `thumbnail.cover`,
 * `publish.youtube`) — those are the primary channel's post, and sending one
 * beside `posts.<primary>.<field>` is a `422 ambiguous_post_field`.
 */

import { describe, expect, test } from 'vitest'
import { channelPublishController } from './channelPublishView'
import type { ChannelTab } from './channelPublishView'
import { draftWire, immediateWire } from './publishWire'
import { publishHarness, testPost, testRecord } from './publishHarness.testutil'

const FRAME = `${'a'.repeat(32)}.jpg`

const PRIMARY: ChannelTab = {
  id: 'uck',
  name: 'UCK',
  platform: 'youtube',
  primary: true,
  published: false,
  language: 'en',
  defaultHashtags: [],
}
const INSTAGRAM: ChannelTab = {
  ...PRIMARY,
  id: 'filip-ig',
  name: 'Filip IG',
  platform: 'instagram',
  primary: false,
}

/** The projected root fields, which the tabs write under `posts` instead. */
const PROJECTED_ROOT_FIELDS = ['description', 'short_description', 'tags', 'hashtags', 'localized']

function record() {
  return testRecord({
    title: 'Library name',
    description: 'The saved description',
    tags: ['captions'],
    thumbnail: { ideas: [], candidates: [FRAME], cover: FRAME },
    posts: {
      uck: testPost({
        title: 'Library name',
        description: 'The saved description',
        tags: ['captions'],
        cover: FRAME,
      }),
      'filip-ig': testPost({ caption: 'The saved caption' }),
    },
  })
}

describe('draftWire', () => {
  test('a mixed edit sends the title at the root and every text under its own post', () => {
    const base = record()
    const harness = publishHarness(base)
    const notify = () => {}
    const tabFor = (tab: ChannelTab) =>
      channelPublishController(harness.publish(), tab, null, [], notify)

    // The primary tab: the library name, then this channel's description.
    tabFor(PRIMARY).setField('title', 'A better name')
    tabFor(PRIMARY).setField('description', 'A better description')
    // The Instagram tab: its own caption.
    tabFor(INSTAGRAM).setPostField('caption', 'A better caption')
    // And a video-level decision.
    harness.publish().setField('collection_id', 'uck-26')

    const wire = draftWire(harness.drafts(), base)

    expect(wire.title).toBe('A better name')
    expect(wire.collection_id).toBe('uck-26')
    expect(wire.posts).toEqual({
      uck: { description: 'A better description' },
      'filip-ig': { caption: 'A better caption' },
    })
    for (const field of PROJECTED_ROOT_FIELDS) {
      expect(wire).not.toHaveProperty(field)
    }
  })

  test('a thumbnail edit keeps the frames and the ideas but never the root cover', () => {
    const base = record()
    const harness = publishHarness(base)
    harness.publish().setField('thumbnail', {
      ideas: [{ label: 'Face', type: 'face', headline: 'It broke', recommended: true }],
      candidates: [],
      cover: FRAME,
    })

    const wire = draftWire(harness.drafts(), base) as {
      thumbnail: Record<string, unknown>
    }

    expect(wire.thumbnail.candidates).toEqual([FRAME])
    expect(wire.thumbnail).not.toHaveProperty('cover')
    expect(wire.thumbnail.ideas).toHaveLength(1)
  })
})

describe('immediateWire', () => {
  test('a `posts` write goes as written — an empty post is how a tab is added', () => {
    const base = record()
    expect(immediateWire({ posts: { filip: {}, 'filip-ig': { hidden: true } } }, base)).toEqual({
      posts: { filip: {}, 'filip-ig': { hidden: true } },
    })
  })

  test('a reverted thumbnail still leaves its cover alone', () => {
    const base = record()
    const wire = immediateWire(
      { thumbnail: { ideas: [], candidates: ['stale.jpg'], cover: 'stale.jpg' } },
      base
    ) as { thumbnail: Record<string, unknown> }

    expect(wire.thumbnail.candidates).toEqual([FRAME])
    expect(wire.thumbnail).not.toHaveProperty('cover')
  })
})
