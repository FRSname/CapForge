/**
 * Settings → Channels' list, rendered to static markup (node env: no effects,
 * no events). The container loads over REST, so what is asserted is the
 * presentational half it hands its state to, plus the container's empty state.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Channel, PlatformSpec } from '../../lib/channelTypes'
import { parseChannel } from '../../lib/channelTypes'
import { ChannelsSettings, ChannelsSettingsView } from './ChannelsSettings'

const noop = () => {}

function channel(over: Record<string, unknown> = {}): Channel {
  return parseChannel({ id: 'uck', platform: 'youtube', name: 'Update Conference', ...over })
}

const CHANNELS = [
  channel({ primary: true }),
  channel({ id: 'filip', name: 'Filip Raszyk' }),
  channel({ id: 'filip-ig', platform: 'instagram', name: 'Filip on Instagram' }),
]

function render(props: Partial<React.ComponentProps<typeof ChannelsSettingsView>> = {}) {
  return renderToStaticMarkup(
    <ChannelsSettingsView
      channels={CHANNELS}
      platforms={null}
      loading={false}
      selectedId="uck"
      onSelect={noop}
      onCreate={noop}
      {...props}
    />
  )
}

describe('ChannelsSettingsView', () => {
  test('lists every channel with its platform', () => {
    const html = render()

    expect(html).toContain('Update Conference')
    expect(html).toContain('Filip Raszyk')
    expect(html).toContain('Filip on Instagram')
    expect(html).toContain('>IG<')
    expect(html).toContain('>Instagram<')
    expect(html).toContain('>YT<')
  })

  test('shows exactly one Primary badge, on the primary channel', () => {
    const html = render()

    expect(html.match(/>Primary</g)).toHaveLength(1)
    const primaryRow = html.split('<li>').find((row) => row.includes('Update Conference')) ?? ''
    expect(primaryRow).toContain('>Primary<')
  })

  test('marks the selected channel', () => {
    expect(render({ selectedId: 'filip' }).match(/aria-current="true"/g)).toHaveLength(1)
  })

  test('uses the served platform labels once they load', () => {
    const platforms: PlatformSpec[] = [
      { id: 'instagram', label: 'Instagram (served)', fields: [], limits: [] },
    ]
    expect(render({ platforms })).toContain('Instagram (served)')
  })

  test('offers New channel… with a platform picker and a name', () => {
    const html = render()

    expect(html).toContain('New channel…')
    expect(html).toContain('aria-label="New channel platform"')
    for (const label of ['YouTube', 'TikTok', 'Instagram', 'LinkedIn', 'X']) {
      expect(html).toContain(`>${label}</option>`)
    }
    expect(html).toContain('aria-label="New channel name"')
    expect(html).toContain('>Create<')
  })

  test('says so while reading, and when there are none', () => {
    expect(render({ channels: [], loading: true })).toContain('Reading channels…')
    expect(render({ channels: [] })).toContain('No channels yet.')
  })
})

describe('ChannelsSettings', () => {
  test('renders its loading state before the list arrives', () => {
    const html = renderToStaticMarkup(<ChannelsSettings />)
    expect(html).toContain('Reading channels…')
    expect(html).toContain('New channel name')
  })
})
