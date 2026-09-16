/**
 * Static-markup tests (node env, react-dom/server) for the tutorial player.
 *
 * The load-bearing assertion is the click-to-load one: while the player is
 * collapsed there must be no `<iframe` in the markup at all, so opening the
 * guide never reaches YouTube on its own.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TUTORIAL_EMBED_URL, TUTORIAL_URL } from '../../lib/tutorial'
import { TutorialPlayer } from './TutorialPlayer'

function player(expanded: boolean): string {
  return renderToStaticMarkup(
    <TutorialPlayer expanded={expanded} onToggle={() => {}} onOpenUrl={() => {}} />
  )
}

describe('TutorialPlayer', () => {
  test('collapsed offers to play it or to open it in the browser', () => {
    const html = player(false)
    expect(html).toContain('Prefer to watch?')
    expect(html).toContain('Watch the tutorial')
    expect(html).toContain('Open in browser')
  })

  test('collapsed loads nothing external', () => {
    const html = player(false)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain(TUTORIAL_EMBED_URL)
  })

  test('expanded embeds the nocookie player in a 16:9 box', () => {
    const html = player(true)
    expect(html).toContain('<iframe')
    expect(html).toContain(TUTORIAL_EMBED_URL)
    expect(html).toContain('aspect-video')
    expect(html).toContain('title="CapForge tutorial"')
    // react-dom/server keeps React's casing; HTML attribute names are
    // case-insensitive, so this is the real attribute.
    expect(html).toContain('allowFullScreen')
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"')
  })

  test('expanded flips the first button to Hide, and keeps the browser link', () => {
    const html = player(true)
    expect(html).toContain('Hide the tutorial')
    expect(html).not.toContain('Watch the tutorial')
    expect(html).toContain('Open in browser')
  })

  test('the browser link is the watch URL, not the embed URL', () => {
    expect(TUTORIAL_URL).not.toBe(TUTORIAL_EMBED_URL)
    expect(new URL(TUTORIAL_EMBED_URL).hostname).toBe('www.youtube-nocookie.com')
  })

  test('theme colours only', () => {
    for (const html of [player(false), player(true)]) {
      expect(html).not.toContain('text-white')
      expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
      expect(html).toContain('var(--color-text-3)')
    }
  })
})
