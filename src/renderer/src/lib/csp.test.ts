/**
 * The renderer's Content-Security-Policy is a one-line `<meta>` in
 * `index.html`, which makes it easy to widen by accident. This test reads the
 * real file and pins the one thing the embedded tutorial needed: `frame-src`
 * lists the YouTube nocookie origin and nothing else, and `default-src 'self'`
 * is still the base.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { TUTORIAL_EMBED_URL } from './tutorial'

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')

/** The only origin the app is allowed to frame: the tutorial player's own. */
const EMBED_ORIGIN = new URL(TUTORIAL_EMBED_URL).origin

function cspContent(): string {
  const match = INDEX_HTML.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i
  )
  if (!match) throw new Error('no Content-Security-Policy meta tag in index.html')
  return match[1]
}

function directive(name: string): string[] | null {
  for (const part of cspContent().split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens[0] === name) return tokens.slice(1)
  }
  return null
}

describe('renderer CSP', () => {
  test('frame-src allows the tutorial origin and nothing else', () => {
    expect(directive('frame-src')).toEqual([EMBED_ORIGIN])
  })

  test("default-src is still 'self'", () => {
    expect(directive('default-src')).toEqual(["'self'"])
  })
})
