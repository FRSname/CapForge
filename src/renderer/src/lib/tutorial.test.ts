/**
 * The tutorial video's three constants. The in-app player and the CSP both
 * read them, so they are pinned here: one video id, the watch URL the
 * CHANGELOG links to, and the nocookie embed the CSP allows in a frame.
 */

import { describe, expect, test } from 'vitest'
import { TUTORIAL_EMBED_URL, TUTORIAL_URL, TUTORIAL_VIDEO_ID } from './tutorial'

describe('tutorial links', () => {
  test('the watch link is the one the changelog points at', () => {
    expect(TUTORIAL_VIDEO_ID).toBe('7xxLt5FEq1E')
    expect(TUTORIAL_URL).toBe('https://www.youtube.com/watch?v=7xxLt5FEq1E')
  })

  test('the embed URL is the same video on the nocookie host', () => {
    expect(TUTORIAL_EMBED_URL).toBe('https://www.youtube-nocookie.com/embed/7xxLt5FEq1E?rel=0')
    const embed = new URL(TUTORIAL_EMBED_URL)
    expect(embed.hostname).toBe('www.youtube-nocookie.com')
    expect(embed.pathname).toContain(TUTORIAL_VIDEO_ID)
  })
})
