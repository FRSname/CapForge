/**
 * "Start from…": what an empty tab may be started from, and what a chosen
 * source becomes.
 *
 * The two rules worth pinning: a source with no body is not offered (there
 * would be nothing to adapt), and the legacy Shorts caption — which lives at
 * the record root because no tab claims it — is offered only to the platforms
 * that paste a caption.
 */

import { describe, expect, test } from 'vitest'
import { parseChannel } from './channelTypes'
import type { ChannelTab } from './channelPublishView'
import { channelTabs } from './channelPublishView'
import { EMPTY_SHORTS } from './publishMediaTypes'
import type { Post, PostDraft, PostField, PostsMap } from './publishPosts'
import { EMPTY_POST } from './publishPosts'
import type { StartFromRecord } from './publishStartFrom'
import {
  SHORTS_SOURCE_ID,
  shortsDraftFields,
  startFromFailedMessage,
  startFromLabel,
  startFromOptions,
  startFromPatch,
  writeStartFromDraft,
} from './publishStartFrom'

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
const IG = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })
const TT = parseChannel({ id: 'tt', platform: 'tiktok', name: 'Filip TikTok' })
const LI = parseChannel({ id: 'li', platform: 'linkedin', name: 'Filip on LinkedIn' })
const CHANNELS = [UCK, IG, TT, LI]

function post(over: Partial<Post> = {}): Post {
  return { ...EMPTY_POST, ...over }
}

function record(posts: PostsMap, caption = ''): StartFromRecord {
  return { posts, shorts: { ...EMPTY_SHORTS, caption } }
}

function tabFor(posts: PostsMap, channelId: string): ChannelTab {
  const tab = channelTabs(posts, CHANNELS, 'uck').find((t) => t.id === channelId)
  if (!tab) throw new Error(`no tab for ${channelId}`)
  return tab
}

describe('startFromOptions', () => {
  const posts = {
    uck: post({ description: 'The long YouTube description.' }),
    'filip-ig': post(),
    li: post({ text: 'A LinkedIn hook.' }),
  }

  test('offers the other posts that have a body, in the tab order', () => {
    const options = startFromOptions(record(posts), tabFor(posts, 'filip-ig'), CHANNELS)

    expect(options.map((o) => o.id)).toEqual(['uck', 'li'])
    expect(options[0]).toEqual({ id: 'uck', name: 'UCK', platform: 'youtube', kind: 'post' })
  })

  test('never offers the tab itself, and never a post with an empty body', () => {
    // The Instagram post has no caption, and the YouTube tab is the target.
    const options = startFromOptions(record(posts), tabFor(posts, 'uck'), CHANNELS)

    expect(options.map((o) => o.id)).toEqual(['li'])
  })

  test('a body counts in the source platform’s own field, not any field', () => {
    // A caption on a YouTube post is not its body — YouTube's body is `description`.
    const odd = { uck: post({ caption: 'stray' }), 'filip-ig': post() }
    expect(startFromOptions(record(odd), tabFor(odd, 'filip-ig'), CHANNELS)).toEqual([])
  })

  test('a post whose channel is no longer in Settings is still offered, by its id', () => {
    const orphan = { gone: post({ caption: 'Written before the channel was deleted' }), tt: post() }
    const options = startFromOptions(record(orphan), tabFor(orphan, 'tt'), CHANNELS)

    expect(options).toEqual([{ id: 'gone', name: 'gone', platform: null, kind: 'post' }])
  })

  test('a hidden post is not a source — the tabs do not show it either', () => {
    const hidden = {
      uck: post({ description: 'Hidden away', hidden: true }),
      'filip-ig': post(),
    }
    expect(startFromOptions(record(hidden), tabFor(hidden, 'filip-ig'), CHANNELS)).toEqual([])
  })

  test('the legacy Shorts caption is offered to Instagram and TikTok, last', () => {
    const only = { 'filip-ig': post(), tt: post() }
    const withShorts = record(only, 'A vertical hook.')

    for (const id of ['filip-ig', 'tt']) {
      const options = startFromOptions(withShorts, tabFor(only, id), CHANNELS)
      expect(options[options.length - 1]).toEqual({
        id: SHORTS_SOURCE_ID,
        name: 'Shorts caption',
        platform: null,
        kind: 'shorts',
      })
    }
  })

  test('no other platform is offered the Shorts caption, and an empty one never is', () => {
    const only = { li: post(), uck: post(), 'filip-ig': post() }
    expect(startFromOptions(record(only, 'A hook.'), tabFor(only, 'li'), CHANNELS)).toEqual([])
    expect(startFromOptions(record(only, 'A hook.'), tabFor(only, 'uck'), CHANNELS)).toEqual([])
    expect(startFromOptions(record(only, '   '), tabFor(only, 'filip-ig'), CHANNELS)).toEqual([])
  })
})

describe('startFromLabel', () => {
  test('names the channel and its platform, and just the name without one', () => {
    expect(
      startFromLabel({ id: 'filip-ig', name: 'Filip IG', platform: 'instagram', kind: 'post' }, null)
    ).toBe('Filip IG (Instagram)')
    expect(
      startFromLabel(
        { id: SHORTS_SOURCE_ID, name: 'Shorts caption', platform: null, kind: 'shorts' },
        null
      )
    ).toBe('Shorts caption')
  })

  test('prefers the served platform label', () => {
    const specs = [{ id: 'x' as const, label: 'X (Twitter)', fields: [], limits: [] }]
    expect(startFromLabel({ id: 'x', name: 'Filip X', platform: 'x', kind: 'post' }, specs)).toBe(
      'Filip X (X (Twitter))'
    )
  })
})

describe('startFromPatch', () => {
  test('a caption platform takes the body into its own field, with the hashtags', () => {
    expect(startFromPatch({ caption: 'Adapted.', hashtags: ['#ai'] }, 'instagram')).toEqual({
      caption: 'Adapted.',
      hashtags: ['#ai'],
    })
  })

  test('LinkedIn and X write `text`, YouTube `description` plus its short one', () => {
    expect(startFromPatch({ text: 'Hook' }, 'linkedin')).toEqual({ text: 'Hook' })
    expect(
      startFromPatch({ description: 'Long', short_description: 'Short' }, 'youtube')
    ).toEqual({ description: 'Long', short_description: 'Short' })
  })

  test('only the target’s own fields are taken — a stray field is dropped', () => {
    expect(startFromPatch({ description: 'Long', caption: 'Short' }, 'instagram')).toEqual({
      caption: 'Short',
    })
    // `short_description` belongs to YouTube alone.
    expect(startFromPatch({ caption: 'c', short_description: 's' }, 'tiktok')).toEqual({
      caption: 'c',
    })
  })

  test('nothing empty is written, so picking a source can never blank a field', () => {
    expect(startFromPatch({ caption: '', hashtags: [] }, 'instagram')).toEqual({})
    expect(startFromPatch({}, 'youtube')).toEqual({})
  })

  test('the hashtags are copied, not shared with the answer', () => {
    const hashtags = ['#ai']
    expect(startFromPatch({ caption: 'c', hashtags }, 'tiktok').hashtags).not.toBe(hashtags)
  })
})

describe('shortsDraftFields', () => {
  test('the local caption becomes a caption field, ready for the same patch', () => {
    expect(startFromPatch(shortsDraftFields('A vertical hook.'), 'instagram')).toEqual({
      caption: 'A vertical hook.',
    })
  })
})

describe('writeStartFromDraft', () => {
  test('writes one post field per key, and nothing for an empty patch', () => {
    const written: Array<[PostField, unknown]> = []
    const write = <K extends PostField>(field: K, value: Post[K]) => {
      written.push([field, value])
    }

    writeStartFromDraft({ caption: 'Adapted.', hashtags: ['#ai'] }, write)
    expect(written).toEqual([
      ['caption', 'Adapted.'],
      ['hashtags', ['#ai']],
    ])

    written.length = 0
    writeStartFromDraft({} as PostDraft, write)
    expect(written).toEqual([])
  })

  test('every field a patch can carry reaches the writer', () => {
    const written: PostField[] = []
    writeStartFromDraft(
      { description: 'd', short_description: 's', caption: 'c', text: 't', hashtags: [] },
      (field) => written.push(field)
    )
    expect(written).toEqual(['description', 'short_description', 'caption', 'text', 'hashtags'])
  })
})

describe('startFromFailedMessage', () => {
  test('names the source and keeps the reason', () => {
    expect(startFromFailedMessage('UCK', 'no_post')).toBe('Could not start from UCK: no_post')
  })
})
