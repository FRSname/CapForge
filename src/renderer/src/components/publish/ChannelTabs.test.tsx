/**
 * The channel tab strip's markup (node env, `react-dom/server`): the tab order,
 * the published dot, the hide button and what the `+` menu offers.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChannelTabsView } from './ChannelTabs'
import type { ChannelTabsViewProps } from './ChannelTabs'
import { parseChannel } from '../../lib/channelTypes'
import { channelTabs } from '../../lib/channelPublishView'
import { EMPTY_POST, addableChannels } from '../../lib/publishPosts'

const noop = () => {}

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
const IG = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })
const LI = parseChannel({ id: 'li', platform: 'linkedin', name: 'Filip on LinkedIn' })
const TT = parseChannel({ id: 'tt', platform: 'tiktok', name: 'Filip TikTok' })
const CHANNELS = [UCK, IG, LI, TT]

const POSTS = {
  'filip-ig': {
    ...EMPTY_POST,
    published: { url: 'https://instagram.com/p/1', id: null, at: null },
  },
  uck: { ...EMPTY_POST },
  li: { ...EMPTY_POST, hidden: true },
}

const TABS = channelTabs(POSTS, CHANNELS, 'uck')

function view(over: Partial<ChannelTabsViewProps> = {}): string {
  return renderToStaticMarkup(
    <ChannelTabsView
      tabs={TABS}
      activeId="uck"
      menu={addableChannels(POSTS, CHANNELS)}
      platforms={null}
      onSelect={noop}
      onAdd={noop}
      onHide={noop}
      menuOpen={false}
      onMenuOpen={noop}
      {...over}
    />
  )
}

describe('ChannelTabsView', () => {
  test('one tab per visible post, in the channels order, with its platform badge', () => {
    const markup = view()

    const uck = markup.indexOf('>UCK<')
    const ig = markup.indexOf('>Filip IG<')
    expect(uck).toBeGreaterThan(-1)
    expect(uck).toBeLessThan(ig)
    // The hidden post has no tab.
    expect(markup).not.toContain('>Filip on LinkedIn<')
    expect(markup).toContain('>YT<')
    expect(markup).toContain('>IG<')
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  test('a post with a live link gets the dot', () => {
    expect(view().match(/aria-label="Published"/g)).toHaveLength(1)
  })

  test('every tab offers to hide itself, and says the text is kept', () => {
    const markup = view()

    expect(markup).toContain('aria-label="Hide UCK"')
    expect(markup).toContain('aria-label="Hide Filip IG"')
    expect(markup).toContain('its text is kept')
  })

  test('the + menu lists the hidden channels first, as "Show again"', () => {
    const markup = view({ menuOpen: true })

    const showAgain = markup.indexOf('>Show again<')
    const hidden = markup.indexOf('>Filip on LinkedIn<')
    const add = markup.indexOf('>Add<')
    const unused = markup.indexOf('>Filip TikTok<')
    expect(showAgain).toBeGreaterThan(-1)
    expect(showAgain).toBeLessThan(hidden)
    expect(hidden).toBeLessThan(add)
    expect(add).toBeLessThan(unused)
  })

  test('the menu is closed until the + is pressed, and says when there is nothing to add', () => {
    expect(view()).not.toContain('role="menu"')
    expect(view({ menuOpen: true, menu: { showAgain: [], add: [] } })).toContain(
      'This video is on every channel'
    )
  })
})
