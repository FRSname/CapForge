/**
 * Static-markup tests (node env, react-dom/server) for the release-notes card.
 * Apostrophes arrive HTML-escaped, so the assertions avoid them.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReleaseNotes } from '../../lib/releaseNotes'
import { RELEASES_URL } from '../../lib/releaseNotes'
import { WhatsNewDialog } from './WhatsNewDialog'

const ONE: ReleaseNotes = {
  version: '2.6.0',
  headline: 'Mostly new ways to read a caption.',
  highlights: [
    { title: 'RSVP speed-reading captions', body: 'One unwrapped line that slides.' },
    { title: 'Favorite fonts', body: 'Star a font to pin it to the top.' },
  ],
}

const OLDER: ReleaseNotes = {
  version: '2.5.0',
  headline: 'Mostly about trusting your edits.',
  highlights: [{ title: 'Per-word background boxes', body: 'A box scoped to one word.' }],
}

function dialog(notes: ReleaseNotes[], open = true): string {
  return renderToStaticMarkup(
    <WhatsNewDialog open={open} notes={notes} onClose={() => {}} onOpenUrl={() => {}} />
  )
}

describe('WhatsNewDialog', () => {
  test('closed renders nothing', () => {
    expect(dialog([ONE], false)).toBe('')
  })

  test('one release: the header names it, and every highlight is listed', () => {
    const html = dialog([ONE])
    expect(html).toContain('new in CapForge 2.6.0')
    expect(html).toContain('Mostly new ways to read a caption.')
    expect(html).toContain('RSVP speed-reading captions')
    expect(html).toContain('One unwrapped line that slides.')
    expect(html).toContain('Favorite fonts')
  })

  test('several releases: a neutral header and a label per version', () => {
    const html = dialog([ONE, OLDER])
    expect(html).not.toContain('new in CapForge 2.6.0')
    expect(html).toContain('>2.6.0<')
    expect(html).toContain('>2.5.0<')
    expect(html).toContain('Per-word background boxes')
  })

  test('the footer offers the full changelog and a way out', () => {
    const html = dialog([ONE])
    expect(html).toContain('Full changelog')
    expect(html).toContain('Got it')
  })

  test('nothing new: says so, and still closes', () => {
    const html = dialog([])
    expect(html).toContain('up to date')
    expect(html).toContain('Got it')
  })

  test('the card is the narrow one and uses theme colours only', () => {
    const html = dialog([ONE])
    expect(html).toContain('w-[520px]')
    expect(html).toContain('var(--color-text-2)')
    expect(html).not.toContain('text-white')
  })

  test('the changelog URL is the shared constant', () => {
    expect(RELEASES_URL).toContain('github.com')
  })
})
