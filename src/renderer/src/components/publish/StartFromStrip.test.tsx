/**
 * "Start from…" as static markup (node env, `react-dom/server`).
 *
 * The rule under test is when it appears at all: only while this tab's body is
 * empty and there is a source with something in it. Everything it offers is
 * decided by `lib/publishStartFrom.ts`, which is tested on its own.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseChannel } from '../../lib/channelTypes'
import { channelTabs } from '../../lib/channelPublishView'
import { EMPTY_SHORTS } from '../../lib/publishMediaTypes'
import type { Post, PostsMap } from '../../lib/publishPosts'
import { EMPTY_POST } from '../../lib/publishPosts'
import { StartFromStrip } from './StartFromStrip'

const noop = () => {}

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
const IG = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })
const CHANNELS = [UCK, IG]

function post(over: Partial<Post> = {}): Post {
  return { ...EMPTY_POST, ...over }
}

const POSTS: PostsMap = {
  uck: post({ description: 'The long YouTube description.' }),
  'filip-ig': post(),
}

interface Options {
  posts?: PostsMap
  body?: string
  caption?: string
  channelId?: string
}

function strip({ posts = POSTS, body = '', caption = '', channelId = 'filip-ig' }: Options = {}) {
  const tab = channelTabs(posts, CHANNELS, 'uck').find((t) => t.id === channelId)
  if (!tab || !tab.platform) throw new Error(`no usable tab for ${channelId}`)
  return renderToStaticMarkup(
    <StartFromStrip
      videoId="vid_1"
      tab={tab}
      platform={tab.platform}
      record={{ posts, shorts: { ...EMPTY_SHORTS, caption } }}
      body={body}
      channels={CHANNELS}
      platforms={null}
      onDraft={noop}
      notify={noop}
    />
  )
}

describe('StartFromStrip', () => {
  test('offers each source, labelled by channel and platform', () => {
    const markup = strip()

    expect(markup).toContain('aria-label="Start from"')
    expect(markup).toContain('Start from…')
    expect(markup).toContain('UCK (YouTube)')
    // It is an offer, not a save.
    expect(markup).toContain('Nothing is saved until you edit it.')
  })

  test('is gone the moment this tab has any body text', () => {
    expect(strip({ body: 'Already written.' })).toBe('')
    // Whitespace is not text.
    expect(strip({ body: '   ' })).toContain('Start from…')
  })

  test('is gone when there is nothing to start from', () => {
    const empty: PostsMap = { uck: post(), 'filip-ig': post() }
    expect(strip({ posts: empty })).toBe('')
  })

  test('the legacy Shorts caption is offered to a caption tab', () => {
    const empty: PostsMap = { uck: post(), 'filip-ig': post() }
    const markup = strip({ posts: empty, caption: 'A vertical hook.' })

    expect(markup).toContain('>Shorts caption<')
  })

  test('a YouTube tab is never offered the Shorts caption', () => {
    const empty: PostsMap = { uck: post(), 'filip-ig': post() }
    expect(strip({ posts: empty, caption: 'A vertical hook.', channelId: 'uck' })).toBe('')
  })

  test('the YouTube tab starts from the Instagram caption when that is what exists', () => {
    const posts: PostsMap = { uck: post(), 'filip-ig': post({ caption: 'Hello from Instagram' }) }
    const markup = strip({ posts, channelId: 'uck' })

    expect(markup).toContain('Filip IG (Instagram)')
  })
})
