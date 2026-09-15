/**
 * One channel's editor, rendered to static markup (node env: no events). The
 * order of its sections, which profile fields a platform shows, and the
 * primary/delete guards.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Channel } from '../../lib/channelTypes'
import { parseChannel } from '../../lib/channelTypes'
import { ChannelEditor, ChannelEditorView } from './ChannelEditor'

const noop = () => {}

function channel(over: Record<string, unknown> = {}): Channel {
  return parseChannel({
    id: 'uck',
    platform: 'youtube',
    name: 'Update Conference',
    handle: '@updateconf',
    context: {
      about: 'Talks from Prague',
      example_titles: ['Jane Doe — Shipping AI', 'Bob — Rust'],
      keywords: ['dotnet', 'ai'],
    },
    profile: { footer: 'Thanks for watching', default_hashtags: ['#uck26'] },
    ...over,
  })
}

function render(value: Channel = channel()) {
  return renderToStaticMarkup(
    <ChannelEditorView
      channel={value}
      platforms={null}
      onDraftIdentity={noop}
      onCommitIdentity={noop}
      onDraftContext={noop}
      onCommitContext={noop}
      onDraftProfile={noop}
      onCommitProfile={noop}
      onMakePrimary={noop}
      onDelete={noop}
    />
  )
}

describe('ChannelEditorView', () => {
  test('identity, then About this channel — for Claude, then Pasted into posts', () => {
    const html = render()

    const identity = html.indexOf('aria-label="Identity"')
    const about = html.indexOf('About this channel — for Claude')
    const pasted = html.indexOf('Pasted into posts')
    expect(identity).toBeGreaterThanOrEqual(0)
    expect(about).toBeGreaterThan(identity)
    expect(pasted).toBeGreaterThan(about)
    expect(html).toContain('Claude reads this before it writes any post for this channel')
  })

  test('shows every context field, lists one per line', () => {
    const html = render()

    for (const label of [
      'About',
      'Audience',
      'Voice',
      'Title style',
      'Example titles',
      'Naming',
      'Example slugs',
      'Keywords',
      'Notes',
    ]) {
      expect(html).toContain(`>${label}</label>`)
    }
    expect(html).toContain('Jane Doe — Shipping AI\nBob — Rust')
    expect(html).toContain('dotnet\nai')
    expect(html).toContain('one per line')
  })

  test('the platform is read-only', () => {
    const html = render()

    expect(html).toContain('>YouTube<')
    expect(html).toContain('platform can’t be changed')
    expect(html).not.toContain('aria-label="New channel platform"')
    expect(html).not.toContain('<select')
  })

  test('Pasted into posts is a disclosure that starts closed', () => {
    const html = render()

    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*>\s*<summary[^>]*>Pasted into posts/)
  })

  test('a YouTube channel pastes every profile field', () => {
    const html = render()

    for (const label of [
      'Recorded-at line',
      'Speaker block',
      'Footer',
      'Description template',
      'Template slots',
      'Default hashtags',
      'Link rows',
      'House rules',
    ]) {
      expect(html).toContain(`>${label}</label>`)
    }
    expect(html).toContain('Thanks for watching')
  })

  test('an Instagram channel shows default hashtags and link rows only', () => {
    const html = render(channel({ platform: 'instagram' }))

    expect(html).toContain('>Default hashtags</label>')
    expect(html).toContain('#uck26')
    expect(html).toContain('>Link rows</label>')
    for (const hidden of [
      'Description template',
      'Footer',
      'Template slots',
      'House rules',
      'Recorded-at line',
      'Speaker block',
    ]) {
      expect(html).not.toContain(hidden)
    }
    expect(html).not.toContain('Add slot')
    expect(html).not.toContain('Thanks for watching')
  })

  test('Make primary is offered for a non-primary YouTube channel', () => {
    const html = render()

    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Make primary<\/button>/)
    expect(html).toContain(
      'The primary channel is what the brief and existing upload packages use.'
    )
  })

  test('Make primary is disabled on the primary channel', () => {
    const html = render(channel({ primary: true }))

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Primary channel<\/button>/)
  })

  test('Make primary is absent for a non-YouTube channel', () => {
    const html = render(channel({ platform: 'instagram' }))

    expect(html).not.toContain('Make primary')
    expect(html).not.toContain('Primary channel<')
    expect(html).not.toContain('The primary channel is what')
  })

  test('Delete is disabled for the primary channel, with a hint', () => {
    const html = render(channel({ primary: true }))

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete channel<\/button>/)
    expect(html).toContain('make another YouTube channel primary before deleting it')
  })

  test('Delete is enabled for any other channel', () => {
    const html = render(channel({ platform: 'instagram' }))

    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete channel<\/button>/)
    expect(html).not.toContain('before deleting it')
  })
})

describe('ChannelEditor', () => {
  test('renders the saved channel as its first draft', () => {
    const html = renderToStaticMarkup(
      <ChannelEditor
        channel={channel()}
        platforms={null}
        onPatch={() => Promise.resolve(null)}
        onMakePrimary={noop}
        onDelete={noop}
      />
    )

    expect(html).toContain('value="@updateconf"')
    expect(html).toContain('Talks from Prague')
  })
})
