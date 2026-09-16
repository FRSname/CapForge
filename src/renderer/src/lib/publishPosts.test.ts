/**
 * `posts`: the boundary guard, the tab order, the draft delta, the send and the
 * soft lock (docs/plans/multi-channel-pr3-contract.md).
 */

import { describe, expect, test } from 'vitest'
import type { Post } from './publishPosts'
import {
  EMPTY_POST,
  addPostsPatch,
  addableChannels,
  applyPostsDraft,
  composePostsPatch,
  parsePost,
  parsePosts,
  postDraftFields,
  postsDraftFor,
  resolveActiveChannel,
  survivingPosts,
  visibleChannelIds,
  withPostField,
  withPostsDraft,
  withoutRootCover,
} from './publishPosts'
import { EMPTY_LOCALIZED } from './publishMediaTypes'

const FRAME_A = `${'a'.repeat(32)}.jpg`
const FRAME_B = `${'b'.repeat(32)}.jpg`

function post(over: Partial<Post> = {}): Post {
  return { ...EMPTY_POST, ...over }
}

function german(title: string) {
  return { ...EMPTY_LOCALIZED, title }
}

describe('parsePosts', () => {
  test('reads every field and degrades what the backend has not written', () => {
    const posts = parsePosts({
      uck: {
        title: 'T',
        description: 'D',
        tags: ['a', 3],
        cover: '',
        language: 'pl',
        localized: { de: { title: 'Titel' } },
        published: { url: 'https://youtu.be/x', id: 'x' },
        hidden: true,
      },
      broken: 'nope',
      ig: {},
    })

    expect(Object.keys(posts)).toEqual(['uck', 'ig'])
    expect(posts.uck).toMatchObject({
      title: 'T',
      description: 'D',
      tags: ['a'],
      // An empty cover is "no cover", not the empty string.
      cover: null,
      language: 'pl',
      hidden: true,
      published: { url: 'https://youtu.be/x', id: 'x', at: null },
    })
    expect(posts.uck.localized.de?.title).toBe('Titel')
    expect(posts.ig).toEqual(EMPTY_POST)
  })

  test('a missing or malformed block is no posts, and a garbage post is an empty one', () => {
    expect(parsePosts(undefined)).toEqual({})
    expect(parsePosts([{ id: 'uck' }])).toEqual({})
    expect(parsePost(null)).toEqual(EMPTY_POST)
  })
})

describe('the tab strip', () => {
  const channels = [{ id: 'uck' }, { id: 'ig' }, { id: 'li' }]
  const posts = { gone: post(), ig: post(), uck: post(), li: post({ hidden: true }) }

  test('visible posts in channels.json order, then the ones whose channel is gone', () => {
    expect(visibleChannelIds(posts, channels)).toEqual(['uck', 'ig', 'gone'])
  })

  test('with no channels read yet every visible post keeps the record’s order', () => {
    expect(visibleChannelIds(posts, null)).toEqual(['gone', 'ig', 'uck'])
  })

  test('the + menu offers the hidden channels and the ones with no post', () => {
    expect(addableChannels(posts, channels)).toEqual({
      showAgain: [{ id: 'li' }],
      add: [],
    })
    expect(addableChannels({}, channels).add).toHaveLength(3)
  })

  test('adding creates an empty post, or shows a hidden one again', () => {
    expect(addPostsPatch(['ig', 'li'], posts)).toEqual({ ig: {}, li: { hidden: false } })
    expect(addPostsPatch(['new'], posts)).toEqual({ new: {} })
  })

  test('the active tab is the last used, else the primary, else the first', () => {
    const visible = ['uck', 'ig']
    expect(resolveActiveChannel(visible, 'ig', 'uck')).toBe('ig')
    // Last used on another video, or a tab since hidden: the primary wins.
    expect(resolveActiveChannel(visible, 'gone', 'uck')).toBe('uck')
    expect(resolveActiveChannel(['ig'], undefined, 'uck')).toBe('ig')
    expect(resolveActiveChannel([], undefined, 'uck')).toBeNull()
  })
})

describe('the draft', () => {
  const stored = {
    uck: post({ description: 'Saved', localized: { de: german('Titel') } }),
    ig: post({ caption: 'Old' }),
  }

  test('names only the channels and fields that changed', () => {
    const shown = withPostField(stored, 'ig', 'caption', 'New')
    expect(postsDraftFor(stored, shown)).toEqual({ ig: { caption: 'New' } })
  })

  test('typing back to the saved value leaves no draft', () => {
    const shown = withPostField(withPostField(stored, 'ig', 'caption', 'New'), 'ig', 'caption', 'Old')
    expect(postsDraftFor(stored, shown)).toEqual({})
  })

  test('a post’s localized is a per-language delta, `null` for a removal', () => {
    const shown = withPostField(stored, 'uck', 'localized', { pl: german('Tytuł') })
    expect(postsDraftFor(stored, shown)).toEqual({
      uck: { localized: { pl: german('Tytuł'), de: null } },
    })
  })

  test('applyPostsDraft lays the delta over the record without touching it', () => {
    const draft = { uck: { description: 'Typing', localized: { de: null } } }
    const shown = applyPostsDraft(stored, draft)

    expect(shown.uck.description).toBe('Typing')
    expect(shown.uck.localized).toEqual({})
    expect(shown.ig).toBe(stored.ig)
    expect(stored.uck.description).toBe('Saved')
    expect(stored.uck.localized.de).toEqual(german('Titel'))
  })

  test('a draft for a channel with no post is not a tab, and writing to one is a no-op', () => {
    expect(applyPostsDraft(stored, { gone: { caption: 'x' } }).gone).toBeUndefined()
    expect(withPostField(stored, 'gone', 'caption', 'x')).toBe(stored)
  })
})

describe('the send', () => {
  const latest = {
    posts: { ig: post({ caption: 'The agent wrote this', hashtags: ['#a'] }), uck: post() },
    thumbnail: { candidates: [FRAME_A] },
  }

  test('only the fields that still differ from the latest record go out', () => {
    const wire = composePostsPatch(
      { ig: { caption: 'Mine', hashtags: ['#a'] }, gone: { caption: 'x' } },
      latest
    )
    // `hashtags` already says that, and the removed channel is not recreated.
    expect(wire).toEqual({ ig: { caption: 'Mine' } })
  })

  test('a cover whose frame was deleted meanwhile is sent as no cover', () => {
    expect(composePostsPatch({ uck: { cover: FRAME_B } }, latest)).toEqual({})
    expect(composePostsPatch({ uck: { cover: FRAME_A } }, latest)).toEqual({
      uck: { cover: FRAME_A },
    })
  })

  test('a post’s localized goes out as the language delta, unwritten text as null', () => {
    const wire = composePostsPatch({ uck: { localized: { pl: german('Tytuł') } } }, latest)
    expect(wire.uck).toEqual({
      localized: { pl: { ...german('Tytuł'), description: null, short_description: null, shorts_caption: null } },
    })
  })

  test('removing a post is sent only while the record still has it', () => {
    expect(composePostsPatch({ ig: null, gone: null }, latest)).toEqual({ ig: null })
  })

  test('withPostsDraft drops `posts` when nothing is left to send', () => {
    const patch = { title: 'A name', posts: { ig: { caption: 'The agent wrote this' } } }
    expect(withPostsDraft(patch, latest)).toEqual({ title: 'A name' })
    expect(withPostsDraft({ title: 'A name' }, latest)).toEqual({ title: 'A name' })
  })

  test('the root thumbnail cover is never sent — covers are per channel', () => {
    const wire = withoutRootCover({ thumbnail: { ideas: [], candidates: [FRAME_A], cover: FRAME_A } })
    expect(wire.thumbnail).toEqual({ ideas: [], candidates: [FRAME_A] })
    expect(withoutRootCover({ title: 'x' })).toEqual({ title: 'x' })
  })

  test('postDraftFields is one channel’s drafted fields, as the validator gets them', () => {
    const shown = withPostField(latest.posts, 'ig', 'caption', 'Mine')
    expect(postDraftFields(latest, shown, 'ig')).toEqual({ caption: 'Mine' })
    expect(postDraftFields(latest, shown, 'uck')).toEqual({})
  })
})

describe('survivingPosts', () => {
  const local = { ig: post({ caption: 'Base', hashtags: [] }), uck: post({ description: 'Base' }) }

  test('per channel and field: what the agent wrote is the agent’s, the rest stays', () => {
    const remote = { ig: post({ caption: 'Agent', hashtags: [] }), uck: post({ description: 'Base' }) }
    const draft = { ig: { caption: 'Mine', hashtags: ['#x'] }, uck: { description: 'Mine too' } }

    expect(survivingPosts(draft, local, remote, false)).toEqual({
      ig: { hashtags: ['#x'] },
      uck: { description: 'Mine too' },
    })
  })

  test('the soft lock keeps every drafted field until the banner is answered', () => {
    const remote = { ig: post({ caption: 'Agent', hashtags: [] }), uck: post({ description: 'Base' }) }
    const draft = { ig: { caption: 'Mine' } }

    expect(survivingPosts(draft, local, remote, true)).toEqual(draft)
  })

  test('a post the agent removed takes its drafts with it, and nothing left is null', () => {
    const remote = { uck: post({ description: 'Base' }) }
    expect(survivingPosts({ ig: { caption: 'Mine' } }, local, remote, false)).toBeNull()
  })

  test('a drafted language the agent left alone survives; one it wrote over does not', () => {
    const withDe = { uck: post({ localized: { de: german('Titel') } }) }
    const remote = { uck: post({ localized: { de: german('Agent') } }) }
    const draft = { uck: { localized: { de: german('Mine'), pl: german('Tytuł') } } }

    expect(survivingPosts(draft, withDe, remote, false)).toEqual({
      uck: { localized: { pl: german('Tytuł') } },
    })
  })
})

