/**
 * The import "Publish to:" sheet as static markup (node env, `react-dom/server`).
 *
 * What matters: it is a real modal (dialog role, aria-modal), it names what is
 * about to be imported, and its three outcomes are told apart by their copy —
 * Import (to the ticked channels), Import without a channel, and Cancel, which
 * imports nothing at all.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseChannel } from '../../lib/channelTypes'
import { CANCEL_TITLE, SKIP_TITLE, channelsUnreadableMessage } from '../../lib/importChannels'
import { PublishToSheet } from './PublishToSheet'
import type { PublishToSheetProps } from './PublishToSheet'

const noop = () => {}

const UCK = parseChannel({ id: 'uck', platform: 'youtube', name: 'UCK' })
const IG = parseChannel({ id: 'filip-ig', platform: 'instagram', name: 'Filip IG' })

function sheet(over: Partial<PublishToSheetProps> = {}): string {
  return renderToStaticMarkup(
    <PublishToSheet
      what="3 videos"
      channels={[UCK, IG]}
      platforms={null}
      error={null}
      ticked={[]}
      onToggle={noop}
      onImport={noop}
      onSkip={noop}
      onCancel={noop}
      {...over}
    />
  )
}

describe('PublishToSheet', () => {
  test('is a labelled modal dialog over a scrim', () => {
    const markup = sheet()

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Publish to"')
  })

  test('names what is about to be imported', () => {
    expect(sheet()).toContain('Importing 3 videos')
    expect(sheet({ what: 'this video' })).toContain('Importing this video')
  })

  test('lists every Settings channel with its platform badge', () => {
    const markup = sheet()

    expect(markup).toContain('>UCK<')
    expect(markup).toContain('>Filip IG<')
    expect(markup).toContain('>YT<')
    expect(markup).toContain('>IG<')
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2)
  })

  test('the ticked channels are the checked ones', () => {
    const markup = sheet({ ticked: ['filip-ig'] })

    expect(markup.match(/checked=""/g)).toHaveLength(1)
  })

  test('the three outcomes are told apart by their copy, not only by position', () => {
    const markup = sheet({ ticked: ['uck', 'filip-ig'] })

    expect(markup).toContain('Import to 2 channels')
    expect(markup).toContain('Import without a channel')
    expect(markup).toContain('>Cancel<')
    expect(markup).toContain(SKIP_TITLE)
    expect(markup).toContain(CANCEL_TITLE)
    expect(markup).toContain('Escape imports nothing.')
  })

  test('Import is disabled until something is ticked — Skip is the empty choice', () => {
    expect(sheet({ ticked: [] })).toContain('disabled=""')
    expect(sheet({ ticked: ['uck'] })).not.toContain('disabled=""')
  })

  test('a failed channel read is shown, and the import can still go ahead', () => {
    const message = channelsUnreadableMessage('backend down')
    const markup = sheet({ channels: null, error: message })

    expect(markup).toContain('backend down')
    expect(markup).toContain('still import')
    expect(markup).not.toContain('type="checkbox"')
    // Nothing to publish to, so only Skip and Cancel are live.
    expect(markup).toContain('Import without a channel')
    expect(markup).toContain('>Cancel<')
  })

  test('with no channels at all it points at Settings instead of a list', () => {
    const markup = sheet({ channels: [] })

    expect(markup).toContain('No channels yet.')
    expect(markup).toContain('Add one in Settings → Channels')
  })
})
